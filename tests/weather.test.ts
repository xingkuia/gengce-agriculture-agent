import assert from "node:assert/strict";
import test from "node:test";
import { getWeather } from "../server/tools/weather.js";
import type { Plot } from "../server/types.js";

const plot: Plot = {
  id: "plot-weather-test",
  farmId: "farm-weather-test",
  name: "天气测试田",
  areaMu: 12,
  soilTexture: "壤土",
  irrigation: "沟渠灌溉",
  drainage: "良好",
  currentCrop: "冬小麦",
  rotation: "稻麦轮作",
  note: ""
};

test("weather uses the online Open-Meteo temperature and encodes the timezone once", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    const dailyDates = Array.from({ length: 7 }, (_, index) => `2026-11-${17 + index}`);
    return Response.json({
      current: {
        temperature_2m: 13.7,
        relative_humidity_2m: 71,
        precipitation: 0.2,
        weather_code: 3,
        wind_speed_10m: 4.8
      },
      hourly: {
        et0_fao_evapotranspiration: [1.3],
        soil_temperature_0cm: [12.4],
        soil_moisture_0_to_1cm: [0.31]
      },
      daily: {
        time: dailyDates,
        weather_code: dailyDates.map(() => 3),
        temperature_2m_max: dailyDates.map((_, index) => 16 + index / 10),
        temperature_2m_min: dailyDates.map((_, index) => 7 + index / 10),
        precipitation_sum: dailyDates.map(() => 0),
        wind_speed_10m_max: dailyDates.map(() => 8),
        et0_fao_evapotranspiration_sum: dailyDates.map(() => 1.5)
      }
    });
  }) as typeof fetch;

  try {
    const weather = await getWeather(plot, { latitude: 32.087, longitude: 112.211 });
    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get("timezone"), "Asia/Shanghai");
    assert.ok(!requestedUrl.includes("%252F"));
    assert.equal(weather.source, "open-meteo");
    assert.equal(weather.isFallback, false);
    assert.equal(weather.temperature, 13.7);
    assert.equal(weather.humidity, 71);
    assert.equal(weather.soilMoisture, 31);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weather rejects an incomplete online temperature instead of substituting a demo value", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      current: { relative_humidity_2m: 71 },
      daily: { time: ["2026-11-17"] }
    })) as typeof fetch;

  try {
    const weather = await getWeather(plot, { latitude: 32.087, longitude: 112.211 });
    assert.equal(weather.source, "cached-demo");
    assert.equal(weather.isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
