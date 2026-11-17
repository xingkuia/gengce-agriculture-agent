import { plotPosition } from "../geo.js";
import type { Plot, SoilSnapshot } from "../types.js";
import { round } from "../data.js";
import { readLocalSoil } from './local-soil.js';

interface SoilGridsLayer {
  name?: string;
  unit?: string;
  depths?: Array<{
    label?: string;
    values?: {
      mean?: number;
    };
  }>;
}

interface SoilGridsResponse {
  properties?: {
    layers?: SoilGridsLayer[];
  };
}

const SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";

export async function getSoil(
  plot: Plot,
  farm: { latitude: number; longitude: number },
  previous?: SoilSnapshot
): Promise<SoilSnapshot> {
  if(previous?.source==='manual')return {...previous,drainage:plot.drainage};
  const local=await readLocalSoil(plot,farm);
  if(local.values){const [ph,soc,sand,clay]=local.values;return {source:'soilgrids-local',fetchedAt:new Date().toISOString(),isFallback:false,texture:classifyTexture(clay,sand),clayPercent:clay,sandPercent:sand,ph,organicCarbon:soc,drainage:plot.drainage,note:`本地 ${local.dataset}，${local.depth} 表层均值，按地块坐标读取；有机碳单位 g/kg，砂粒和黏粒单位 %。这是栅格预测，并非现场实测，施肥前仍需测土校准。`};}
  if(!local.missing)return {...regionalPrior(plot),note:`${local.reason}；当前使用区域先验估算，并非现场实测。请录入测土报告校准。`};
  const timeout = Number(process.env.SOILGRIDS_TIMEOUT_MS ?? 4500);
  const params = new URLSearchParams();
  params.append("lon", String(plotPosition(plot, farm).longitude));
  params.append("lat", String(plotPosition(plot, farm).latitude));
  params.append("property", "clay");
  params.append("property", "sand");
  params.append("property", "phh2o");
  params.append("property", "soc");
  params.append("depth", "0-5cm");
  params.append("value", "mean");

  try {
    const response = await fetch(`${SOILGRIDS_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(timeout),
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`SoilGrids returned ${response.status}`);
    }
    const payload = (await response.json()) as SoilGridsResponse;
    const layers = payload.properties?.layers ?? [];
    const clay = layerValue(layers, "clay") / 10;
    const sand = layerValue(layers, "sand") / 10;
    const ph = layerValue(layers, "phh2o") / 10;
    const soc = layerValue(layers, "soc") / 10;
    if (!Number.isFinite(clay) || clay <= 0) {
      throw new Error("SoilGrids texture value unavailable");
    }
    return {
      source: "soilgrids",
      fetchedAt: new Date().toISOString(),
      isFallback: false,
      texture: classifyTexture(clay, sand),
      clayPercent: round(clay, 1),
      sandPercent: round(sand, 1),
      ph: round(ph > 0 ? ph : 6.4, 1),
      organicCarbon: round(soc > 0 ? soc : 8.7, 1),
      drainage: plot.drainage,
      note: "SoilGrids 0-5 cm 表层均值，正式施肥前仍需测土校准。"
    };
  } catch (error) {
    const reason=error instanceof Error && error.name==='TimeoutError' ? `在线土壤请求超过 ${timeout} 毫秒未完成`
      : error instanceof Error && /^SoilGrids returned \d+$/.test(error.message) ? `SoilGrids 服务返回 HTTP ${error.message.match(/\d+$/)?.[0]}`
      : error instanceof Error && error.message==='SoilGrids texture value unavailable' ? '在线土壤数据缺少有效质地指标'
      : error instanceof SyntaxError ? '在线土壤服务返回的数据格式无效'
      : '无法连接在线土壤服务';
    return {...regionalPrior(plot),note:`${reason}；当前使用区域先验估算，并非现场实测。施肥前请用最近一次测土报告校准。`};
  }
}

export function regionalPrior(plot: Plot): SoilSnapshot {
  const isPaddy = plot.rotation.includes("稻") || plot.currentCrop.includes("稻");
  return {
    source: "regional-prior",
    fetchedAt: new Date().toISOString(),
    isFallback: true,
    texture: isPaddy ? "壤质黏土" : plot.soilTexture || "粉砂质壤土",
    clayPercent: isPaddy ? 29.4 : 24.8,
    sandPercent: isPaddy ? 31.2 : 37.6,
    ph: 6.4,
    organicCarbon: 9.1,
    drainage: plot.drainage,
    note: "当前使用区域先验估算，未取得在线土壤属性，并非现场实测；施肥前请使用最近一次测土报告校准。"
  };
}

function layerValue(layers: SoilGridsLayer[], name: string): number {
  const layer = layers.find((entry) => entry.name === name);
  return layer?.depths?.[0]?.values?.mean ?? Number.NaN;
}

function classifyTexture(clay: number, sand: number): string {
  if (clay >= 35) return "黏质壤土";
  if (sand >= 55) return "砂质壤土";
  if (clay >= 25) return "壤质黏土";
  return "粉砂质壤土";
}
