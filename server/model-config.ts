import type { ModelStatus } from "./types.js";

export type ModelRole = "summary" | "vision";

export function getModelStatus(): ModelStatus {
  const provider = normalizeProvider(process.env.MODEL_PROVIDER);
  const model = provider === "mock" ? "deterministic" : getModelName("summary");
  const baseUrl =
    process.env.MODEL_BASE_URL ??
    (provider === "qwen"
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
      : "https://api.deepseek.com");
  return {
    provider,
    model,
    configured: provider !== "mock" && Boolean(getApiKey()),
    baseUrl,
    note:
      provider === "mock"
        ? "当前使用确定性演示模式；配置服务端模型密钥后自动切换。"
        : getApiKey()
          ? "模型密钥已配置在服务端，桌面客户端不可见。"
          : "已选择模型提供方，但尚未配置服务端密钥，当前自动回退到确定性模式。"
  };
}

export function getModelName(role: ModelRole = "summary"): string {
  const explicit = process.env[`MODEL_${role.toUpperCase()}_NAME`];
  if (explicit) return explicit;
  if (role === "vision") return "qwen3-vl-plus";
  return (
    process.env.MODEL_NAME ??
    (normalizeProvider(process.env.MODEL_PROVIDER) === "qwen"
      ? "qwen3-max"
      : "deepseek-chat")
  );
}

export function getModelBaseUrl(): string {
  const region = normalizeProvider(process.env.MODEL_PROVIDER);
  return (
    process.env.MODEL_BASE_URL ??
    (region === "qwen"
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1"
      : "https://api.deepseek.com")
  ).replace(/\/$/, "");
}

export function getApiKey(): string | undefined {
  return process.env.MODEL_API_KEY || process.env.DASHSCOPE_API_KEY;
}

export function normalizeProvider(value?: string): ModelStatus["provider"] {
  return value === "deepseek" || value === "qwen" ? value : "mock";
}
