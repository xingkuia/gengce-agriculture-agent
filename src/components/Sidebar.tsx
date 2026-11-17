import {
  BarChart3,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Map,
  PanelLeftClose,
  Plus,
  Sprout
} from "lucide-react";
import type { Account, Farm, ModelStatus, Plot } from "../types";

export type ViewKey = "decision" | "plan" | "records" | "results" | "farms" | "evaluation";

interface SidebarProps {
  account: Account;
  farms: Array<Farm & { plots: Plot[] }>;
  activePlotId: string;
  view: ViewKey;
  model: ModelStatus;
  mobileOpen: boolean;
  onSelectView: (view: ViewKey) => void;
  onSelectPlot: (plotId: string) => void;
  onClose: () => void;
}

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "decision", label: "种植决策", icon: LayoutDashboard },
  { key: "plan", label: "种植方案", icon: Map },
  { key: "records", label: "农事记录", icon: ClipboardList },
  { key: "results", label: "结果复盘", icon: BarChart3 },
  { key: "farms", label: "基地与地块", icon: Sprout },
  { key: "evaluation", label: "Agent 评估", icon: FlaskConical }
];

export function Sidebar({
  account,
  farms,
  activePlotId,
  view,
  model,
  mobileOpen,
  onSelectView,
  onSelectPlot,
  onClose
}: SidebarProps) {
  return (
    <>
      <div className={`mobile-scrim ${mobileOpen ? "is-visible" : ""}`} onClick={onClose} />
      <aside className={`app-sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="主导航">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <Sprout size={19} strokeWidth={1.9} />
          </div>
          <div className="brand-copy">
            <strong>耕策</strong>
            <span>JINGYE FIELD OPS</span>
          </div>
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="关闭导航">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button className="account-switcher" type="button" aria-label="切换账号">
          <span className="account-avatar">{account.ownerName.slice(0, 1)}</span>
          <span className="account-copy">
            <strong>{account.name}</strong>
            <small>{account.plan}</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>

        <nav className="primary-nav">
          {navItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${view === item.key ? "is-active" : ""}`}
                onClick={() => {
                  onSelectView(item.key);
                  onClose();
                }}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section-heading">
          <span>基地与地块</span>
          <button className="mini-icon-button" type="button" title="新增地块" aria-label="新增地块">
            <Plus size={15} />
          </button>
        </div>

        <div className="farm-tree">
          {farms.map((farm) => (
            <section className="farm-group" key={farm.id}>
              <div className="farm-name">
                <span className="farm-indicator" />
                <span>{farm.name}</span>
                <small>{farm.plots.reduce((sum, plot) => sum + plot.areaMu, 0)} 亩</small>
              </div>
              {farm.plots.map((plot) => (
                <button
                  type="button"
                  key={plot.id}
                  className={`plot-link ${activePlotId === plot.id ? "is-active" : ""}`}
                  onClick={() => {
                    onSelectPlot(plot.id);
                    onSelectView("decision");
                    onClose();
                  }}
                >
                  <span className="plot-line" />
                  <span>
                    <strong>{plot.name}</strong>
                    <small>{plot.areaMu} 亩 · {plot.rotation}</small>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <div className="sidebar-secondary-nav">
          {navItems.slice(4).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item ${view === item.key ? "is-active" : ""}`}
                onClick={() => {
                  onSelectView(item.key);
                  onClose();
                }}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <span className={`model-dot ${model.configured ? "is-live" : ""}`} />
          <span>
            <strong>{model.configured ? "模型已连接" : "确定性演示模式"}</strong>
            <small>农业智能决策</small>
          </span>
          <span className="demo-badge">DEMO</span>
        </div>
      </aside>
    </>
  );
}
