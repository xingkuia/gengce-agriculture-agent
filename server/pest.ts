import { createHash } from "node:crypto";
import {
  getAgentForSkill,
  streamAgentResponse
} from "./mastra/agents.js";
import { getModelName } from "./model-config.js";
import { buildSkillPrompt } from "./skill-guidance.js";

export interface PestAssessment {
  status: "suspected" | "uncertain" | "no_pest_visible";
  observation: string;
  candidates: Array<{ name: string; evidence: string; distinguishing: string }>;
  nextPhotos: string[];
  actions: string[];
}

export function validateImage(value: unknown): string {
  if (typeof value !== "string") throw new Error("请上传图片");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) throw new Error("仅支持 JPEG、PNG、WebP 图片");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new Error("图片不能超过 4MB");
  const valid = match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new Error("图片内容与格式不符");
  return value;
}

export function parseAssessment(text: string): PestAssessment {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("识别结果不是有效 JSON");
  const data = JSON.parse(match[0]) as PestAssessment;
  const short = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 1200;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 6 && v.every(short);
  if (!data || !["suspected", "uncertain", "no_pest_visible"].includes(data.status) || !short(data.observation) ||
    !Array.isArray(data.candidates) || data.candidates.length > 3 ||
    !data.candidates.every(c => c && short(c.name) && short(c.evidence) && short(c.distinguishing)) ||
    !strings(data.nextPhotos) || !strings(data.actions) || (data.status === "suspected" && !data.candidates.length) ||
    (data.status === "no_pest_visible" && data.candidates.length > 0) ||
    (data.status === "uncertain" && data.nextPhotos.length === 0)) {
    throw new Error("识别结果结构不完整，请重新识别");
  }
  return data;
}

const pending = new Map<string, ReturnType<typeof runIdentification>>();
export async function identifyPest(image: string, context: string, onObservation?: (text: string) => void) {
  if (onObservation) return runIdentification(image, context, onObservation);
  const key = createHash("sha256").update(image).update(context).digest("hex");
  const existing = pending.get(key);
  if (existing) return existing;
  const task = runIdentification(image, context);
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

async function runIdentification(image: string, context: string, onObservation?: (text: string) => void) {
  let raw = "";
  const result = await streamAgentResponse({
    agent: getAgentForSkill("pest-vision"),
    messages: [
      {
        role: "system",
        content: buildSkillPrompt(["pest-vision"]) + `
返回 JSON：{"status":"suspected|uncertain|no_pest_visible","observation":"可见特征和局限","candidates":[{"name":"疑似对象","evidence":"可见依据","distinguishing":"与相似对象的区别及尚缺证据"}],"nextPhotos":["具体补拍要求"],"actions":["下一步检查措施"]}。先输出 observation 字段以便流式显示。候选最多3项，无法判断时可为空；uncertain 必须给出至少一项补拍要求，no_pest_visible 的候选必须为空。`
      },
      {
        role: "user",
        content: [
          { type: "image", image },
          { type: "text", text: context }
        ]
      }
    ],
    onDelta: onObservation
      ? delta => {
          raw += delta;
          const match = /"observation"\s*:\s*"((?:\\.|[^"\\])*)/.exec(raw);
          if (!match) return;
          try {
            onObservation(JSON.parse(`"${match[1]}"`) as string);
          } catch {
            // Wait for the next delta when an escaped character is split.
          }
        }
      : () => {},
    modelName: getModelName("vision")
  });
  return { assessment: parseAssessment(result.text), model: result.model, durationMs: result.durationMs, tokens: result.tokens };
}
