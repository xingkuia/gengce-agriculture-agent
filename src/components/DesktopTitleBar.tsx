import { Moon, Sun, Maximize2, Minus, Sprout, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

export function DesktopTitleBar() {
  const desktop = window.desktopBridge;
  const [dark, setDark] = useState(() => localStorage.getItem("gengce-theme") === "dark");
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("gengce-theme", dark ? "dark" : "light"); }, [dark]);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onMaximizedChange(setMaximized);
  }, [desktop]);

  const toggleMaximize = async () => {
    if (!desktop) return;
    setMaximized(await desktop.toggleMaximize());
  };

  return (
    <header
      className="desktop-titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void toggleMaximize();
      }}
    >
      <div className="desktop-titlebar-brand">
        <span className="titlebar-brand-mark" aria-hidden="true">
          <Sprout size={15} strokeWidth={1.9} />
        </span>
        <strong>耕策</strong>
        <span>农业助手</span>
      </div>
      <div className="desktop-titlebar-status">
        <span className="local-status-dot" />
        <span>本地 Agent</span>
        {!desktop && <span className="browser-preview-label">桌面预览</span>}
      </div>
      <div className="window-controls" aria-label="窗口控制"><button className="theme-toggle" type="button" aria-label={dark ? "切换浅色主题" : "切换深色主题"} onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
        <button
          type="button"
          onClick={() => void desktop?.minimize()}
          disabled={!desktop}
          aria-label="最小化"
          title="最小化"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => void toggleMaximize()}
          disabled={!desktop}
          aria-label={maximized ? "还原窗口" : "最大化"}
          title={maximized ? "还原窗口" : "最大化"}
        >
          {maximized ? <Square size={12} /> : <Maximize2 size={13} />}
        </button>
        <button
          className="window-close"
          type="button"
          onClick={() => void desktop?.close()}
          disabled={!desktop}
          aria-label="关闭"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
