import { Agent } from "@mastra/core/agent";
import type { CoreMessage, OpenAICompatibleConfig } from "@mastra/core/llm";
import {
  getApiKey,
  getModelBaseUrl,
  getModelName,
  getModelStatus,
  type ModelRole
} from "../model-config.js";
import { buildSkillPrompt, type SkillId } from "../skill-guidance.js";

export type MastraAgentKey =
  | "orchestrator"
  | "weather"
  | "soil"
  | "cropSelection"
  | "economics"
  | "agronomy"
  | "verifier"
  | "pestVision";

function modelConfig(role: ModelRole = "summary"): OpenAICompatibleConfig {
  const status = getModelStatus();
  return {
    id: `${status.provider}/${getModelName(role)}`,
    url: getModelBaseUrl(),
    apiKey: getApiKey(),
    api: "chat"
  };
}

function makeAgent(
  id: string,
  name: string,
  skill: SkillId,
  description: string,
  instructions = buildSkillPrompt([skill]),
  role: ModelRole = "summary"
): Agent {
  return new Agent({
    id,
    name,
    description,
    instructions,
    model: () => modelConfig(role),
    maxRetries: 1
  });
}

export const mastraAgents = {
  orchestrator: makeAgent(
    "gengce-orchestrator",
    "耕策任务编排 Agent",
    "orchestrator",
    "识别农业任务范围并组织专业 Agent 与确定性工具。"
  ),
  weather: makeAgent(
    "gengce-weather",
    "耕策气象风险 Agent",
    "weather",
    "解释地块天气预报、降水和作业窗口风险。"
  ),
  soil: makeAgent(
    "gengce-soil",
    "耕策土壤证据 Agent",
    "soil",
    "区分测土、公开土壤属性和区域先验。"
  ),
  cropSelection: makeAgent(
    "gengce-crop-selection",
    "耕策选种决策 Agent",
    "crop-selection",
    "解释按收益、风险、省工和养地目标生成的候选作物。",
    buildSkillPrompt(["crop-selection", "economics"])
  ),
  economics: makeAgent(
    "gengce-economics",
    "耕策经济测算 Agent",
    "economics",
    "解释可追溯的亩均与总收益估算。"
  ),
  agronomy: makeAgent(
    "gengce-agronomy",
    "耕策农艺执行 Agent",
    "agronomy",
    "将作物、天气和土壤证据转成可执行的农艺检查项。"
  ),
  verifier: makeAgent(
    "gengce-verifier",
    "耕策独立校验 Agent",
    "verifier",
    "核对数值、证据边界、单位和方案发布条件。"
  ),
  pestVision: makeAgent(
    "gengce-pest-vision",
    "耕策病虫害初筛 Agent",
    "pest-vision",
    "解释图片初筛结果、相似对象和补拍要求。",
    buildSkillPrompt(["pest-vision"]),
    "vision"
  )
} as const;

export function agentKeyForSkill(skill: SkillId): MastraAgentKey {
  return {
    orchestrator: "orchestrator",
    weather: "weather",
    soil: "soil",
    "crop-selection": "cropSelection",
    economics: "economics",
    agronomy: "agronomy",
    verifier: "verifier",
    "pest-vision": "pestVision"
  }[skill] as MastraAgentKey;
}

export function getAgentForSkill(
  skill: SkillId,
  resolver?: (key: MastraAgentKey) => Agent | undefined
): Agent {
  const key = agentKeyForSkill(skill);
  return resolver?.(key) ?? mastraAgents[key];
}

export async function streamAgentResponse(input: {
  agent: Agent;
  system?: string;
  user?: string;
  messages?: CoreMessage[];
  onDelta: (text: string) => void;
  modelName?: string;
}): Promise<{
  text: string;
  usedModel: boolean;
  model: string;
  tokens: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const messages: CoreMessage[] = input.messages?.length
    ? input.messages
    : [
        { role: "system" as const, content: input.system ?? "" },
        { role: "user" as const, content: input.user ?? "" }
      ];
  const stream = await input.agent.stream(messages);
  let text = "";
  for await (const delta of stream.textStream) {
    text += delta;
    input.onDelta(delta);
  }
  const usage = await stream.usage;
  const finalText = (await stream.text || text).trim();
  if (!finalText) throw new Error("Mastra Agent 未返回有效文本");
  return {
    text: finalText,
    usedModel: true,
    model: input.modelName ?? getModelStatus().model,
    tokens: Number(usage?.totalTokens ?? 0),
    durationMs: Date.now() - startedAt
  };
}

export async function generateAgentResponse(input: {
  agent: Agent;
  system?: string;
  user?: string;
  messages?: CoreMessage[];
  modelName?: string;
}): Promise<{
  text: string;
  usedModel: boolean;
  model: string;
  tokens: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const messages: CoreMessage[] = input.messages?.length
    ? input.messages
    : [
        { role: "system" as const, content: input.system ?? "" },
        { role: "user" as const, content: input.user ?? "" }
      ];
  const result = await input.agent.generate(messages);
  const text = result.text.trim();
  if (!text) throw new Error("Mastra Agent 未返回有效文本");
  return {
    text,
    usedModel: true,
    model: input.modelName ?? getModelStatus().model,
    tokens: Number(result.totalUsage?.totalTokens ?? result.usage?.totalTokens ?? 0),
    durationMs: Date.now() - startedAt
  };
}
