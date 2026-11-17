const { app, BrowserWindow, ipcMain, shell, utilityProcess } = require("electron");
const { createWriteStream, mkdirSync, existsSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");

// This workbench uses ordinary DOM rendering. Software compositing avoids
// blank native windows on Windows drivers while the renderer itself is healthy.
app.disableHardwareAcceleration();

let mainWindow = null;
let serverProcess = null;
let serverLog = null;
let appUrl = "";

app.setName("耕策");
// Retain existing desktop data after the product rename.
const legacyUserData = path.join(app.getPath("appData"), "荆野农策");
const explicitUserData = process.env.GENGCE_USER_DATA_DIR?.trim();
if (explicitUserData) {
  app.setPath("userData", path.resolve(explicitUserData));
} else if (existsSync(path.join(legacyUserData, "data", "agri.db")) && !existsSync(path.join(app.getPath("userData"), "data", "agri.db"))) {
  app.setPath("userData", legacyUserData);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    showStartupError(error);
  });
}

async function bootstrap() {
  registerWindowHandlers();
  const appRoot = resolveAppRoot();
  const userData = app.getPath("userData");
  loadEnvironmentFile(path.join(appRoot, ".env"));
  loadEnvironmentFile(path.join(userData, ".env"));

  if (process.env.DESKTOP_SERVER_URL) {
    appUrl = process.env.DESKTOP_SERVER_URL;
  } else {
    const port = await findAvailablePort();
    startBundledServer(appRoot, userData, port);
    await waitForServer(port);
    appUrl = `http://127.0.0.1:${port}`;
  }

  createWindow(appUrl);
}

function resolveAppRoot() {
  const candidates = [
    process.env.GENGCE_APP_ROOT?.trim(),
    path.resolve(__dirname, ".."),
    app.getAppPath(),
    process.resourcesPath
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "dist-server", "index.js"))) {
      return candidate;
    }
  }
  return path.resolve(__dirname, "..");
}

function loadEnvironmentFile(filePath) {
  try {
    process.loadEnvFile(filePath);
  } catch {
    // A .env file is optional; the app falls back to deterministic demo mode.
  }
}

function startBundledServer(appRoot, userData, port) {
  const serverEntry = path.join(appRoot, "dist-server", "index.js");
  const dataDirectory = path.join(userData, "data");
  const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
  // A relative DATABASE_PATH belongs to the application's private user-data
  // directory. Resolving it against the release directory makes each package
  // replacement create a fresh database and makes saved farms appear to reset.
  const databasePath = configuredDatabasePath
    ? path.isAbsolute(configuredDatabasePath)
      ? configuredDatabasePath
      : path.resolve(userData, configuredDatabasePath)
    : path.join(dataDirectory, "agri.db");
  mkdirSync(dataDirectory, { recursive: true });
  serverLog = createWriteStream(path.join(userData, "server.log"), { flags: "a" });
  serverProcess = utilityProcess.fork(serverEntry, [], {
    cwd: app.isPackaged ? process.resourcesPath : appRoot,
    env: {
      ...process.env,
      APP_ROOT: appRoot,
      PORT: String(port),
      SOIL_DATA_DIR: process.env.SOIL_DATA_DIR || (app.isPackaged ? path.join(process.resourcesPath, "soil-hubei") : path.join(appRoot, "data", "soil", "hubei", "soil-hubei")),
      DATABASE_PATH: databasePath
    },
    stdio: "pipe",
    serviceName: "Gengce Agriculture Agent"
  });
  serverProcess.stdout?.pipe(serverLog, { end: false });
  serverProcess.stderr?.pipe(serverLog, { end: false });
  serverProcess.on("exit", (code) => {
    if (serverLog) serverLog.write(`\n[desktop] server exited with code ${code}\n`);
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 680,
    show: false,
    frame: false,
    title: "耕策",
    backgroundColor: "#f9f9f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  const window = mainWindow;
  const revealWindow = () => {
    if (window.isDestroyed() || window.isVisible()) return;
    window.show();
    window.focus();
  };

  // Local pages can finish before a listener attached after loadURL receives
  // ready-to-show. Register every reveal path first, with a final timeout guard.
  window.once("ready-to-show", revealWindow);
  window.webContents.once("did-finish-load", revealWindow);
  const revealTimer = setTimeout(revealWindow, 4_000);
  window.once("closed", () => clearTimeout(revealTimer));

  void window.loadURL(url).catch((error) => {
    showWindowLoadError(window, url, error);
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      showWindowLoadError(
        window,
        validatedURL || url,
        new Error(`${errorDescription} (${errorCode})`)
      );
    }
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    showWindowLoadError(
      window,
      url,
      new Error(`界面进程异常退出：${details.reason}`)
    );
  });
  mainWindow.on("maximize", () => sendMaximizedState(true));
  mainWindow.on("unmaximize", () => sendMaximizedState(false));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) void shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(url)) event.preventDefault();
  });
}

function showWindowLoadError(window, url, error) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const message = String(error instanceof Error ? error.message : error);
  const safeMessage = escapeHtml(message);
  const safeUrl = escapeHtml(url);
  void window.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <html lang="zh-CN"><body style="font-family:'Microsoft YaHei',sans-serif;background:#f7f8f5;color:#243128;padding:42px">
      <h1 style="font-size:22px">耕策界面加载失败</h1>
      <p style="font-size:14px;line-height:1.7;color:#5c685f">${safeMessage}</p>
      <p style="font-size:12px;line-height:1.7;color:#7b877e;word-break:break-all">${safeUrl}</p>
      <button onclick="window.close()" style="height:36px;padding:0 16px;border:0;border-radius:6px;background:#2f6748;color:white">关闭</button>
      </body></html>
    `)}`
  ).catch(() => {
    if (!window.isDestroyed()) window.show();
  });
  if (!window.isVisible()) window.show();
}

function registerWindowHandlers() {
  ipcMain.handle("window:get-state", () => ({
    visible: Boolean(mainWindow?.isVisible()),
    focused: Boolean(mainWindow?.isFocused()),
    minimized: Boolean(mainWindow?.isMinimized()),
    maximized: Boolean(mainWindow?.isMaximized())
  }));
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });
}

function sendMaximizedState(maximized) {
  mainWindow?.webContents.send("window:maximized-change", maximized);
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // The local service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error("本地 Agent 服务启动超时，请查看 userData/server.log。");
}

function showStartupError(error) {
  const message = escapeHtml(String(error instanceof Error ? error.message : error));
  mainWindow = new BrowserWindow({
    width: 760,
    height: 430,
    frame: false,
    backgroundColor: "#f7f8f5",
    webPreferences: { sandbox: true }
  });
  void mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <html lang="zh-CN"><body style="font-family:'Microsoft YaHei',sans-serif;background:#f7f8f5;color:#243128;padding:42px">
      <h1 style="font-size:22px">耕策启动失败</h1>
      <p style="font-size:14px;line-height:1.7;color:#5c685f">${message}</p>
      <button onclick="window.close()" style="height:36px;padding:0 16px;border:0;border-radius:6px;background:#2f6748;color:white">关闭</button>
      </body></html>
    `)}`
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stopBundledServer() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = null;
  if (serverLog) serverLog.end();
  serverLog = null;
}

app.on("before-quit", stopBundledServer);
app.on("window-all-closed", () => {
  stopBundledServer();
  app.quit();
});
