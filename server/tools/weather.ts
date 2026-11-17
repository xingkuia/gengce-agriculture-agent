import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { plotPosition } from "../geo.js";
import type { Plot, WeatherDay, WeatherSnapshot, WeatherWarning } from "../types.js";
import { round, toDateString } from "../data.js";

const DEFAULT_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// Some Windows networks advertise an unreachable Open-Meteo IPv6 route.
if (getDefaultResultOrder() === "verbatim") {
  setDefaultResultOrder("ipv4first");
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    et0_fao_evapotranspiration?: number[];
    soil_temperature_0cm?: number[];
    soil_moisture_0_to_1cm?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
    et0_fao_evapotranspiration_sum?: number[];
  };
}

export async function getWeather(
  plot: Plot,
  farm: { latitude: number; longitude: number }
): Promise<WeatherSnapshot> {
  const configuredTimeout = Number(process.env.OPEN_METEO_TIMEOUT_MS ?? 6000);
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 6000;
  const position = plotPosition(plot, farm);
  const openMeteoUrl = process.env.OPEN_METEO_URL?.trim() || DEFAULT_OPEN_METEO_URL;
  const params = new URLSearchParams({
    latitude: String(position.latitude),
    longitude: String(position.longitude),
    current:
      "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    hourly: "et0_fao_evapotranspiration,soil_temperature_0cm,soil_moisture_0_to_1cm",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration_sum",
    forecast_days: "7",
    timezone: "Asia/Shanghai"
  });

  try {
    const response = await fetch(`${openMeteoUrl}?${params.toString()}`, {
      signal: AbortSignal.timeout(timeout),
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }
    const payload = (await response.json()) as OpenMeteoResponse;
    if (!payload.current || !payload.daily?.time?.length) {
      throw new Error("Open-Meteo response is incomplete");
    }

    const daily = mapDaily(payload);
    const temperature = requiredFinite(
      payload.current.temperature_2m,
      "current.temperature_2m"
    );
    const humidity = requiredFinite(
      payload.current.relative_humidity_2m,
      "current.relative_humidity_2m"
    );
    const windSpeed = requiredFinite(
      payload.current.wind_speed_10m,
      "current.wind_speed_10m"
    );
    const rawSoilMoisture = firstFinite(payload.hourly?.soil_moisture_0_to_1cm);
    if (rawSoilMoisture === undefined) {
      throw new Error("Open-Meteo response is missing hourly.soil_moisture_0_to_1cm");
    }
    const soilTemperature = firstFinite(payload.hourly?.soil_temperature_0cm);
    if (soilTemperature === undefined) {
      throw new Error("Open-Meteo response is missing hourly.soil_temperature_0cm");
    }
    const et0 =
      firstFinite(payload.hourly?.et0_fao_evapotranspiration) ??
      firstFinite(payload.daily?.et0_fao_evapotranspiration_sum);
    if (et0 === undefined) {
      throw new Error("Open-Meteo response is missing evapotranspiration data");
    }

    const snapshot: WeatherSnapshot = {
      source: "open-meteo",
      fetchedAt: new Date().toISOString(),
      isFallback: false,
      condition: weatherText(payload.current.weather_code),
      temperature: round(temperature, 1),
      humidity: round(humidity, 0),
      windSpeed: round(windSpeed, 1),
      precipitation: round(payload.current.precipitation ?? 0, 1),
      et0: round(et0, 1),
      soilTemperature: round(soilTemperature, 1),
      soilMoisture: round(rawSoilMoisture * 100, 1),
      daily,
      warnings: buildWarnings(daily, et0)
    };
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[weather] Open-Meteo unavailable; using demo data: ${message}`);
    return fallbackWeather(plot.id);
  }
}

function mapDaily(payload: OpenMeteoResponse): WeatherDay[] {
  const daily = payload.daily;
  if (!daily?.time) {
    return [];
  }
  return daily.time.map((date, index) => {
    const tempMax = requiredFinite(
      daily.temperature_2m_max?.[index],
      `daily.temperature_2m_max[${index}]`
    );
    const tempMin = requiredFinite(
      daily.temperature_2m_min?.[index],
      `daily.temperature_2m_min[${index}]`
    );
    const precipitation = requiredFinite(
      daily.precipitation_sum?.[index],
      `daily.precipitation_sum[${index}]`
    );
    const windMax = requiredFinite(
      daily.wind_speed_10m_max?.[index],
      `daily.wind_speed_10m_max[${index}]`
    );
    return {
      date,
      weather: weatherText(daily.weather_code?.[index]),
      tempMax: round(tempMax, 1),
      tempMin: round(tempMin, 1),
      precipitation: round(precipitation, 1),
      windMax: round(windMax, 1)
    };
  });
}

function buildWarnings(daily: WeatherDay[], et0: number): WeatherWarning[] {
  const warnings: WeatherWarning[] = [];
  const minTemp = Math.min(...daily.map((day) => day.tempMin));
  const maxWind = Math.max(...daily.map((day) => day.windMax));
  const nextThreeRain = daily
    .slice(0, 3)
    .reduce((total, day) => total + day.precipitation, 0);

  if (minTemp <= 2) {
    warnings.push({
      id: "frost",
      level: minTemp <= 0 ? "severe" : "attention",
      title: "低温过程",
      detail: `未来 7 日最低气温约 ${round(minTemp, 1)}°C，播后和苗期地块需提前检查防冻措施。`
    });
  }
  if (maxWind >= 13.9) {
    warnings.push({
      id: "wind",
      level: "attention",
      title: "大风风险",
      detail: `阵风可能达到 ${round(maxWind, 1)} m/s，避免在大风窗口施药和播种。`
    });
  }
  if (nextThreeRain >= 25) {
    warnings.push({
      id: "rain",
      level: "attention",
      title: "连续降水",
      detail: `未来 3 日预计降水约 ${round(nextThreeRain, 1)} mm，需提前疏通厢沟和排水口。`
    });
  }
  if (et0 >= 4) {
    warnings.push({
      id: "evaporation",
      level: "info",
      title: "蒸散偏高",
      detail: `参考蒸散量约 ${round(et0, 1)} mm，直播后需关注表层墒情。`
    });
  }
  if (!warnings.length) {
    warnings.push({
      id: "stable",
      level: "info",
      title: "天气窗口总体平稳",
      detail: "未来 7 日未识别到达到阈值的低温、大风或强降水过程，仍需以当地短临预警为准。"
    });
  }
  return warnings;
}

export function fallbackWeather(plotId: string): WeatherSnapshot {
  const now = new Date();
  const seed = plotId.length % 3;
  const daily: WeatherDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() + index);
    const rainy = index === 2 || index === 3;
    return {
      date: toDateString(date),
      weather: rainy ? "小雨" : index === 5 ? "多云" : "晴间多云",
      tempMax: round(19.5 + seed * 0.6 - (rainy ? 2.4 : 0), 1),
      tempMin: round(8.8 + seed * 0.4 - (rainy ? 0.8 : 0), 1),
      precipitation: rainy ? (index === 2 ? 7.6 : 3.2) : 0,
      windMax: round(10.2 + index * 0.5, 1)
    };
  });
  return {
    source: "cached-demo",
    fetchedAt: new Date().toISOString(),
    isFallback: true,
    condition: "晴间多云",
    temperature: round(18.6 + seed * 0.5, 1),
    humidity: 63,
    windSpeed: 8.4,
    precipitation: 0,
    et0: 2.4,
    soilTemperature: 17.3,
    soilMoisture: 28.2,
    daily,
    warnings: buildWarnings(daily, 2.4)
  };
}

function weatherText(code?: number): string {
  if (code === undefined) return "未知";
  if (code === 0) return "晴";
  if (code <= 3) return "多云";
  if (code <= 48) return "雾";
  if (code <= 57) return "毛毛雨";
  if (code <= 67) return "小雨";
  if (code <= 77) return "降雪";
  if (code <= 82) return "阵雨";
  if (code <= 86) return "强阵雨";
  return "雷雨";
}

function firstFinite(values?: number[]): number | undefined {
  return values?.find((value) => Number.isFinite(value));
}

function requiredFinite(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Open-Meteo response is missing ${field}`);
  }
  return value;
}
