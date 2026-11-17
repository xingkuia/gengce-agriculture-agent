import { CloudSun, MapPin, Menu, PanelRight, RefreshCw } from "lucide-react";
import type { Farm, Plot, PlotContext } from "../types";

interface TopbarProps {
  plot: Plot;
  farm: Farm;
  context: PlotContext;
  title: string;
  refreshing: boolean;
  onOpenSidebar: () => void;
  onOpenTrace: () => void;
  onRefresh: () => void;
}

export function Topbar({
  plot,
  farm,
  context,
  title,
  refreshing,
  onOpenSidebar,
  onOpenTrace,
  onRefresh
}: TopbarProps) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu-button" type="button" onClick={onOpenSidebar} aria-label="打开导航">
        <Menu size={19} />
      </button>
      <div className="location-heading">
        <div className="breadcrumb">
          <span>{farm.name}</span>
          <span>/</span>
          <span>{plot.name}</span>
        </div>
        <h1>{title}</h1>
      </div>
      <div className="topbar-context">
        <div className="coordinate-pill" title={`${farm.latitude}, ${farm.longitude}`}>
          <MapPin size={14} aria-hidden="true" />
          <span>{farm.city} · {farm.district}</span>
        </div>
        <div className="weather-pill">
          <CloudSun size={16} aria-hidden="true" />
          <strong>{context.weather.temperature}°</strong>
          <span>{context.weather.condition}</span>
          <span className="weather-divider" />
          <span>{context.weather.humidity}% 湿度</span>
        </div>
        <button
          className={`icon-button ${refreshing ? "is-spinning" : ""}`}
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="刷新天气与土壤"
          aria-label="刷新天气与土壤"
        >
          <RefreshCw size={17} />
        </button>
        <button className="icon-button trace-toggle" type="button" onClick={onOpenTrace} aria-label="打开 Agent 轨迹">
          <PanelRight size={18} />
        </button>
      </div>
    </header>
  );
}
