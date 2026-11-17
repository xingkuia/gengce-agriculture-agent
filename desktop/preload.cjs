const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  isDesktop: true,
  platform: process.platform,
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onMaximizedChange: (listener) => {
    const handler = (_event, maximized) => listener(Boolean(maximized));
    ipcRenderer.on("window:maximized-change", handler);
    return () => ipcRenderer.removeListener("window:maximized-change", handler);
  }
});
