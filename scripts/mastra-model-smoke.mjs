const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

const bootstrap = await json("/api/bootstrap");
const started = await json("/api/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    accountId: bootstrap.account.id,
    plotId: bootstrap.activePlotId,
    mode: "question",
    message: "请结合当前地块天气和土壤，说明未来几天安排施肥前要核对什么。"
  })
});

const response = await fetch(`${baseUrl}/api/runs/${started.runId}/events`);
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let textEvents = 0;
let streamedCharacters = 0;
let streamedText = "";
let completed = false;

while (!completed) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";
  for (const frame of frames) {
    if (frame.startsWith("event: text")) {
      const data = frame.split("\n").find(line => line.startsWith("data: "));
      const payload = data ? JSON.parse(data.slice(6)) : { text: "" };
      textEvents += 1;
      streamedText = String(payload.text ?? "");
      streamedCharacters = Math.max(streamedCharacters, streamedText.length);
    }
    if (frame.startsWith("event: done")) completed = true;
  }
}

const run = await json(`/api/runs/${started.runId}`);
const answerEvent = run.events.find(event => event.kind === "answer");
const recommendationStarted = await json("/api/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    accountId: bootstrap.account.id,
    plotId: bootstrap.activePlotId,
    mode: "recommend",
    goal: "profit"
  })
});
let recommendationRun = await json(`/api/runs/${recommendationStarted.runId}`);
const recommendationDeadline = Date.now() + 60_000;
while (recommendationRun.status === "running" && Date.now() < recommendationDeadline) {
  await new Promise(resolve => setTimeout(resolve, 250));
  recommendationRun = await json(`/api/runs/${recommendationStarted.runId}`);
}
const economicEvent = recommendationRun.events.find(
  event => event.payload?.artifact === "EconomicEstimate"
);
const result = {
  runId: started.runId,
  status: run.status,
  textEvents,
  streamedCharacters,
  modelUsed: answerEvent?.payload?.modelUsed === true,
  agent: answerEvent?.agent,
  fallbackReason: answerEvent?.payload?.fallbackReason ?? null,
  streamedPreview: streamedText.slice(-500),
  finalAnswerPreview: String(answerEvent?.payload?.answer ?? "").slice(-500),
  recommendation: {
    runId: recommendationStarted.runId,
    status: recommendationRun.status,
    modelGenerated: economicEvent?.title?.includes("已生成受约束摘要") === true,
    modelFallback: economicEvent?.payload?.modelFallback ?? null,
    numericRepairs: economicEvent?.payload?.numericRepairs ?? []
  }
};

console.log(JSON.stringify(result, null, 2));
if (
  run.status !== "completed" ||
  textEvents === 0 ||
  result.modelUsed !== true ||
  recommendationRun.status !== "completed" ||
  result.recommendation.modelGenerated !== true
) {
  process.exitCode = 1;
}
