import type { IncomingMessage, ServerResponse } from "node:http";
import { db, makeId, writePlotContext, readPlotContext } from "./db.js";
import { fallbackWeather } from "./tools/weather.js";
import { getSoil, regionalPrior } from "./tools/soil.js";
import type { Plot } from "./types.js";
import { polygonArea, validBoundary, type PlotLocation } from "./geo.js";

export function migrateFarmManagement() {
  if (!(db.prepare('PRAGMA table_info(farm)').all() as Array<{name:string}>).some(c=>c.name==='is_pinned')) db.exec('ALTER TABLE farm ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
  if (!(db.prepare('PRAGMA table_info(plot)').all() as Array<{name:string}>).some(c=>c.name==='location_json')) db.exec('ALTER TABLE plot ADD COLUMN location_json TEXT');
  for (const table of ["farm", "plot"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(c => c.name === "deleted_at")) db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
  }
  db.prepare(`
    UPDATE plot SET
      soil_texture = CASE WHEN soil_texture = '未填写' THEN '' ELSE soil_texture END,
      irrigation = CASE WHEN irrigation = '未填写' THEN '' ELSE irrigation END,
      drainage = CASE WHEN drainage = '未填写' THEN '' ELSE drainage END,
      current_crop = CASE WHEN current_crop = '未填写' THEN '' ELSE current_crop END,
      rotation = CASE WHEN rotation = '未填写' THEN '' ELSE rotation END,
      note = CASE WHEN note = '未填写' THEN '' ELSE note END
  `).run();

  // Older builds only created a context for the first demo plot. Fill any
  // missing contexts without touching existing manual soil or weather data.
  const missingContexts = db.prepare(`
    SELECT p.*
    FROM plot p
    LEFT JOIN plot_context c ON c.plot_id = p.id
    WHERE c.plot_id IS NULL
  `).all() as Array<Record<string, unknown>>;
  for (const row of missingContexts) {
    const plot = mapManagedPlot(row);
    writePlotContext(plot.id, {
      weather: fallbackWeather(plot.id),
      soil: regionalPrior(plot),
      updatedAt: new Date().toISOString()
    });
  }
}
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function text(value: unknown, name: string, required = true, max = 100): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) fail(`请填写有效的${name}（最多 ${max} 字）`);
  return value.trim();
}
function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${name}应在 ${min} 到 ${max} 之间`);
  return value;
}
function transaction(action: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try { action(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function mapManagedPlot(row: Record<string, unknown>): Plot {
  return { id: String(row.id), farmId: String(row.farm_id), name: String(row.name), areaMu: Number(row.area_mu), location: row.location_json ? JSON.parse(String(row.location_json)) : null, soilTexture: String(row.soil_texture), irrigation: String(row.irrigation), drainage: String(row.drainage), currentCrop: String(row.current_crop), rotation: String(row.rotation), note: String(row.note) };
}
function resetContext(plot: Plot, locationChanged = false) {
  const old = readPlotContext(plot.id);
  writePlotContext(plot.id, { weather: locationChanged ? fallbackWeather(plot.id) : old?.weather ?? fallbackWeather(plot.id), soil: old?.soil.source === "manual" ? { ...old.soil, drainage: plot.drainage } : regionalPrior(plot), updatedAt: new Date(0).toISOString() });
}
export async function handleFarmApi(request: IncomingMessage, response: ServerResponse, url: URL,
  readJson: (request: IncomingMessage) => Promise<Record<string, unknown>>, send: (response: ServerResponse, status: number, data: unknown) => void): Promise<boolean> {
  const path = url.pathname, method = request.method;
  if (path !== "/api/workspace" && !/^\/api\/(farms|plots)(\/[^/]+)?(\/(restore|pin))?$/.test(path)) return false;
  // Let existing /plots/:id/context, soil and other business endpoints continue.
  try {
    const account = db.prepare("SELECT * FROM account LIMIT 1").get() as Record<string, unknown>;
    if(path === "/api/plots/location-hints" && method === "POST") {
      const body = await readJson(request);
      const longitude = number(body.longitude, "经度", -180, 180);
      const latitude = number(body.latitude, "纬度", -90, 90);
      const coordinateSystem = body.coordinateSystem === "GCJ-02" ? "GCJ-02" : "WGS84";
      const location: PlotLocation = {
        longitude,
        latitude,
        coordinateSystem,
        source: "map",
        boundary: [],
        measuredAreaM2: null,
        areaSource: "manual"
      };
      const plot: Plot = {
        id: "location-hint",
        farmId: "location-hint",
        name: "位置估算",
        areaMu: 1,
        location,
        soilTexture: "",
        irrigation: "",
        drainage: "",
        currentCrop: "",
        rotation: "",
        note: ""
      };
      const soil = await getSoil(plot, { longitude, latitude });
      send(response, 200, {
        soilTexture: soil.isFallback ? "" : soil.texture,
        source: soil.source,
        isFallback: soil.isFallback,
        note: soil.note
      });
      return true;
    }
    const pinMatch=path.match(/^\/api\/farms\/([^/]+)\/pin$/);
    if(pinMatch && method==='PATCH') {
      const body=await readJson(request);
      if(typeof body.isPinned!=='boolean')fail('置顶状态必须为布尔值');
      const result=db.prepare('UPDATE farm SET is_pinned=? WHERE id=? AND account_id=? AND deleted_at IS NULL').run(body.isPinned?1:0,decodeURIComponent(pinMatch[1]),String(account.id));
      if(!result.changes)fail('未找到基地',404);
      send(response,200,{isPinned:body.isPinned});return true;
    }
    if (path === "/api/workspace" && method === "GET") {
      const farms = db.prepare("SELECT * FROM farm WHERE account_id = ? ORDER BY created_at, id").all(String(account.id)) as Array<Record<string, unknown>>;
      const plots = db.prepare("SELECT p.* FROM plot p JOIN farm f ON f.id=p.farm_id WHERE f.account_id=? ORDER BY p.created_at, p.id").all(String(account.id)) as Array<Record<string, unknown>>;
      const mapFarm = (f: Record<string, unknown>) => ({ isPinned: Boolean(f.is_pinned), id: String(f.id), accountId: String(f.account_id), name: String(f.name), province: String(f.province), city: String(f.city), district: String(f.district), latitude: Number(f.latitude), longitude: Number(f.longitude), altitude: f.altitude === null ? undefined : Number(f.altitude), plots: plots.filter(p => p.farm_id === f.id && !p.deleted_at).map(mapManagedPlot) });
      send(response, 200, { account: { id: String(account.id), name: String(account.name), ownerName: String(account.owner_name), plan: String(account.plan), isDemo: Boolean(account.is_demo) }, farms: farms.filter(f => !f.deleted_at).map(mapFarm), deletedFarms: farms.filter(f => f.deleted_at).map(mapFarm), deletedPlots: plots.filter(p => p.deleted_at && farms.some(f => f.id === p.farm_id && !f.deleted_at)).map(mapManagedPlot) });
      return true;
    }
    const match = path.match(/^\/api\/(farms|plots)(?:\/([^/]+))?(\/restore)?$/);
    if (!match) return false;
    const table = match[1] === "farms" ? "farm" : "plot", id = match[2], restore = Boolean(match[3]);
    if (!(["POST", "PATCH", "DELETE"].includes(method ?? ""))) return false;
    const row = id ? db.prepare(`SELECT x.* FROM ${table} x ${table === "plot" ? "JOIN farm f ON f.id=x.farm_id" : ""} WHERE x.id=? AND ${table === "plot" ? "f" : "x"}.account_id=?`).get(id, String(account.id)) as Record<string, unknown> | undefined : undefined;
    if (id && !row) fail("未找到基地或地块", 404);
    if (restore && method === "POST" && row) {
      if (table === "plot" && !(db.prepare("SELECT id FROM farm WHERE id=? AND deleted_at IS NULL").get(String(row.farm_id)))) fail("请先恢复所属基地", 409);
      const duplicate = table === "farm" ? db.prepare("SELECT id FROM farm WHERE account_id=? AND name=? AND id!=? AND deleted_at IS NULL").get(String(account.id), row.name as string, id!) : db.prepare("SELECT id FROM plot WHERE farm_id=? AND name=? AND id!=? AND deleted_at IS NULL").get(String(row.farm_id), row.name as string, id!);
      if (duplicate) fail("存在同名档案，请先修改现有名称再恢复", 409);
      db.prepare(`UPDATE ${table} SET deleted_at=NULL WHERE id=?`).run(id!);
      send(response, 200, { restored: true }); return true;
    }
    if (row?.deleted_at) fail("档案已删除，请先恢复", 409);
    if (method === "DELETE" && row) {
      const running = table === "farm" ? db.prepare("SELECT r.id FROM task_run r JOIN plot p ON p.id=r.plot_id WHERE p.farm_id=? AND r.status='running'").get(id!) : db.prepare("SELECT id FROM task_run WHERE plot_id=? AND status='running'").get(id!);
      if (running) fail("该基地或地块有正在运行的任务，请结束后再删除", 409);
      db.prepare(`UPDATE ${table} SET deleted_at=? WHERE id=?`).run(new Date().toISOString(), id!);
      send(response, 200, { deleted: true }); return true;
    }
    if (restore || (method === "PATCH" && !id) || (method === "POST" && id)) return false;
    const body = await readJson(request);
    const name = text(body.name, table === "farm" ? "基地名称" : "地块名称");
    if (table === "farm") {
      const province = text(body.province, "省份"), city = text(body.city, "城市"), district = text(body.district ?? "", "区县", false);
      const lat = number(body.latitude, "纬度", -90, 90), lon = number(body.longitude, "经度", -180, 180);
      const altitude = body.altitude === null || body.altitude === undefined ? null : number(body.altitude, "海拔", -500, 9000);
      if (db.prepare("SELECT id FROM farm WHERE account_id=? AND name=? AND id!=? AND deleted_at IS NULL").get(String(account.id), name, id ?? "")) fail("已有同名基地", 409);
      const nextId = id ?? makeId("farm");
      transaction(() => {
        if (id) db.prepare("UPDATE farm SET name=?,province=?,city=?,district=?,latitude=?,longitude=?,altitude=? WHERE id=?").run(name, province, city, district, lat, lon, altitude, id);
        else db.prepare("INSERT INTO farm (id,account_id,name,province,city,district,latitude,longitude,altitude,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(nextId, String(account.id), name, province, city, district, lat, lon, altitude, new Date().toISOString());
        if (row && (Number(row.latitude) !== lat || Number(row.longitude) !== lon || row.province !== province)) {
          for (const p of db.prepare("SELECT * FROM plot WHERE farm_id=?").all(nextId) as Array<Record<string, unknown>>) resetContext(mapManagedPlot(p), true);
        }
      });
      send(response, id ? 200 : 201, { id: nextId }); return true;
    }
    const farmId = text(body.farmId, "所属基地");
    if (row && row.farm_id !== farmId) fail("已有地块暂不支持转移基地");
    if (!db.prepare("SELECT id FROM farm WHERE id=? AND account_id=? AND deleted_at IS NULL").get(farmId, String(account.id))) fail("请选择有效的基地");
    const area = number(body.areaMu, "种植面积（亩）", 0.01, 10000000);
    let location: PlotLocation | null = row?.location_json ? JSON.parse(String(row.location_json)) : null;
    if ('location' in body) {
      if(body.location===null) location=null;
      else {
        const l=body.location as PlotLocation;
        if(!l || !['GCJ-02','WGS84'].includes(l.coordinateSystem) || !['manual','map','boundary'].includes(l.source) || !['manual','boundary'].includes(l.areaSource)) fail('请检查地块坐标类型和来源');
        const longitude=number(l.longitude,'地块经度',-180,180),latitude=number(l.latitude,'地块纬度',-90,90);
        if(!Array.isArray(l.boundary) || (l.boundary.length && !validBoundary(l.boundary))) fail('边界应至少有 3 个不重复的顶点，不能交叉，面积在 1 平方米至 1000 平方公里之间');
        if(l.areaSource==='boundary' && !l.boundary.length) fail('请先绘制边界再采用测算面积');
        location={longitude,latitude,coordinateSystem:l.coordinateSystem,source:l.source,boundary:l.boundary,measuredAreaM2:l.boundary.length?polygonArea(l.boundary):null,areaSource:l.areaSource};
      }
    }
    const soil = text(body.soilTexture ?? "", "土壤质地", false), irrigation = text(body.irrigation ?? "", "灌溉条件", false), drainage = text(body.drainage ?? "", "排水条件", false);
    const crop = text(body.currentCrop ?? "", "当前作物", false), rotation = text(body.rotation ?? "", "轮作制度", false), note = text(body.note ?? "", "备注", false, 1000);
    if (db.prepare("SELECT id FROM plot WHERE farm_id=? AND name=? AND id!=? AND deleted_at IS NULL").get(farmId, name, id ?? "")) fail("该基地已有同名地块", 409);
    const nextId = id ?? makeId("plot");
    transaction(() => {
      if (id) db.prepare("UPDATE plot SET name=?,area_mu=?,soil_texture=?,irrigation=?,drainage=?,current_crop=?,rotation=?,note=? WHERE id=?").run(name, area, soil, irrigation, drainage, crop, rotation, note, id);
      else db.prepare("INSERT INTO plot (id,farm_id,name,area_mu,soil_texture,irrigation,drainage,current_crop,rotation,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(nextId, farmId, name, area, soil, irrigation, drainage, crop, rotation, note, new Date().toISOString());
      db.prepare('UPDATE plot SET location_json=? WHERE id=?').run(location?JSON.stringify(location):null,nextId);
      const locationChanged=(row?.location_json ?? null)!==(location?JSON.stringify(location):null);
      if (!row || row.soil_texture !== soil || row.drainage !== drainage || locationChanged) resetContext({ id: nextId, farmId, name, areaMu: area, location, soilTexture: soil, irrigation, drainage, currentCrop: crop, rotation, note },locationChanged);
    });
    send(response, id ? 200 : 201, { id: nextId }); return true;
  } catch (error) {
    send(response, error instanceof Error && "status" in error ? Number(error.status) : 500, { message: error instanceof Error ? error.message : "档案保存失败" });
    return true;
  }
}
