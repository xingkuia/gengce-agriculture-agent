import assert from "node:assert/strict";
import test from "node:test";
import {
  CROPS,
  CROP_ORDER,
  buildPlan,
  computeEconomics,
  seasonStatus
} from "../server/data.js";
import { regionalPrior } from "../server/tools/soil.js";
import { fallbackWeather } from "../server/tools/weather.js";
import type { Plot } from "../server/types.js";

const plot: Plot = {
  id: "plot-test",
  farmId: "farm-test",
  name: "测试田",
  areaMu: 40,
  soilTexture: "壤质黏土",
  irrigation: "沟渠灌溉",
  drainage: "良好",
  currentCrop: "水稻已收",
  rotation: "稻油轮作",
  note: "测试地块"
};

test("crop catalog keeps five distinct decision targets", () => {
  assert.equal(CROP_ORDER.length, 5);
  for (const code of CROP_ORDER) {
    const crop = CROPS[code];
    assert.ok(crop.goals.profit > 0);
    assert.ok(crop.goals.low_risk > 0);
    assert.ok(crop.goals.labor_saving > 0);
    assert.ok(crop.goals.soil_health > 0);
    assert.ok(crop.evidence.length >= 1);
  }
});

test("season status identifies the Hubei autumn planting window", () => {
  assert.equal(seasonStatus(CROPS.wheat, 11), "适播");
  assert.equal(seasonStatus(CROPS.rapeseed, 11), "适播");
  assert.equal(seasonStatus(CROPS.rice, 11), "非当前播期");
  assert.equal(seasonStatus(CROPS.soybean, 4), "临近播期");
});

test("economic estimate is recalculated from user overrides", () => {
  const estimate = computeEconomics(CROPS.wheat, 40, {
    pricePerKg: 2.8,
    yieldPerMu: 430,
    costPerMu: 800
  });
  assert.equal(estimate.source, "user-overridden");
  assert.equal(estimate.revenuePerMu, 1204);
  assert.equal(estimate.marginPerMu, 404);
  assert.equal(estimate.marginTotal, 16160);
  assert.equal(estimate.revenueTotal, 48160);
});

test("public estimate stays explicitly labeled and excludes unprovided costs", () => {
  const estimate = computeEconomics(CROPS.rapeseed, 20);
  assert.equal(estimate.source, "public-estimate");
  assert.ok(estimate.assumptions.some((item) => item.includes("非实时收购报价")));
  assert.ok(estimate.marginPerMu > 0);
});

test("generated plan contains executable tasks and visible evidence", () => {
  const weather = fallbackWeather(plot.id);
  const soil = regionalPrior(plot);
  const plan = buildPlan(CROPS.wheat, plot, weather, soil, new Date("2026-11-09T00:00:00+08:00"));
  assert.equal(plan.cropCode, "wheat");
  assert.ok(plan.tasks.length >= 5);
  assert.ok(plan.tasks.some((task) => task.priority === "critical"));
  assert.ok(plan.tasks.every((task) => task.dateWindow.length > 0));
  assert.ok(plan.evidence.length >= 2);
  assert.ok(plan.inputPlan.some((item) => item.includes("测土") || item.includes("配方")));
});

test("regional soil prior is transparent about calibration need", () => {
  const soil = regionalPrior(plot);
  assert.equal(soil.source, "regional-prior");
  assert.equal(soil.isFallback, true);
  assert.ok(soil.note.includes("测土"));
  assert.ok(soil.clayPercent > 0);
  assert.ok(soil.ph > 0);
});
