import { db, readPlotContext, writePlotContext } from "../server/db.js";
import { getWeather } from "../server/tools/weather.js";
import type { Plot } from "../server/types.js";

interface PlotWeatherRow {
  plot_id: string;
  farm_id: string;
  name: string;
  area_mu: number;
  soil_texture: string;
  irrigation: string;
  drainage: string;
  current_crop: string;
  rotation: string;
  note: string;
  location_json: string | null;
  latitude: number;
  longitude: number;
}

const rows = db
  .prepare(`
    SELECT
      p.id AS plot_id,
      p.farm_id,
      p.name,
      p.area_mu,
      p.soil_texture,
      p.irrigation,
      p.drainage,
      p.current_crop,
      p.rotation,
      p.note,
      p.location_json,
      f.latitude,
      f.longitude
    FROM plot p
    JOIN farm f ON f.id = p.farm_id
    WHERE p.deleted_at IS NULL AND f.deleted_at IS NULL
    ORDER BY p.created_at
  `)
  .all() as unknown as PlotWeatherRow[];

try {
  if (!rows.length) {
    throw new Error("没有可刷新的地块");
  }

  for (const row of rows) {
    const context = readPlotContext(row.plot_id);
    if (!context) {
      throw new Error(`${row.name}缺少地块上下文，请先在应用中完成初始化`);
    }

    const plot: Plot = {
      id: row.plot_id,
      farmId: row.farm_id,
      name: row.name,
      areaMu: Number(row.area_mu),
      soilTexture: row.soil_texture,
      irrigation: row.irrigation,
      drainage: row.drainage,
      currentCrop: row.current_crop,
      rotation: row.rotation,
      note: row.note,
      location: row.location_json ? JSON.parse(row.location_json) : null
    };
    const weather = await getWeather(plot, {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude)
    });

    if (weather.isFallback) {
      process.exitCode = 1;
      console.error(`${row.name}: 在线天气获取失败，保留原数据`);
      continue;
    }

    writePlotContext(row.plot_id, {
      ...context,
      weather,
      updatedAt: new Date().toISOString()
    });
    console.log(
      JSON.stringify({
        plot: row.name,
        source: weather.source,
        temperature: weather.temperature,
        condition: weather.condition,
        fetchedAt: weather.fetchedAt
      })
    );
  }
} finally {
  db.close();
}
