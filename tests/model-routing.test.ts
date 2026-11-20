import { test } from "node:test";
import assert from "node:assert/strict";
import { getModelName } from "../server/model-config.js";

test("provider defaults route vision independently and preserve explicit overrides", () => {
  const names = ["MODEL_PROVIDER", "MODEL_NAME", "MODEL_SUMMARY_NAME", "MODEL_VISION_NAME"];
  const saved = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    process.env.MODEL_PROVIDER = "deepseek";
    assert.equal(getModelName("vision"), "deepseek-flash");
    assert.equal(getModelName("summary"), "deepseek-flash");
    process.env.MODEL_NAME = "custom-text";
    assert.equal(getModelName("vision"), "deepseek-flash");
    assert.equal(getModelName("summary"), "custom-text");
    process.env.MODEL_PROVIDER = "qwen";
    assert.equal(getModelName("vision"), "qwen3-vl-plus");
    process.env.MODEL_VISION_NAME = "custom-vision";
    assert.equal(getModelName("vision"), "custom-vision");
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});
