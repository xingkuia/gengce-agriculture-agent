import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("startup marks task runs left by a terminated process as failed", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gengce-startup-recovery-"));
  process.env.DATABASE_PATH = join(folder, "test.db");
  const { db, migrateDatabase, readPlotContext, recoverInterruptedRuns, seedDatabase } = await import(
    "../server/db.js"
  );
  const { migrateFarmManagement } = await import("../server/farms.js");

  migrateDatabase();
  seedDatabase();
  db.prepare("DELETE FROM plot_context WHERE plot_id = 'plot-river'").run();
  migrateFarmManagement();
  assert.ok(readPlotContext("plot-river"));
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO task_run (
      id, account_id, plot_id, type, status, input_json, summary,
      model_provider, model_name, created_at, completed_at
    ) VALUES (?, ?, ?, 'question', 'running', ?, '', 'mock', 'deterministic', ?, NULL)
  `).run("run-interrupted", "acct-demo", "plot-east", "{}", createdAt);

  assert.equal(recoverInterruptedRuns(), 1);
  const run = db.prepare(
    "SELECT status, summary, completed_at FROM task_run WHERE id = 'run-interrupted'"
  ).get() as { status: string; summary: string; completed_at: string | null };
  assert.equal(run.status, "failed");
  assert.match(run.summary, /服务已重启/);
  assert.ok(run.completed_at);
  db.close();
});
