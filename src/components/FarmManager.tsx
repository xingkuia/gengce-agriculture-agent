import { PlotLocationEditor } from "./PlotLocationEditor";
import { toWgs } from "../../server/geo.js";
import type { PlotLocation } from "../../server/geo.js";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, PencilLine, Trash2, RotateCcw, X, MapPinned } from "lucide-react";
import { getLocationHint, getWorkspace, manageFarm } from "../lib/api";
import type { Farm, Plot, Workspace } from "../types";

type Editor = { kind: "farms" | "plots"; id?: string; fields: Record<string, string>; location?: PlotLocation | null };
const emptyValue = (value?: string) => !value || value.trim() === "未填写" ? "" : value;
export function FarmManager({ onChanged, onSelectPlot, disabled = false, editFarmId, editFarmToken, onEditFarmOpened }: {
  onChanged: () => Promise<void>; onSelectPlot?: (id: string) => void; disabled?: boolean;
  editFarmId?: string; editFarmToken?: number; onEditFarmOpened?: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<{ kind: "farms" | "plots"; id: string; name: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hinting, setHinting] = useState(false);
  const [locationHint, setLocationHint] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  useEffect(() => { let active = true; getWorkspace().then(data => { if (active) setWorkspace(data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  useEffect(() => { panelRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }); }, [editor?.id, editor?.kind, removing?.id]);
  const reload = async () => { setWorkspace(await getWorkspace()); await onChanged(); };
  const editFarm = (farm?: Farm) => {
    setDrawing(false); setLocating(false);
    setError(""); setNotice(""); setRemoving(null); setHinting(false); setLocationHint("");
    setEditor({ kind: "farms", id: farm?.id, fields: { name: farm?.name ?? "", province: farm?.province ?? "", city: farm?.city ?? "", district: farm?.district ?? "", latitude: farm ? String(farm.latitude) : "", longitude: farm ? String(farm.longitude) : "", altitude: farm?.altitude === undefined ? "" : String(farm.altitude) } });
  };
  const editPlot = (farmId: string, plot?: Plot) => {
    setError(""); setNotice(""); setRemoving(null);
    setDrawing(false); setLocationHint(""); setHinting(false); setEditor({ kind: "plots", id: plot?.id, location: plot?.location ?? null, fields: { farmId, name: plot?.name ?? "", areaMu: plot ? String(plot.areaMu) : "", soilTexture: emptyValue(plot?.soilTexture), irrigation: emptyValue(plot?.irrigation), drainage: emptyValue(plot?.drainage), currentCrop: emptyValue(plot?.currentCrop), rotation: emptyValue(plot?.rotation), note: emptyValue(plot?.note) } });
  };
  useEffect(() => {
    if (!editFarmId || !workspace) return;
    const farm = workspace.farms.find(item => item.id === editFarmId);
    if (!farm) return;
    editFarm(farm);
    onEditFarmOpened?.();
  }, [editFarmId, editFarmToken, workspace, onEditFarmOpened]);
  const plotLatitude = editor?.kind === "plots" ? editor.location?.latitude : undefined;
  const plotLongitude = editor?.kind === "plots" ? editor.location?.longitude : undefined;
  const plotCoordinateSystem = editor?.kind === "plots" ? editor.location?.coordinateSystem : undefined;
  const needsSoilHint = editor?.kind === "plots" && Boolean(editor.location) && !editor.fields.soilTexture.trim();
  useEffect(() => {
    if (!needsSoilHint || plotLatitude === undefined || plotLongitude === undefined || !plotCoordinateSystem || disabled) {
      setHinting(false);
      if (!editor?.location) setLocationHint("");
      return;
    }
    let active = true;
    setHinting(true);
    setLocationHint("");
    const timer = window.setTimeout(() => {
      getLocationHint({ longitude: plotLongitude, latitude: plotLatitude, coordinateSystem: plotCoordinateSystem })
        .then(hint => {
          if (!active) return;
          if (!hint.soilTexture) {
            setLocationHint("该位置暂未取得可用的公开土壤质地，请按测土报告或田间经验填写。");
            return;
          }
          setEditor(current => {
            if (current?.kind !== "plots" || current.location?.latitude !== plotLatitude || current.location?.longitude !== plotLongitude || current.fields.soilTexture.trim()) return current;
            return { ...current, fields: { ...current.fields, soilTexture: hint.soilTexture } };
          });
          setLocationHint("已根据位置补全公开土壤质地估算；施肥前仍需测土校准。");
        })
        .catch(() => {
          if (active) setLocationHint("位置土壤数据暂不可用，请手动填写土壤质地。");
        })
        .finally(() => {
          if (active) setHinting(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [needsSoilHint, plotLatitude, plotLongitude, plotCoordinateSystem, disabled]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editor || busy || disabled || drawing || locating) return;
    setBusy(true); setError("");
    try {
      if(editor.kind === "farms" && (!editor.fields.latitude.trim() || !editor.fields.longitude.trim())) throw new Error("请搜索基地地址或点击地图选定位置，也可以展开手动输入坐标。");
      const body: Record<string, unknown> = { ...editor.fields };
      if(editor.kind === "plots") body.location=editor.location ?? null;
      for (const field of editor.kind === "farms" ? ["latitude", "longitude"] : ["areaMu"]) body[field] = Number(body[field]);
      if (editor.kind === "farms") body.altitude = editor.fields.altitude === "" ? null : Number(editor.fields.altitude);
      await manageFarm(editor.kind, editor.id, editor.id ? "PATCH" : "POST", body);
      await reload(); setEditor(null); setNotice("档案已保存，左侧列表已同步。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  const changeDeletion = async (kind: "farms" | "plots", id: string, restore = false) => {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try {
      await manageFarm(kind, id, restore ? "POST" : "DELETE", undefined, restore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      setBusy(false);
      return;
    }
    setRemoving(null);
    setNotice(restore ? "档案已恢复。" : "已移除，历史数据保留，可在已删除档案中恢复。");
    try {
      await reload();
    } catch (e) {
      setError(`操作已完成，但工作区同步失败${e instanceof Error ? `：${e.message}` : "，请重新打开页面。"}`);
    } finally {
      setBusy(false);
    }
  };
  const fields = editor?.kind === "farms" ? [
    ["name", "基地名称", "text"], ["province", "省份", "text"], ["city", "城市", "text"], ["district", "区县（选填）", "text"],
    ["latitude", "纬度（−90～90）", "number"], ["longitude", "经度（−180～180）", "number"], ["altitude", "海拔 / 米（选填）", "number"]
  ] : [["name", "地块名称", "text"], ["areaMu", "登记面积 / 亩", "number"], ["soilTexture", "土壤质地", "text"], ["irrigation", "灌溉条件", "text"], ["drainage", "排水条件", "text"], ["currentCrop", "当前作物", "text"], ["rotation", "轮作制度", "text"], ["note", "地块说明（选填）", "text"]];
  const optionalPlotFields = new Set(["soilTexture", "irrigation", "drainage", "currentCrop", "rotation"]);
  const fieldIsRequired = (key: string) => key === "name" || (editor?.kind === "plots" && key === "areaMu");
  const fieldPlaceholder = (key: string) => optionalPlotFields.has(key) || key === "note" || key === "district" || key === "altitude" ? "未填写" : undefined;
  const farmLocation = useMemo<PlotLocation|null>(()=>{
    if(editor?.kind!=="farms" || !editor.fields.longitude.trim() || !editor.fields.latitude.trim())return null;
    const longitude=Number(editor.fields.longitude),latitude=Number(editor.fields.latitude);
    return Number.isFinite(longitude)&&Number.isFinite(latitude)&&Math.abs(longitude)<=180&&Math.abs(latitude)<=90?{longitude,latitude,coordinateSystem:"WGS84",source:"manual",boundary:[],measuredAreaM2:null,areaSource:"manual"}:null;
  },[editor?.kind,editor?.fields.longitude,editor?.fields.latitude]);
  const farmMap = editor?.kind==='farms' && <PlotLocationEditor key={editor.id ?? 'new-farm'} mode="farm" showManual={false} value={farmLocation} areaMu="" disabled={busy || disabled} onArea={()=>{}} onDrawingChange={setDrawing} onResolving={setLocating} onRegion={region=>setEditor(current=>current?.kind==='farms'?{...current,fields:{...current.fields,...region}}:current)} onChange={location=>setEditor(current=>{
    if(current?.kind!=='farms')return current;
    const point=location?(location.coordinateSystem==='GCJ-02'?toWgs([location.longitude,location.latitude]):[location.longitude,location.latitude]):null;
    return {...current,fields:{...current.fields,longitude:point?String(point[0]):'',latitude:point?String(point[1]):''}};
  })} />;
  return <section className="farm-manager" aria-label="管理基地和地块">
    <div className="farm-manager-toolbar"><div><h3>管理基地与地块</h3><p>先建立基地，再添加地块；地块可单独定位、绘制边界；未定位时使用基地坐标。</p></div><button type="button" className="primary-button compact" onClick={() => editFarm()} disabled={busy || disabled}><Plus size={15} />新建基地</button></div>
    {error && <p role="alert" className="inline-error">{error}</p>}{notice && <p role="status" className="inline-success">{notice}</p>}
    {editor && <form ref={element => { panelRef.current = element; }} className="farm-edit-form" onSubmit={save} aria-label={editor.kind === "farms" ? "基地编辑表单" : "地块编辑表单"}>
      <div className="farm-editor-heading"><h3>{editor.id ? "编辑" : "新建"}{editor.kind === "farms" ? "基地" : "地块"}</h3><button type="button" aria-label="关闭编辑" disabled={busy} onClick={() => setEditor(null)}><X size={16} /></button></div>
      {editor.kind === "plots" && <p>所属基地：{workspace?.farms.find(f => f.id === editor.fields.farmId)?.name}</p>}
      <div className="farm-edit-fields">{fields.filter(([key])=>editor.kind!=="farms" || key==="name" || key==="altitude").map(([key, label, type]) => <label key={key}><span>{label}</span><input autoFocus={key === "name"} name={key} type={type} required={fieldIsRequired(key)} placeholder={fieldPlaceholder(key)} maxLength={key === "note" ? 1000 : 100} step="any" min={key === "latitude" ? -90 : key === "longitude" ? -180 : key === "areaMu" ? 0.01 : key === "altitude" ? -500 : undefined} max={key === "latitude" ? 90 : key === "longitude" ? 180 : key === "areaMu" ? 10000000 : key === "altitude" ? 9000 : undefined} value={editor.fields[key]} disabled={busy || disabled} onChange={event => setEditor({ ...editor, fields: { ...editor.fields, [key]: event.target.value }, location: key === "areaMu" && editor.location ? {...editor.location,areaSource:"manual"} : editor.location })} /></label>)}</div>
      {editor.kind === "plots" && <PlotLocationEditor key={editor.id ?? editor.fields.farmId} value={editor.location ?? null} farm={workspace?.farms.find(f=>f.id===editor.fields.farmId)} areaMu={editor.fields.areaMu} disabled={busy} onDrawingChange={setDrawing} onChange={location=>setEditor(current=>current?{...current,location}:null)} onArea={area=>setEditor(current=>current?{...current,fields:{...current.fields,areaMu:area}}:null)} />}
      {editor.kind === "plots" && <div className="farm-location-hint" aria-live="polite">
        <p>位置可辅助补全公开土壤质地；灌溉、排水、当前作物和轮作需按田间实际确认。</p>
        {hinting && <p role="status">正在根据位置估算土壤质地…</p>}
        {!hinting && locationHint && <p role="status">{locationHint}</p>}
      </div>}
      {farmMap}
      {editor.kind === "farms" && <>
        <p>所属地区会根据地图位置自动填写，也可手动调整。</p>
        <div className="farm-edit-fields">{["province","city","district"].map((key,i)=><label key={key}><span>{["省份","城市","区县（选填）"][i]}</span><input name={key} required={key!=="district"} maxLength={100} value={editor.fields[key]} disabled={busy} onChange={e=>setEditor({...editor,fields:{...editor.fields,[key]:e.target.value}})} /></label>)}</div>
        <details className="farm-manual-location"><summary>手动输入经纬度（备用）</summary><p>使用 WGS84（GPS）坐标；地图选点会自动换算。</p><div className="farm-edit-fields">{["longitude","latitude"].map((key,i)=><label key={key}><span>{["经度（−180～180）","纬度（−90～90）"][i]}</span><input name={key} type="number" step="any" min={i===0?-180:-90} max={i===0?180:90} value={editor.fields[key]} disabled={busy} onChange={e=>setEditor({...editor,fields:{...editor.fields,[key]:e.target.value}})}/></label>)}</div></details>
      </>}
      <div className="farm-edit-actions"><button type="button" className="secondary-button" onClick={() => setEditor(null)} disabled={busy}>取消</button><button className="primary-button compact" disabled={busy || disabled || drawing || locating}>{busy ? "正在保存…" : "保存档案"}</button></div>
    </form>}
    {removing && <div ref={element => { panelRef.current = element; }} className="farm-delete-confirm" role="alert"><strong>删除“{removing.name}”？</strong><p>{removing.kind === "farms" ? `此基地下的 ${removing.count} 个地块将一起从工作区移除。` : "此地块将从工作区移除。"}历史对话、方案和记录会保留，可恢复后继续使用。</p><div className="farm-edit-actions"><button type="button" className="secondary-button" onClick={() => setRemoving(null)} disabled={busy}>取消</button><button type="button" className="primary-button compact" disabled={busy || disabled} onClick={() => void changeDeletion(removing.kind, removing.id)}>{busy ? "正在删除…" : "确认删除"}</button></div></div>}
    {!workspace && !error && <p role="status">正在读取基地档案…</p>}
    {workspace?.farms.map(farm => <article className="farm-management-row" key={farm.id}>
      <div className="farm-management-heading"><MapPinned size={18} /><div><h4>{farm.name}</h4><p>{farm.province} · {farm.city} · {farm.district} · {farm.plots.length} 个地块</p></div><div className="farm-row-actions"><button type="button" disabled={busy || disabled} onClick={() => editFarm(farm)} aria-label={`编辑基地 ${farm.name}`}><PencilLine size={14} />编辑</button><button type="button" disabled={busy || disabled} onClick={() => { setEditor(null); setRemoving({ kind: "farms", id: farm.id, name: farm.name, count: farm.plots.length }); }} aria-label={`删除基地 ${farm.name}`}><Trash2 size={14} />删除</button><button type="button" disabled={busy || disabled} onClick={() => editPlot(farm.id)}><Plus size={14} />添加地块</button></div></div>
      {!farm.plots.length && <p className="farm-empty">还没有地块，添加后即可开始分析。</p>}
      {farm.plots.map(plot => <div className="farm-management-plot" key={plot.id}><button type="button" className="farm-plot-select" disabled={!onSelectPlot || busy || disabled} onClick={() => onSelectPlot?.(plot.id)}><strong>{plot.name}</strong><small>{plot.areaMu} 亩 · {plot.location ? "已独立定位" : "待定位（参考基地）"} · {plot.currentCrop} · {plot.rotation}</small></button><div className="farm-row-actions"><button type="button" disabled={busy || disabled} aria-label={`编辑地块 ${plot.name}`} onClick={() => editPlot(farm.id, plot)}><PencilLine size={14} />编辑</button><button type="button" disabled={busy || disabled} aria-label={`删除地块 ${plot.name}`} onClick={() => { setEditor(null); setRemoving({ kind: "plots", id: plot.id, name: plot.name, count: 0 }); }}><Trash2 size={14} />删除</button></div></div>)}
    </article>)}
    {workspace && !workspace.farms.length && <p className="farm-empty">尚无基地。新建基地并添加第一块地，即可开始使用农业助手。</p>}
    {workspace && (workspace.deletedFarms.length > 0 || workspace.deletedPlots.length > 0) && <div className="farm-deleted"><button type="button" className="secondary-button" onClick={() => setShowDeleted(v => !v)} aria-expanded={showDeleted}>已删除档案（{workspace.deletedFarms.length + workspace.deletedPlots.length}）</button>{showDeleted && <div>{[...workspace.deletedFarms.map(f => ({ ...f, kind: "farms" as const })), ...workspace.deletedPlots.map(p => ({ ...p, kind: "plots" as const }))].map(item => <div key={item.id} className="farm-restore-row"><span>{item.kind === "farms" ? "基地" : "地块"} · {item.name}</span><button type="button" disabled={busy || disabled} onClick={() => void changeDeletion(item.kind, item.id, true)}><RotateCcw size={14} />恢复</button></div>)}</div>}</div>}
  </section>;
}
