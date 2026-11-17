import { resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env"));

const baseUrl = process.env.MODEL_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.MODEL_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error("MODEL_BASE_URL and MODEL_API_KEY must be configured server-side.");
}

const response = await fetch(`${baseUrl}/models`, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(20_000)
});
const body = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(`Model list request failed (${response.status}): ${JSON.stringify(body)}`);
}

const models = Array.isArray(body?.data)
  ? body.data.map((model) => model.id ?? model.name).filter(Boolean)
  : [];

const modelName = process.env.MODEL_NAME ?? "qwen3-max";
const completionResponse = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: modelName,
    temperature: 0,
    max_tokens: 40,
    messages: [
      { role: "system", content: "只回答“连接正常”。" },
      { role: "user", content: "请确认接口可用。" }
    ]
  }),
  signal: AbortSignal.timeout(20_000)
});
const completion = await completionResponse.json().catch(() => null);
if (!completionResponse.ok) {
  throw new Error(
    `Chat completion request failed (${completionResponse.status}): ${JSON.stringify(completion)}`
  );
}

console.log(
  JSON.stringify(
    {
      status: response.status,
      configuredModel: modelName,
      modelAvailable: models.includes(modelName),
      chatStatus: completionResponse.status,
      reply: completion?.choices?.[0]?.message?.content?.trim() ?? "",
      modelCount: models.length
    },
    null,
    2
  )
);
