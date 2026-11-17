import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import {
  db,
  getEvents,
  insertFeedback,
  insertOperation,
  insertOutcome,
  insertPlan,
  makeId,
  mapEvaluation,
  mapFeedback,
  mapOperation,
  mapOutcome,
  mapPlan,
  mapRecommendation,
  migrateDatabase,
  readPlotContext,
  recoverInterruptedRuns,
  seedDatabase,
  writePlotContext
} from "./db.js";
import { getModelStatus } from "./model-config.js";
import { identifyPest, validateImage } from "./pest.js";
import { handleFarmApi, migrateFarmManagement } from "./farms.js";
import { handleMapApi } from "./maps.js";
import { handleCapabilityApi } from "./capabilities-api.js";
import { migrateCapabilityPlane } from "./capabilities-store.js";
import { migrateKnowledgeIndex } from "./knowledge.js";
import { seedPublicGuidance } from "./public-guidance-seed.js";
import {
  getRunStatus,
  startRun,
  subscribeRun,
  subscribeRunText,
  type StartRunInput
} from "./mastra/runtime.js";
import { SKILLS, TOOL_MANIFEST } from "./skills.js";
import { getSoil, regionalPrior } from "./tools/soil.js";
import { fallbackWeather, getWeather } from "./tools/weather.js";
import type {
  Account,
  BootstrapPayload,
  Farm,
  OperationRecord,
  Plot,
  PriceOverride,
  Recommendation,
  RuntimeCapabilityOverride
} from "./types.js";

const appRoot = resolve(process.env.APP_ROOT ?? process.cwd());
try {
  process.loadEnvFile(process.env.ENV_FILE ?? resolve(appRoot, ".env"));
} catch {
  // Environment variables may already be supplied by the desktop host.
}

const port = Number(process.env.PORT ?? 8787);
const distPath = resolve(appRoot, "dist");

migrateDatabase();
recoverInterruptedRuns();
seedDatabase();
migrateFarmManagement();
migrateCapabilityPlane();
migrateKnowledgeIndex();
seedPublicGuidance();
db.exec(`CREATE TABLE IF NOT EXISTS pest_assessment (
  id TEXT PRIMARY KEY, plot_id TEXT NOT NULL REFERENCES plot(id),
  result_json TEXT NOT NULL, created_at TEXT NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS chat_session (
  id TEXT PRIMARY KEY, plot_id TEXT NOT NULL REFERENCES plot(id), title TEXT NOT NULL,
  turns_json TEXT NOT NULL, updated_at TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS chat_session_updated ON chat_session(updated_at DESC)`);
// Recover real earlier tasks on the first upgrade; seeded examples stay out.
if ((db.prepare("SELECT count(*) AS n FROM chat_session").get() as { n: number }).n === 0) {
  const earlier = db.prepare("SELECT * FROM task_run WHERE status IN ('completed','failed') AND id NOT IN ('run-demo-current','run-history-2025') ORDER BY created_at DESC LIMIT 30").all() as Array<Record<string, unknown>>;
  const insert = db.prepare("INSERT OR IGNORE INTO chat_session (id, plot_id, title, turns_json, updated_at) VALUES (?, ?, ?, ?, ?)");
  for (const row of earlier) {
    const input = JSON.parse(String(row.input_json)) as { message?: string; goal?: string };
    if (!input.message) continue;
    const id = `history-${String(row.id).replace(/[^a-zA-Z0-9-]/g, "-")}`;
    const records = db.prepare("SELECT * FROM recommendation WHERE run_id = ? ORDER BY rank").all(String(row.id)) as Array<Record<string, unknown>>;
    const turns = [
      { id: `${id}-user`, role: "user", kind: "message", content: input.message, createdAt: row.created_at },
      { id: `${id}-assistant`, role: "assistant", kind: "run", content: String(row.summary), mode: row.type, goal: input.goal, status: row.status === "completed" ? "done" : "error", runId: row.id, events: getEvents(String(row.id)), recommendations: records.map(mapRecommendation), createdAt: row.created_at }
    ];
    insert.run(id, String(row.plot_id), input.message.slice(0, 80), JSON.stringify(turns), String(row.completed_at ?? row.created_at));
  }
}

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/_AMapService/")) { await handleMapApi(request,response,url); return; }
    if (url.pathname.startsWith("/api/")) {
      response.setHeader("cache-control", "no-store");
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "服务器内部错误"
      });
    } else {
      response.end();
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Agriculture Agent API listening on http://localhost:${port}`);
});

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = url.pathname;
  if (await handleMapApi(request,response,url)) return;
  if (await handleFarmApi(request, response, url, readJson, sendJson)) return;
  if (await handleCapabilityApi(request, response, url, readJson, sendJson)) return;

  if (pathname === "/api/chats" && method === "GET") {
    sendJson(response, 200, db.prepare("SELECT id, plot_id AS plotId, title, substr(json_extract(turns_json, '$[#-1].content'), 1, 100) AS preview, updated_at AS updatedAt FROM chat_session ORDER BY updated_at DESC LIMIT 100").all());
    return;
  }
  const chatMatch = pathname.match(/^\/api\/chats\/([a-zA-Z0-9-]{1,100})$/);
  if (chatMatch && method === "GET") {
    const row = db.prepare("SELECT * FROM chat_session WHERE id = ?").get(chatMatch[1]) as { id: string; plot_id: string; title: string; turns_json: string; updated_at: string } | undefined;
    if (!row) { sendJson(response, 404, { message: "未找到保存的对话" }); return; }
    sendJson(response, 200, { id: row.id, plotId: row.plot_id, title: row.title, turns: JSON.parse(row.turns_json), updatedAt: row.updated_at });
    return;
  }
  if (chatMatch && (method === "PUT" || method === "POST")) {
    const body = await readJson(request, 8_000_000);
    const turns = body.turns;
    if (!getPlotAndFarm(String(body.plotId)) || !Array.isArray(turns) || !turns.length || turns.length > 500 ||
      !turns.every(t => t && typeof t.id === "string" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.length <= 100000)) {
      sendJson(response, 400, { message: "对话数据无效或内容过长" }); return;
    }
    const first = turns.find(t => t.role === "user");
    const title = String(first?.content ?? "虫害识别").slice(0, 80);
    db.prepare(`INSERT INTO chat_session (id, plot_id, title, turns_json, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, turns_json=excluded.turns_json, updated_at=excluded.updated_at WHERE chat_session.plot_id=excluded.plot_id`)
      .run(chatMatch[1], String(body.plotId), title, JSON.stringify(turns), new Date().toISOString());
    sendJson(response, 200, { saved: true }); return;
  }

  if (pathname === "/api/pest-assessments" && method === "GET") {
    const plotId = url.searchParams.get("plotId") ?? "";
    const rows = db.prepare("SELECT id, result_json, created_at FROM pest_assessment WHERE plot_id = ? ORDER BY created_at DESC LIMIT 10").all(plotId) as Array<{ id: string; result_json: string; created_at: string }>;
    sendJson(response, 200, rows.map(row => ({ id: row.id, createdAt: row.created_at, ...JSON.parse(row.result_json) })));
    return;
  }
  if (pathname === "/api/pest-assessments" && method === "POST") {
    let body: Record<string, unknown>;
    let image: string;
    try {
      body = await readJson(request, 6_000_000);
      image = validateImage(body.image);
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : "图片无效" });
      return;
    }
    const context = getPlotAndFarm(String(body.plotId ?? ""));
    if (!context) { sendJson(response, 404, { message: "未找到地块" }); return; }
    const streaming = url.searchParams.get("stream") === "1";
    let closed = false;
    const push = (event: string, data: unknown) => {
      if (!closed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    if (streaming) {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
      response.flushHeaders();
      response.on("close", () => { closed = true; });
      push("progress", { text: "正在读取图片并观察可见特征" });
    }
    try {
      const result = await identifyPest(image, JSON.stringify({ plot: context.plot.name, crop: context.plot.currentCrop, region: context.farm.province, notes: String(body.notes ?? "").slice(0, 1000) }), streaming ? text => push("text", { text }) : undefined);
      const id = makeId("pest");
      const createdAt = new Date().toISOString();
      db.prepare("INSERT INTO pest_assessment (id, plot_id, result_json, created_at) VALUES (?, ?, ?, ?)").run(id, context.plot.id, JSON.stringify(result), createdAt);
      if (streaming) { push("done", { id, createdAt, ...result }); response.end(); }
      else sendJson(response, 200, { id, createdAt, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "识别服务暂不可用，请重试";
      if (streaming) { push("error", { message }); response.end(); }
      else sendJson(response, 502, { message });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "agriculture-agent-runtime",
      time: new Date().toISOString(),
      database: "sqlite",
      model: getModelStatus().provider
    });
    return;
  }

  if (method === "GET" && pathname === "/api/bootstrap") {
    const payload = buildBootstrap(url.searchParams.get("plotId"));
    sendJson(response, 200, payload);
    return;
  }

  if (method === "GET" && pathname === "/api/catalog") {
    sendJson(response, 200, {
      skills: SKILLS,
      tools: TOOL_MANIFEST,
      runtime: {
        name: "Gengce Mastra Agent Runtime",
        version: "1.0.0",
        features: ["Mastra Agents", "Mastra Workflows", "scoped capability snapshot", "MCP discovery", "versioned skills", "local knowledge retrieval", "A2A artifacts", "verifier loop"]
      }
    });
    return;
  }

  const contextRefreshMatch = pathname.match(/^\/api\/plots\/([^/]+)\/context\/refresh$/);
  if (method === "POST" && contextRefreshMatch) {
    const plotId = decodeURIComponent(contextRefreshMatch[1]);
    const context = getPlotAndFarm(plotId);
    if (!context) {
      sendJson(response, 404, { error: "PLOT_NOT_FOUND", message: "未找到地块" });
      return;
    }
    const [weather, soil] = await Promise.all([
      getWeather(context.plot, context.farm),
      getSoil(context.plot, context.farm, readPlotContext(context.plot.id)?.soil)
    ]);
    const next = { weather, soil, updatedAt: new Date().toISOString() };
    writePlotContext(plotId, next);
    sendJson(response, 200, next);
    return;
  }

  const manualSoilMatch = pathname.match(/^\/api\/plots\/([^/]+)\/soil$/);
  if (method === "POST" && manualSoilMatch) {
    const plotId = decodeURIComponent(manualSoilMatch[1]);
    const current = readPlotContext(plotId);
    if (!current) {
      sendJson(response, 404, { error: "PLOT_NOT_FOUND", message: "未找到地块土壤上下文" });
      return;
    }
    const body = await readJson(request);
    const next = {
      ...current,
      soil: {
        source: "manual" as const,
        fetchedAt: new Date().toISOString(),
        isFallback: false,
        texture: stringValue(body.texture, current.soil.texture),
        clayPercent: numberValue(body.clayPercent, current.soil.clayPercent),
        sandPercent: numberValue(body.sandPercent, current.soil.sandPercent),
        ph: numberValue(body.ph, current.soil.ph),
        organicCarbon: numberValue(body.organicCarbon, current.soil.organicCarbon),
        drainage: stringValue(body.drainage, current.soil.drainage),
        note: stringValue(body.note, "用户提供的测土或当地农技数据，优先于公开估算。")
      },
      updatedAt: new Date().toISOString()
    };
    writePlotContext(plotId, next);
    sendJson(response, 200, next);
    return;
  }

  if (method === "POST" && pathname === "/api/runs") {
    const body = await readJson(request);
    const accountId = stringValue(body.accountId, "acct-demo");
    const plotId = requiredString(body.plotId, "plotId");
    const mode = body.mode === "question" ? "question" : "recommend";
    const goal =
      body.goal === "low_risk" ||
      body.goal === "labor_saving" ||
      body.goal === "soil_health" ||
      body.goal === "profit"
        ? body.goal
        : "profit";
    const overrides = normalizeOverrides(body.overrides);
    const input: StartRunInput = {
      accountId,
      plotId,
      mode,
      goal,
      message: body.message ? String(body.message).slice(0, 1000) : undefined,
      overrides,
      capabilityOverrides: normalizeCapabilityOverrides(body.capabilityOverrides)
    };
    const runId = startRun(input);
    sendJson(response, 202, { runId, status: "running" });
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const runId = decodeURIComponent(eventsMatch[1]);
    streamRunEvents(request, response, runId, Number(url.searchParams.get("after") ?? 0));
    return;
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (method === "GET" && runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    const status = getRunStatus(runId);
    if (!status) {
      sendJson(response, 404, { error: "RUN_NOT_FOUND", message: "未找到任务运行" });
      return;
    }
    sendJson(response, 200, { ...status, events: getEvents(runId) });
    return;
  }

  if (method === "POST" && pathname === "/api/plans") {
    const body = await readJson(request);
    const recommendationId = requiredString(body.recommendationId, "recommendationId");
    const row = db.prepare("SELECT * FROM recommendation WHERE id = ?").get(recommendationId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      sendJson(response, 404, { error: "RECOMMENDATION_NOT_FOUND", message: "未找到候选建议" });
      return;
    }
    const recommendation = mapRecommendation(row);
    const plot = getPlotAndFarm(recommendation.plotId);
    if (!plot) {
      sendJson(response, 404, { error: "PLOT_NOT_FOUND", message: "地块不存在" });
      return;
    }
    const existing=db.prepare("SELECT * FROM planting_plan WHERE plot_id=? AND recommendation_id=? AND status='active'").get(recommendation.plotId,recommendation.id) as Record<string,unknown>|undefined;
    if(existing){sendJson(response,200,mapPlan(existing));return;}
    const plan = {
      id: makeId("plan"),
      accountId: plot.farm.accountId,
      plotId: recommendation.plotId,
      recommendationId: recommendation.id,
      cropCode: recommendation.cropCode,
      cropName: recommendation.cropName,
      status: "active" as const,
      season: recommendation.plan.season,
      startDate: recommendation.plan.startDate,
      plan: recommendation.plan,
      createdAt: new Date().toISOString()
    };
    db.exec('BEGIN IMMEDIATE');
    try {db.prepare("UPDATE planting_plan SET status='archived' WHERE plot_id=? AND status='active'").run(recommendation.plotId);insertPlan(plan);db.exec('COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
    sendJson(response, 201, plan);
    return;
  }

  const recordsMatch = pathname.match(/^\/api\/plans\/([^/]+)\/records$/);
  if (method === "POST" && recordsMatch) {
    const planId = decodeURIComponent(recordsMatch[1]);
    const planRow = db.prepare("SELECT * FROM planting_plan WHERE id = ?").get(planId) as
      | Record<string, unknown>
      | undefined;
    if (!planRow) {
      sendJson(response, 404, { error: "PLAN_NOT_FOUND", message: "未找到种植方案" });
      return;
    }
    const body = await readJson(request);
    const record: OperationRecord = {
      id: makeId("op"),
      plotId: String(planRow.plot_id),
      planId,
      type: stringValue(body.type, "田间作业"),
      title: requiredString(body.title, "title").slice(0, 120),
      plannedDate: stringValue(body.plannedDate, new Date().toISOString().slice(0, 10)),
      actualDate: body.actualDate ? String(body.actualDate).slice(0, 10) : null,
      status: body.status === "planned" || body.status === "skipped" ? body.status : "done",
      notes: stringValue(body.notes, "").slice(0, 1000),
      cost: Math.max(0, numberValue(body.cost, 0)),
      createdAt: new Date().toISOString()
    };
    insertOperation(record);
    sendJson(response, 201, record);
    return;
  }

  const recordStatusMatch = pathname.match(/^\/api\/records\/([^/]+)$/);
  if (method === "PATCH" && recordStatusMatch) {
    const recordId = decodeURIComponent(recordStatusMatch[1]);
    const body = await readJson(request);
    const status = body.status === "planned" || body.status === "skipped" ? body.status : "done";
    db.prepare("UPDATE operation_record SET status = ?, actual_date = ?, notes = ? WHERE id = ?").run(
      status,
      body.actualDate ? String(body.actualDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
      stringValue(body.notes, "").slice(0, 1000),
      recordId
    );
    const row = db.prepare("SELECT * FROM operation_record WHERE id = ?").get(recordId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      sendJson(response, 404, { error: "RECORD_NOT_FOUND", message: "记录不存在" });
      return;
    }
    sendJson(response, 200, mapOperation(row));
    return;
  }

  const outcomeMatch = pathname.match(/^\/api\/plans\/([^/]+)\/outcome$/);
  if (method === "POST" && outcomeMatch) {
    const planId = decodeURIComponent(outcomeMatch[1]);
    const planRow = db.prepare("SELECT * FROM planting_plan WHERE id = ?").get(planId) as
      | Record<string, unknown>
      | undefined;
    if (!planRow) {
      sendJson(response, 404, { error: "PLAN_NOT_FOUND", message: "未找到种植方案" });
      return;
    }
    const plan = mapPlan(planRow);
    const body = await readJson(request);
    const yieldKg = Math.max(0, numberValue(body.yieldKg, 0));
    const revenue = Math.max(0, numberValue(body.revenue, 0));
    const cost = Math.max(0, numberValue(body.cost, 0));
    const areaMu = getPlotAndFarm(plan.plotId)?.plot.areaMu ?? 1;
    const outcome = {
      id: makeId("outcome"),
      plotId: plan.plotId,
      planId,
      cropName: plan.cropName,
      yieldKg,
      yieldPerMu: Math.round((yieldKg / areaMu) * 10) / 10,
      quality: stringValue(body.quality, "未填写").slice(0, 200),
      revenue,
      cost,
      margin: revenue - cost,
      notes: stringValue(body.notes, "").slice(0, 1000),
      createdAt: new Date().toISOString()
    };
    insertOutcome(outcome);
    db.prepare("UPDATE planting_plan SET status = 'completed' WHERE id = ?").run(planId);
    sendJson(response, 201, outcome);
    return;
  }

  const feedbackMatch = pathname.match(/^\/api\/plans\/([^/]+)\/feedback$/);
  if (method === "POST" && feedbackMatch) {
    const planId = decodeURIComponent(feedbackMatch[1]);
    const body = await readJson(request);
    const feedback = {
      id: makeId("feedback"),
      planId,
      outcomeId: body.outcomeId ? String(body.outcomeId) : null,
      rating: Math.max(1, Math.min(5, Math.round(numberValue(body.rating, 4)))),
      comment: stringValue(body.comment, "").slice(0, 1000),
      createdAt: new Date().toISOString()
    };
    insertFeedback(feedback);
    sendJson(response, 201, feedback);
    return;
  }

  sendJson(response, 404, { error: "NOT_FOUND", message: "接口不存在" });
}

function buildBootstrap(requestedPlotId: string | null): BootstrapPayload {
  const accountRow = db.prepare("SELECT * FROM account LIMIT 1").get() as Record<string, unknown>;
  const account: Account = {
    id: String(accountRow.id),
    name: String(accountRow.name),
    ownerName: String(accountRow.owner_name),
    plan: String(accountRow.plan),
    isDemo: Boolean(accountRow.is_demo)
  };

  const farmRows = db
    .prepare("SELECT * FROM farm WHERE account_id = ? AND deleted_at IS NULL ORDER BY created_at")
    .all(account.id) as Array<Record<string, unknown>>;
  const plotRows = db
    .prepare("SELECT p.* FROM plot p JOIN farm f ON f.id=p.farm_id WHERE p.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY p.created_at, p.name")
    .all() as Array<Record<string, unknown>>;
  const farms = farmRows.map((row) => {
    const farm: Farm = {
      isPinned: Boolean(row.is_pinned),
      id: String(row.id),
      accountId: String(row.account_id),
      name: String(row.name),
      province: String(row.province),
      city: String(row.city),
      district: String(row.district),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      altitude: row.altitude === null ? undefined : Number(row.altitude)
    };
    return { ...farm, plots: plotRows.filter((plot) => plot.farm_id === farm.id).map(mapPlot) };
  });

  const validRequested = requestedPlotId && plotRows.some((row) => row.id === requestedPlotId);
  if (!plotRows.length) throw new Error("请先新建基地和地块");
  const activePlotId = validRequested ? requestedPlotId! : String(plotRows[0].id);
  let context = readPlotContext(activePlotId);
  if (!context) {
    // Keep opening an existing workspace even if an older migration left a
    // plot without its context. This is a repair path; normal reads use the
    // persisted context above.
    const activeRow = plotRows.find((row) => String(row.id) === activePlotId);
    if (!activeRow) throw new Error("地块数据缺失");
    const activePlot = mapPlot(activeRow);
    context = {
      weather: fallbackWeather(activePlot.id),
      soil: regionalPrior(activePlot),
      updatedAt: new Date().toISOString()
    };
    writePlotContext(activePlotId, context);
  }

  const latestRecommendationRun = db
    .prepare(`
      SELECT id FROM task_run
      WHERE plot_id = ? AND type = 'recommend' AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(activePlotId) as { id: string } | undefined;
  const recommendations = latestRecommendationRun
    ? (db
        .prepare("SELECT * FROM recommendation WHERE run_id = ? ORDER BY rank")
        .all(latestRecommendationRun.id) as Array<Record<string, unknown>>).map(mapRecommendation)
    : [];

  const planRow = db
    .prepare(`
      SELECT * FROM planting_plan
      WHERE plot_id = ? AND status != 'archived'
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(activePlotId) as Record<string, unknown> | undefined;
  const activePlan = planRow ? mapPlan(planRow) : null;
  const adoptedRow=activePlan?db.prepare('SELECT * FROM recommendation WHERE id=?').get(activePlan.recommendationId) as Record<string,unknown>|undefined:undefined;
  const activePlanRecommendation=adoptedRow?mapRecommendation(adoptedRow):null;
  const operations = activePlan
    ? (db
        .prepare("SELECT * FROM operation_record WHERE plan_id = ? ORDER BY planned_date, created_at")
        .all(activePlan.id) as Array<Record<string, unknown>>).map(mapOperation)
    : [];
  const outcomes = (
    db
      .prepare("SELECT * FROM outcome_record WHERE plot_id = ? ORDER BY created_at DESC")
      .all(activePlotId) as Array<Record<string, unknown>>
  ).map(mapOutcome);
  const feedback = (
    db
      .prepare(`
        SELECT f.* FROM feedback f
        JOIN outcome_record o ON o.id = f.outcome_id
        WHERE o.plot_id = ?
        ORDER BY f.created_at DESC
      `)
      .all(activePlotId) as Array<Record<string, unknown>>
  ).map(mapFeedback);

  const latestRunRow = db
    .prepare("SELECT * FROM task_run WHERE plot_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(activePlotId) as Record<string, unknown> | undefined;
  const latestRun = latestRunRow
    ? {
        id: String(latestRunRow.id),
        status: String(latestRunRow.status),
        summary: String(latestRunRow.summary),
        events: getEvents(String(latestRunRow.id))
      }
    : null;

  const evaluations = (
    db.prepare("SELECT * FROM evaluation_run ORDER BY ran_at DESC LIMIT 10").all() as Array<
      Record<string, unknown>
    >
  ).map(mapEvaluation);

  return {
    account,
    farms,
    activePlotId,
    plotContext: context,
    recommendations,
    activePlan,
    activePlanRecommendation,
    operations,
    outcomes,
    feedback,
    latestRun,
    skills: SKILLS,
    evaluations,
    model: getModelStatus(),
    meta: {
      regionCoverage: "湖北高可信规则 + 全国基础气象/土壤分析",
      dataNotice: "演示账号与历史记录为合成数据；价格和产量为公开数据估算，可被本地值覆盖。",
      demoMode: true,
      currentDate: new Date().toISOString()
    }
  };
}

function streamRunEvents(
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  afterSeq: number
): void {
  const status = getRunStatus(runId);
  if (!status) {
    sendJson(response, 404, { error: "RUN_NOT_FOUND", message: "未找到任务运行" });
    return;
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  response.flushHeaders();

  let lastSeq = afterSeq;
  const seen = new Set<number>();
  const send = (event: import("./types.js").AgentEvent) => {
    if (event.seq <= afterSeq || seen.has(event.seq)) return;
    seen.add(event.seq);
    lastSeq = Math.max(lastSeq, event.seq);
    response.write(`id: ${event.seq}\n`);
    response.write("event: agent\n");
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const backlog = getEvents(runId, afterSeq);
  backlog.forEach(send);

  const unsubscribeText = subscribeRunText(runId, text => {
    response.write(`event: text\ndata: ${JSON.stringify({ text })}\n\n`);
  });

  let closed = false;
  const unsubscribe = subscribeRun(runId, (event) => {
    if (closed) return;
    if (event) {
      send(event);
      return;
    }
    response.write("event: done\n");
    response.write(`data: ${JSON.stringify({ runId, status: getRunStatus(runId)?.status })}\n\n`);
    cleanup();
    response.end();
  });
  const heartbeat = setInterval(() => {
    if (!closed) response.write(`: heartbeat ${lastSeq}\n\n`);
  }, 12_000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    unsubscribeText();
  };
  request.on("close", cleanup);

  if (isDoneStatus(status.status)) {
    response.write("event: done\n");
    response.write(`data: ${JSON.stringify({ runId, status: status.status })}\n\n`);
    cleanup();
    response.end();
  }
}

function isDoneStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}

function getPlotAndFarm(plotId: string): { plot: Plot; farm: Farm } | null {
  const row = db
    .prepare(`
      SELECT p.*, f.id AS farm_id, f.account_id, f.name AS farm_name, f.province,
             f.city, f.district, f.latitude, f.longitude, f.altitude
      FROM plot p JOIN farm f ON f.id = p.farm_id WHERE p.id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL
    `)
    .get(plotId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    plot: mapPlot(row),
    farm: {
      id: String(row.farm_id),
      accountId: String(row.account_id),
      name: String(row.farm_name),
      province: String(row.province),
      city: String(row.city),
      district: String(row.district),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      altitude: row.altitude === null ? undefined : Number(row.altitude)
    }
  };
}

function mapPlot(row: Record<string, unknown>): Plot {
  return {
    id: String(row.id),
    farmId: String(row.farm_id),
    name: String(row.name),
    areaMu: Number(row.area_mu),
    soilTexture: String(row.soil_texture),
    irrigation: String(row.irrigation),
    drainage: String(row.drainage),
    currentCrop: String(row.current_crop),
    rotation: String(row.rotation),
    location: row.location_json ? JSON.parse(String(row.location_json)) : null,
      note: String(row.note)
  };
}

async function readJson(request: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      throw new Error("请求内容过大");
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  if (!existsSync(distPath)) {
    sendJson(response, 404, {
      error: "WEB_NOT_BUILT",
      message: "开发模式请使用 Vite 5173 端口；生产模式请先执行 pnpm build。"
    });
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = resolve(join(distPath, requested));
  const safeRoot = `${resolve(distPath)}${sep}`;
  if (!resolved.startsWith(safeRoot) && resolved !== resolve(distPath, "index.html")) {
    sendJson(response, 403, { error: "FORBIDDEN", message: "路径不允许" });
    return;
  }
  let target = resolved;
  if (!existsSync(target) || !statSync(target).isFile()) {
    target = resolve(distPath, "index.html");
  }
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2"
  };
  response.writeHead(200, {
    "content-type": mime[extname(target)] ?? "application/octet-stream",
    "cache-control": extname(target) === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
  });
  createReadStream(target).pipe(response);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("x-frame-options", "SAMEORIGIN");
  response.setHeader(
    "permissions-policy",
    "camera=(self), microphone=(), geolocation=(self), payment=()"
  );
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少字段 ${name}`);
  }
  return value.trim();
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeOverrides(value: unknown): PriceOverride {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const result: PriceOverride = {};
  for (const key of ["pricePerKg", "yieldPerMu", "costPerMu"] as const) {
    const number = Number(input[key]);
    if (Number.isFinite(number) && number > 0) {
      result[key] = number;
    }
  }
  return result;
}

function normalizeCapabilityOverrides(value: unknown): RuntimeCapabilityOverride[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 32)
    .flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const input = item as Record<string, unknown>;
      const capabilityType = input.capabilityType;
      const capabilityId = typeof input.capabilityId === "string" ? input.capabilityId.trim() : "";
      if (
        !["skill", "mcp", "knowledge"].includes(String(capabilityType)) ||
        !capabilityId ||
        typeof input.enabled !== "boolean"
      ) {
        return [];
      }
      return [{
        capabilityType: capabilityType as RuntimeCapabilityOverride["capabilityType"],
        capabilityId: capabilityId.slice(0, 200),
        enabled: input.enabled
      }];
    });
}

process.on("SIGTERM", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
