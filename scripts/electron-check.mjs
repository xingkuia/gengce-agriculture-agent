import { spawn } from "node:child_process";
import electronPath from "electron";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const debuggingPort = Number(process.env.CDP_PORT ?? 9555);
const attachOnly = process.env.ELECTRON_ATTACH === "1";
const screenshotDir = join(process.cwd(), "test-results", "ui");
await mkdir(screenshotDir, { recursive: true });

const profile = attachOnly ? null : await mkdtemp(join(tmpdir(), "gengce-desktop-check-"));
let desktop = null;
let desktopOutput = "";
if (profile) {
  desktop = spawn(
    electronPath,
    [
      join(process.cwd(), "desktop", "main.cjs"),
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profile}`
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GENGCE_USER_DATA_DIR: profile,
        DATABASE_PATH: "./data/agri.db"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false
    }
  );
  const collect = (chunk) => {
    desktopOutput = `${desktopOutput}${String(chunk)}`.slice(-8_000);
  };
  desktop.stdout?.on("data", collect);
  desktop.stderr?.on("data", collect);
}

const stopDesktop = () => {
  if (desktop && !desktop.killed) desktop.kill();
};
process.once("exit", stopDesktop);

const page = await waitForPage(debuggingPort).catch((error) => {
  stopDesktop();
  throw new Error(`${error.message}${desktopOutput ? `\nElectron 输出：${desktopOutput}` : ""}`);
});
const socket = new WebSocket(page.webSocketDebuggerUrl);
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
} catch (error) {
  stopDesktop();
  throw error;
}

let messageId = 0;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener("message", (message) => {
  const payload = JSON.parse(String(message.data));
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
    return;
  }
  if (payload.method === "Runtime.exceptionThrown") {
    consoleErrors.push(payload.params.exceptionDetails.text);
  }
  if (payload.method === "Runtime.consoleAPICalled" && payload.params.type === "error") {
    consoleErrors.push(
      payload.params.args.map((argument) => argument.value ?? argument.description).join(" ")
    );
  }
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const capture = async (name) => {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(join(screenshotDir, name), Buffer.from(result.data, "base64"));
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".assistant-welcome"))'),
    20_000,
    "Electron 农业助手未渲染"
  );

  const bridge = await evaluate(
    `(async () => ({
      isDesktop: window.desktopBridge?.isDesktop === true,
      platform: window.desktopBridge?.platform ?? null,
      windowState: await window.desktopBridge?.getWindowState?.(),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }))()`
  );
  if (!bridge.isDesktop) throw new Error("Electron preload bridge 未注入");
  if (!bridge.windowState?.visible) {
    throw new Error(`Electron 主窗口未显示：${JSON.stringify(bridge.windowState)}`);
  }
  if (!existsSync(join(profile, "data", "agri.db"))) {
    throw new Error("相对 DATABASE_PATH 未写入 Electron userData/data");
  }
  await capture("electron-window.png");

  const maximizeCycle = await evaluate(
    `(async () => {
      const maximized = await window.desktopBridge.toggleMaximize();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const restored = await window.desktopBridge.toggleMaximize();
      return { maximized, restored };
    })()`
  );

  await evaluate(
    `(() => {
      const button = document.querySelector(".welcome-prompts button");
      button?.click();
      return Boolean(button);
    })()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".assistant-candidate-row"))'),
    30_000,
    "Electron 内 Agent 运行未完成"
  );
  const eventCount = await evaluate('document.querySelectorAll(".trace-event").length');
  if (eventCount < 10) throw new Error(`Electron 轨迹事件不足：${eventCount}`);
  const modelState = await evaluate(
    `(async () => {
      const bootstrap = await fetch("/api/bootstrap").then((response) => response.json());
      const eventTitles = [...document.querySelectorAll(".trace-content h3")]
        .map((element) => element.textContent?.trim() ?? "");
      const events = bootstrap.latestRun?.events ?? [];
      const summaryEvent = events.find((event) => event.title === "受约束摘要已生成");
      const estimate = events.find((event) => event.payload?.artifact === "EconomicEstimate");
      return {
        configured: bootstrap.model.configured,
        modelExposed: document.body.innerText.includes(bootstrap.model.model),
        usedInRun: Boolean(summaryEvent && estimate?.payload?.modelFallback === null),
        eventTitles
      };
    })()`
  );
  if (!modelState.configured || !modelState.usedInRun || modelState.modelExposed) {
    throw new Error(`桌面模型调用或界面隐藏策略异常：${JSON.stringify(modelState)}`);
  }

  await evaluate(
    `(() => {
      const button = document.querySelector(".candidate-actions .primary-button");
      button?.click();
      return Boolean(button && !button.disabled);
    })()`
  );
  await waitFor(() => evaluate('Boolean(document.querySelector(".approval-card"))'), 3000, "缺少方案确认");
  await evaluate('document.querySelector(".approval-actions button:last-child")?.click()');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".plan-document-card"))'),
    10_000,
    "桌面端采用方案后未返回对话内方案文档"
  );
  const planDrawerStayedClosed = await evaluate('!document.querySelector(".business-drawer")');
  if (!planDrawerStayedClosed) {
    throw new Error("桌面端采用方案后不应自动打开业务抽屉");
  }
  const planStreamingObserved = await waitFor(
    () =>
      evaluate(
        'document.querySelector(".plan-response .streaming-text")?.dataset.streaming === "true"'
      ),
    3_000,
    "桌面端未观察到方案逐字流式输出"
  );
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".plan-response .streaming-text")?.dataset.streaming === "false"'
      ),
    20_000,
    "桌面端方案回复未完成流式输出"
  );
  await capture("electron-window-complete.png");

  await evaluate(
    `[...document.querySelectorAll(".evaluation-link")]
      .find((button) => button.textContent.includes("能力中心"))?.click()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".capability-view"))'),
    5_000,
    "桌面能力中心未打开"
  );
  await waitFor(
    () => evaluate('document.querySelector(".capability-view")?.textContent.includes("内置mcp")'),
    8_000,
    "桌面内置 MCP 未显示"
  );
  await evaluate(
    `(() => {
      const item = [...document.querySelectorAll(".mcp-item")]
        .find((element) => element.textContent.includes("内置mcp"));
      const button = [...(item?.querySelectorAll(".capability-inline-actions button") ?? [])]
        .find((candidate) => candidate.textContent.includes("发现工具"));
      button?.click();
      return Boolean(button);
    })()`
  );
  await waitFor(
    () => evaluate(
      `fetch("/api/capabilities")
        .then((response) => response.json())
        .then((data) => {
          const server = data.mcpServers.find((item) => item.name === "内置mcp");
          return server?.status === "connected" && server.tools.length === 3;
        })`
    ),
    20_000,
    "桌面内置 MCP 工具未完成发现"
  );
  const mcpState = await evaluate(
    `fetch("/api/capabilities")
      .then((response) => response.json())
      .then((data) => {
        const server = data.mcpServers.find((item) => item.name === "内置mcp");
        return {
          status: server?.status ?? null,
          tools: server?.tools.map((tool) => tool.name) ?? []
        };
      })`
  );
  await capture("electron-capabilities-mcp.png");

  if (consoleErrors.length) {
    throw new Error(`Electron 控制台错误：${JSON.stringify(consoleErrors)}`);
  }

  console.log(
    JSON.stringify(
      {
        bridge,
        maximizeCycle,
        eventCount,
        modelState,
        planDrawerStayedClosed,
        planStreamingObserved,
        mcpState,
        consoleErrors,
        screenshots: [
          join(screenshotDir, "electron-window.png"),
          join(screenshotDir, "electron-window-complete.png"),
          join(screenshotDir, "electron-capabilities-mcp.png")
        ]
      },
      null,
      2
    )
  );
} finally {
  socket.close();
  stopDesktop();
}

async function waitForPage(port) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((entry) => entry.type === "page" && /^https?:/.test(entry.url));
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`无法连接 Electron 调试端口${lastError ? `：${lastError}` : ""}`);
}

async function waitFor(check, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(message);
}
