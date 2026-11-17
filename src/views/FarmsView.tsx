import { FarmManager } from "../components/FarmManager";
import {
  Check,
  CloudSun,
  Database,
  Droplets,
  MapPinned,
  PencilLine,
  RefreshCw,
  Ruler,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { refreshPlotContext, saveManualSoil } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Account, Farm, Plot, PlotContext } from "../types";

interface FarmsViewProps {
  disabled?: boolean;
  account: Account;
  farms: Array<Farm & { plots: Plot[] }>;
  activePlotId: string;
  context: PlotContext;
  plot: Plot;
  farm: Farm;
  editFarmId?: string;
  editFarmToken?: number;
  onEditFarmOpened?: () => void;
  onSelectPlot: (plotId: string) => void;
  onChanged: () => Promise<void>;
}

export function FarmsView({
  disabled = false,
  account,
  farms,
  activePlotId,
  context,
  plot,
  farm,
  editFarmId,
  editFarmToken,
  onEditFarmOpened,
  onSelectPlot,
  onChanged
}: FarmsViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [soil, setSoil] = useState({
    texture: context.soil.texture,
    clayPercent: String(context.soil.clayPercent),
    sandPercent: String(context.soil.sandPercent),
    ph: String(context.soil.ph),
    organicCarbon: String(context.soil.organicCarbon),
    drainage: context.soil.drainage,
    note: context.soil.note
  });

  useEffect(() => {
    setSoil({
      texture: context.soil.texture,
      clayPercent: String(context.soil.clayPercent),
      sandPercent: String(context.soil.sandPercent),
      ph: String(context.soil.ph),
      organicCarbon: String(context.soil.organicCarbon),
      drainage: context.soil.drainage,
      note: context.soil.note
    });
  }, [context]);

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      await refreshPlotContext(plot.id);
      await onChanged();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "数据刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const submitSoil = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await saveManualSoil(plot.id, {
        texture: soil.texture,
        clayPercent: Number(soil.clayPercent),
        sandPercent: Number(soil.sandPercent),
        ph: Number(soil.ph),
        organicCarbon: Number(soil.organicCarbon),
        drainage: soil.drainage,
        note: soil.note
      });
      await onChanged();
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "测土数据保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="view farms-view">
      <header className="view-heading-row">
        <div>
          <div className="view-kicker"><span>{account.name}</span><span>一个账号 · {farms.length} 个基地</span></div>
          <h2>基地与地块档案</h2>
          <p>位置、地块约束和测土数据是每次专家决策的基础上下文。</p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          刷新天气与土壤
        </button>
      </header>

      <FarmManager
        disabled={disabled}
        onChanged={onChanged}
        onSelectPlot={onSelectPlot}
        editFarmId={editFarmId}
        editFarmToken={editFarmToken}
        onEditFarmOpened={onEditFarmOpened}
      />

      <div className="farm-detail-grid">
        <section className="plot-profile-panel">
          <div className="section-heading compact-heading">
            <div>
              <h2>{plot.name} · 地块档案</h2>
              <p>位置只用于获取公开气象与土壤数据；不接入传感器或设备。</p>
            </div>
            <span className="plain-tag">{plot.location ? "地块独立坐标" : "参考基地坐标 · 地块待定位"}</span>
          </div>
          <div className="profile-map-row">
            <div className="profile-coordinate-card">
              <MapPinned size={20} />
              <span>经度，纬度 · {plot.location?.coordinateSystem ?? "WGS84"}</span>
              <strong>{(plot.location?.longitude ?? farm.longitude).toFixed(6)}, {(plot.location?.latitude ?? farm.latitude).toFixed(6)}</strong>
              <small>{farm.district} · 海拔 {farm.altitude ?? "未填"} m</small>
            </div>
            <div className="profile-fact">
              <Ruler size={18} />
              <span>登记面积</span>
              <strong>{plot.areaMu} 亩</strong>
            </div>
            <div className="profile-fact">
              <Droplets size={18} />
              <span>灌溉 / 排水</span>
              <strong>{plot.irrigation} / {plot.drainage}</strong>
            </div>
          </div>
          <div className="profile-notes">
            <div><span>当前作物</span><strong>{plot.currentCrop}</strong></div>
            <div><span>轮作制度</span><strong>{plot.rotation}</strong></div>
            <div><span>地块说明</span><strong>{plot.note}</strong></div>
          </div>
        </section>

        <section className="data-provenance-panel">
          <div className="side-title"><Database size={16} /><h3>数据来源</h3></div>
          <div className="source-card-row">
            <CloudSun size={18} />
            <div>
              <span>天气与蒸散</span>
              <strong>{context.weather.source === "open-meteo" ? "Open-Meteo" : "缓存演示数据"}</strong>
              <small>{formatDateTime(context.weather.fetchedAt)} 更新</small>
            </div>
            <span className={`source-status ${context.weather.isFallback ? "is-warning" : ""}`}>
              {context.weather.isFallback ? "降级" : "在线"}
            </span>
          </div>
          <div className="source-card-row">
            <Database size={18} />
            <div>
              <span>表层土壤</span>
              <strong>
                {context.soil.source === "soilgrids-local" ? "本地 SoilGrids · 0–5 cm" : context.soil.source === "soilgrids"
                  ? "SoilGrids 0–5 cm"
                  : context.soil.source === "manual"
                    ? "用户测土数据"
                    : "湖北区域先验"}
              </strong>
              <small>{formatDateTime(context.soil.fetchedAt)} 更新</small>
            </div>
            <span className={`source-status ${context.soil.isFallback ? "is-warning" : ""}`}>
              {context.soil.isFallback ? "先验" : "已校准"}
            </span>
          </div>
          <p className="provenance-note">{context.soil.note}</p>
        </section>
      </div>

      <form className="soil-form" onSubmit={submitSoil}>
        <div className="soil-form-heading">
          <div>
            <PencilLine size={17} />
            <h3>录入最近一次测土结果</h3>
          </div>
          <p>本地测土值会替换公开估算，并明确标记为“已校准”。</p>
        </div>
        <div className="form-grid">
          <label>
            <span>土壤质地</span>
            <input value={soil.texture} onChange={(event) => setSoil({ ...soil, texture: event.target.value })} />
          </label>
          <label>
            <span>黏粒占比（%）</span>
            <input type="number" min="0" max="100" step="0.1" value={soil.clayPercent} onChange={(event) => setSoil({ ...soil, clayPercent: event.target.value })} />
          </label>
          <label>
            <span>砂粒占比（%）</span>
            <input type="number" min="0" max="100" step="0.1" value={soil.sandPercent} onChange={(event) => setSoil({ ...soil, sandPercent: event.target.value })} />
          </label>
          <label>
            <span>pH</span>
            <input type="number" min="0" max="14" step="0.1" value={soil.ph} onChange={(event) => setSoil({ ...soil, ph: event.target.value })} />
          </label>
          <label>
            <span>有机碳（g/kg）</span>
            <input type="number" min="0" step="0.1" value={soil.organicCarbon} onChange={(event) => setSoil({ ...soil, organicCarbon: event.target.value })} />
          </label>
          <label>
            <span>排水条件</span>
            <select value={soil.drainage} onChange={(event) => setSoil({ ...soil, drainage: event.target.value })}>
              <option>良好</option>
              <option>中等</option>
              <option>较差</option>
            </select>
          </label>
          <label className="form-full">
            <span>测土来源和说明</span>
            <input value={soil.note} onChange={(event) => setSoil({ ...soil, note: event.target.value })} />
          </label>
        </div>
        {error && <p className="inline-error">{error}</p>}
        {saved && <p className="inline-success"><Check size={14} />测土数据已保存，下一次决策将优先使用。</p>}
        <div className="form-actions">
          <span>数据保存在本机应用数据库中。</span>
          <button className="primary-button compact" type="submit" disabled={saving}>
            {saving ? <span className="button-spinner" /> : <Check size={15} />}
            保存测土数据
          </button>
        </div>
      </form>
    </div>
  );
}
