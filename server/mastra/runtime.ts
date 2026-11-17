import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { db, makeId } from "../db.js";
import { getModelStatus } from "../model-config.js";
import type { AgentEvent } from "../types.js";
import { mastraAgents } from "./agents.js";
import { capabilityWorkflow } from "./capability-workflow.js";
import { decisionWorkflow } from "./decision-workflow.js";
import { questionWorkflow } from "./question-workflow.js";
import {
  createRunBus,
  failRun,
  finishRunBus,
  subscribeRunEvents,
  subscribeRunText,
  type StartRunInput
} from "./support.js";

export type { StartRunInput } from "./support.js";

export const mastra = new Mastra({
  agents: mastraAgents,
  // 业务运行明细持久化在 SQLite；Mastra 只保存当前进程内的执行快照。
  storage: new InMemoryStore(),
  workflows: {
    capabilityWorkflow,
    decisionWorkflow,
    questionWorkflow
  }
});

export function startRun(input: StartRunInput): string {
  const runId = makeId("run");
  const createdAt = new Date().toISOString();
  const provider = getModelStatus();
  db.prepare(`
    INSERT INTO task_run (
      id, account_id, plot_id, type, status, input_json, summary,
      model_provider, model_name, created_at
    ) VALUES (?, ?, ?, ?, 'running', ?, '', ?, ?, ?)
  `).run(
    runId,
    input.accountId,
    input.plotId,
    input.mode,
    JSON.stringify(input),
    provider.provider,
    provider.model,
    createdAt
  );

  createRunBus(runId);
  setImmediate(() => {
    void executeRun(runId, input);
  });
  return runId;
}

async function executeRun(runId: string, input: StartRunInput): Promise<void> {
  try {
    const result = input.mode === "question"
      ? await runQuestionWorkflow(runId, input)
      : await runDecisionWorkflow(runId, input);
    if (result.status !== "success") {
      const reason = result.status === "failed"
        ? result.error.message
        : `Mastra 工作流未完成：${result.status}`;
      throw new Error(reason);
    }
    const task = db.prepare("SELECT status FROM task_run WHERE id = ?").get(runId) as
      | { status: string }
      | undefined;
    if (task?.status === "running") {
      db.prepare(
        "UPDATE task_run SET status = 'completed', completed_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), runId);
    }
    finishRunBus(runId);
  } catch (error) {
    await failRun(runId, error);
  }
}

async function runQuestionWorkflow(runId: string, input: StartRunInput) {
  const run = await mastra.getWorkflow("questionWorkflow").createRun({
    runId,
    resourceId: input.accountId
  });
  return run.start({
    inputData: {
      ...input,
      runId,
      mode: "question" as const
    }
  });
}

async function runDecisionWorkflow(runId: string, input: StartRunInput) {
  const run = await mastra.getWorkflow("decisionWorkflow").createRun({
    runId,
    resourceId: input.accountId
  });
  return run.start({
    inputData: {
      ...input,
      runId,
      mode: "recommend" as const
    }
  });
}

export function subscribeRun(
  runId: string,
  listener: (event: AgentEvent | null) => void
): () => void {
  return subscribeRunEvents(runId, listener);
}

export { subscribeRunText };

export function getRunStatus(runId: string): {
  status: string;
  summary: string;
  createdAt: string;
  completedAt: string | null;
} | null {
  const row = db
    .prepare("SELECT status, summary, created_at, completed_at FROM task_run WHERE id = ?")
    .get(runId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    status: String(row.status),
    summary: String(row.summary),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null
  };
}
