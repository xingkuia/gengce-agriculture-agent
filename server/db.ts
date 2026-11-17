import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  CROPS,
  CROP_ORDER,
  buildPlan,
  computeEconomics,
  seasonStatus,
  toDateString
} from "./data.js";
import { regionalPrior } from "./tools/soil.js";
import { fallbackWeather } from "./tools/weather.js";
import type {
  Account,
  AgentEvent,
  CropCode,
  EvaluationSummary,
  Farm,
  FeedbackRecord,
  OperationRecord,
  OutcomeRecord,
  PlantingPlan,
  Plot,
  PlotContext,
  Recommendation
} from "./types.js";

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/agri.db");
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function migrateDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      plan TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS farm (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      name TEXT NOT NULL,
      province TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plot (
      id TEXT PRIMARY KEY,
      farm_id TEXT NOT NULL REFERENCES farm(id),
      name TEXT NOT NULL,
      area_mu REAL NOT NULL,
      soil_texture TEXT NOT NULL,
      irrigation TEXT NOT NULL,
      drainage TEXT NOT NULL,
      current_crop TEXT NOT NULL,
      rotation TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plot_context (
      plot_id TEXT PRIMARY KEY REFERENCES plot(id),
      weather_json TEXT NOT NULL,
      soil_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_run (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      plot_id TEXT NOT NULL REFERENCES plot(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT 'mock',
      model_name TEXT NOT NULL DEFAULT 'deterministic',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES task_run(id),
      seq INTEGER NOT NULL,
      agent TEXT NOT NULL,
      agent_label TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS recommendation (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES task_run(id),
      plot_id TEXT NOT NULL REFERENCES plot(id),
      crop_code TEXT NOT NULL,
      crop_name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      score REAL NOT NULL,
      confidence REAL NOT NULL,
      risk_level TEXT NOT NULL,
      season_status TEXT NOT NULL,
      summary TEXT NOT NULL,
      decision_reasons_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      economics_json TEXT NOT NULL,
      goal_scores_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS planting_plan (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      plot_id TEXT NOT NULL REFERENCES plot(id),
      recommendation_id TEXT NOT NULL REFERENCES recommendation(id),
      crop_code TEXT NOT NULL,
      crop_name TEXT NOT NULL,
      status TEXT NOT NULL,
      season TEXT NOT NULL,
      start_date TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operation_record (
      id TEXT PRIMARY KEY,
      plot_id TEXT NOT NULL REFERENCES plot(id),
      plan_id TEXT NOT NULL REFERENCES planting_plan(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      planned_date TEXT NOT NULL,
      actual_date TEXT,
      status TEXT NOT NULL,
      notes TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outcome_record (
      id TEXT PRIMARY KEY,
      plot_id TEXT NOT NULL REFERENCES plot(id),
      plan_id TEXT NOT NULL REFERENCES planting_plan(id),
      crop_name TEXT NOT NULL,
      yield_kg REAL NOT NULL,
      yield_per_mu REAL NOT NULL,
      quality TEXT NOT NULL,
      revenue REAL NOT NULL,
      cost REAL NOT NULL,
      margin REAL NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES planting_plan(id),
      outcome_id TEXT REFERENCES outcome_record(id),
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_version (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      change_note TEXT NOT NULL,
      evaluation_pass_rate REAL,
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, version)
    );

    CREATE TABLE IF NOT EXISTS evaluation_run (
      id TEXT PRIMARY KEY,
      suite_name TEXT NOT NULL,
      agent_version TEXT NOT NULL,
      status TEXT NOT NULL,
      pass_rate REAL NOT NULL,
      cases INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      ran_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES account(id),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      description TEXT NOT NULL,
      applies_to TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      current_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_version (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skill(id),
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      instruction TEXT NOT NULL,
      guidance_json TEXT,
      created_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE(skill_id, version)
    );

    CREATE TABLE IF NOT EXISTS capability_binding (
      id TEXT PRIMARY KEY,
      capability_type TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(capability_type, capability_id, scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS mcp_server (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      endpoint TEXT,
      request_headers_json TEXT NOT NULL DEFAULT '{}',
      command TEXT,
      args_json TEXT NOT NULL DEFAULT '[]',
      env_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'unconfigured',
      status_message TEXT NOT NULL DEFAULT '',
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS mcp_tool (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES mcp_server(id),
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      output_schema_json TEXT,
      annotations_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      execution_mode TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(server_id, name)
    );

    CREATE TABLE IF NOT EXISTS mcp_call_log (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES mcp_server(id),
      tool_name TEXT NOT NULL,
      run_id TEXT REFERENCES task_run(id),
      status TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_approval_request (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES task_run(id),
      account_id TEXT NOT NULL REFERENCES account(id),
      server_id TEXT NOT NULL REFERENCES mcp_server(id),
      server_name TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_title TEXT NOT NULL,
      arguments_json TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_document (
      id TEXT PRIMARY KEY,
      knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id),
      title TEXT NOT NULL,
      source_name TEXT NOT NULL,
      publisher TEXT,
      published_at TEXT,
      source_url TEXT,
      retrieved_at TEXT,
      mime_type TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunk (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_document(id),
      knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id),
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capability_snapshot (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE REFERENCES task_run(id),
      account_id TEXT NOT NULL REFERENCES account(id),
      plot_id TEXT NOT NULL REFERENCES plot(id),
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_seed_migration (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_event_run ON agent_event(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_recommendation_run ON recommendation(run_id);
    CREATE INDEX IF NOT EXISTS idx_plan_plot ON planting_plan(plot_id, status);
    CREATE INDEX IF NOT EXISTS idx_operation_plan ON operation_record(plan_id);
    CREATE INDEX IF NOT EXISTS idx_skill_account ON skill(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_skill_version ON skill_version(skill_id, status);
    CREATE INDEX IF NOT EXISTS idx_binding_scope ON capability_binding(scope_type, scope_id, capability_type);
    CREATE INDEX IF NOT EXISTS idx_mcp_account ON mcp_server(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_mcp_tool_server ON mcp_tool(server_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_mcp_call_server ON mcp_call_log(server_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mcp_approval_run ON mcp_approval_request(run_id, status);
    CREATE INDEX IF NOT EXISTS idx_mcp_approval_expiry ON mcp_approval_request(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_base(account_id, scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_document ON knowledge_document(knowledge_base_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_base ON knowledge_chunk(knowledge_base_id, document_id);
    CREATE INDEX IF NOT EXISTS idx_capability_snapshot_run ON capability_snapshot(run_id);
  `);

  const mcpToolColumns = db.prepare("PRAGMA table_info(mcp_tool)").all() as Array<{ name: string }>;
  if (!mcpToolColumns.some(column => column.name === "execution_mode")) {
    db.exec("ALTER TABLE mcp_tool ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'auto'");
  }

  const knowledgeDocumentColumns = db.prepare("PRAGMA table_info(knowledge_document)").all() as Array<{ name: string }>;
  const knowledgeDocumentColumnNames = new Set(knowledgeDocumentColumns.map(column => column.name));
  for (const column of ["publisher", "published_at", "source_url", "retrieved_at"]) {
    if (!knowledgeDocumentColumnNames.has(column)) {
      db.exec(`ALTER TABLE knowledge_document ADD COLUMN ${column} TEXT`);
    }
  }

  db.prepare(`
    UPDATE account
    SET name = '耕策智能体'
    WHERE id = 'acct-demo' AND name = '荆楚禾野联合示范体'
  `).run();
  db.prepare(`
    UPDATE account
    SET owner_name = '耕师傅'
    WHERE id = 'acct-demo' AND owner_name = '陈师傅'
  `).run();
}

export function recoverInterruptedRuns(): number {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE task_run
    SET status = 'failed',
        completed_at = ?,
        summary = CASE
          WHEN trim(summary) = '' THEN '服务已重启，上一次运行被中断，请重新发起。'
          ELSE summary
        END
    WHERE status = 'running'
  `).run(now);
  db.prepare(`
    UPDATE mcp_approval_request
    SET status = 'expired',
        error_message = '本地服务已重启，确认请求失效。',
        decided_at = ?
    WHERE status = 'pending'
  `).run(now);
  return Number(result.changes);
}

export function seedDatabase(): void {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM account").get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const createdAt = new Date().toISOString();
  const today = new Date();
  const account: Account = {
    id: "acct-demo",
    name: "耕策智能体",
    ownerName: "耕师傅",
    plan: "合作社版 · 演示",
    isDemo: true
  };
  const farms: Farm[] = [
    {
      id: "farm-xiangzhou",
      accountId: account.id,
      name: "襄州示范农场",
      province: "湖北省",
      city: "襄阳市",
      district: "襄州区",
      latitude: 32.087,
      longitude: 112.211,
      altitude: 98
    },
    {
      id: "farm-jiangxia",
      accountId: account.id,
      name: "江夏合作基地",
      province: "湖北省",
      city: "武汉市",
      district: "江夏区",
      latitude: 30.348,
      longitude: 114.321,
      altitude: 36
    }
  ];
  const plots: Plot[] = [
    {
      id: "plot-east",
      farmId: "farm-xiangzhou",
      name: "东坡田",
      areaMu: 42,
      soilTexture: "壤质黏土",
      irrigation: "沟渠灌溉",
      drainage: "良好",
      currentCrop: "水稻已收",
      rotation: "稻油轮作",
      note: "田块平整，东侧靠近排水沟。"
    },
    {
      id: "plot-river",
      farmId: "farm-xiangzhou",
      name: "河湾地",
      areaMu: 28,
      soilTexture: "粉砂质壤土",
      irrigation: "机井灌溉",
      drainage: "中等",
      currentCrop: "玉米已收",
      rotation: "小麦玉米轮作",
      note: "地势略低，连续降雨后需优先排涝。"
    },
    {
      id: "plot-west",
      farmId: "farm-jiangxia",
      name: "西岗田",
      areaMu: 35,
      soilTexture: "壤质黏土",
      irrigation: "塘堰补水",
      drainage: "良好",
      currentCrop: "水稻已收",
      rotation: "稻油轮作",
      note: "土壤保水保肥能力较好。"
    }
  ];

  db.prepare(
    "INSERT INTO account (id, name, owner_name, plan, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(account.id, account.name, account.ownerName, account.plan, 1, createdAt);
  const insertFarm = db.prepare(`
    INSERT INTO farm (id, account_id, name, province, city, district, latitude, longitude, altitude, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const farm of farms) {
    insertFarm.run(
      farm.id,
      farm.accountId,
      farm.name,
      farm.province,
      farm.city,
      farm.district,
      farm.latitude,
      farm.longitude,
      farm.altitude ?? null,
      createdAt
    );
  }

  const insertPlot = db.prepare(`
    INSERT INTO plot (id, farm_id, name, area_mu, soil_texture, irrigation, drainage, current_crop, rotation, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const plot of plots) {
    insertPlot.run(
      plot.id,
      plot.farmId,
      plot.name,
      plot.areaMu,
      plot.soilTexture,
      plot.irrigation,
      plot.drainage,
      plot.currentCrop,
      plot.rotation,
      plot.note,
      createdAt
    );
    writePlotContext(plot.id, {
      weather: fallbackWeather(plot.id),
      soil: regionalPrior(plot),
      updatedAt: createdAt
    });
  }

  const activePlot = plots[0];
  const weather = fallbackWeather(activePlot.id);
  const soil = regionalPrior(activePlot);
  writePlotContext(activePlot.id, { weather, soil, updatedAt: createdAt });

  const latestRunId = "run-demo-current";
  db.prepare(`
    INSERT INTO task_run (id, account_id, plot_id, type, status, input_json, summary, model_provider, model_name, created_at, completed_at)
    VALUES (?, ?, ?, 'recommend', 'completed', ?, ?, 'mock', 'deterministic', ?, ?)
  `).run(
    latestRunId,
    account.id,
    activePlot.id,
    JSON.stringify({ goal: "profit", message: "结合当前地块条件生成种植建议" }),
    "已完成 5 个候选作物评估；冬小麦在稳健收益和省工目标下领先，冬油菜在养地目标下领先。",
    new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    new Date(Date.now() - 22 * 60 * 1000).toISOString()
  );

  insertDemoEvents(latestRunId, weather.source, soil.source);
  const recommendations = CROP_ORDER.map((code, index) => {
    const crop = CROPS[code];
    const status = seasonStatus(crop, today.getMonth() + 1);
    const plan = buildPlan(crop, activePlot, weather, soil, today);
    return {
      id: `rec-demo-${code}`,
      runId: latestRunId,
      plotId: activePlot.id,
      cropCode: code,
      cropName: crop.name,
      rank: index + 1,
      score: crop.goals.profit,
      confidence: status === "适播" ? 0.88 : 0.62,
      riskLevel: crop.riskLevel,
      seasonStatus: status,
      summary: crop.fitNote,
      decisionReasons: [
        crop.rotationValue,
        `未来 7 日最低温 ${Math.min(...weather.daily.map((day) => day.tempMin))}°C，需按天气窗口安排播种与管理。`,
        soil.isFallback ? "土壤证据为区域先验，正式投入前需测土校准。" : "土壤属性来自公开数据。"
      ],
      warnings:
        status === "适播"
          ? weather.warnings.map((warning) => warning.title)
          : ["当前不在高置信适播窗口", "仅建议用于下一季提前比较"],
      economics: computeEconomics(crop, activePlot.areaMu),
      goalScores: crop.goals,
      evidence: crop.evidence,
      plan
    } satisfies Recommendation;
  });
  insertRecommendations(recommendations);

  const wheat = recommendations.find((recommendation) => recommendation.cropCode === "wheat")!;
  const activePlanId = "plan-demo-wheat";
  insertPlan({
    id: activePlanId,
    accountId: account.id,
    plotId: activePlot.id,
    recommendationId: wheat.id,
    cropCode: wheat.cropCode,
    cropName: wheat.cropName,
    status: "active",
    season: wheat.plan.season,
    startDate: toDateString(today),
    plan: wheat.plan,
    createdAt
  });

  insertOperation({
    id: "op-demo-1",
    plotId: activePlot.id,
    planId: activePlanId,
    type: "整地",
    title: "秸秆粉碎还田",
    plannedDate: toDateString(addDays(today, -6)),
    actualDate: toDateString(addDays(today, -5)),
    status: "done",
    notes: "秸秆切碎长度约 8 cm，东侧排水沟已清理。",
    cost: 1260,
    createdAt
  });
  insertOperation({
    id: "op-demo-2",
    plotId: activePlot.id,
    planId: activePlanId,
    type: "播种",
    title: "冬小麦精量播种",
    plannedDate: toDateString(addDays(today, -2)),
    actualDate: toDateString(addDays(today, -1)),
    status: "done",
    notes: "实际用种 11.2 kg/亩，播深约 4 cm，土壤墒情适宜。",
    cost: 3864,
    createdAt
  });
  insertOperation({
    id: "op-demo-3",
    plotId: activePlot.id,
    planId: activePlanId,
    type: "苗期调查",
    title: "查苗补种与田间排水复查",
    plannedDate: toDateString(addDays(today, 12)),
    actualDate: null,
    status: "planned",
    notes: "重点检查低洼区和播种深度不一致区域。",
    cost: 0,
    createdAt
  });

  const historyRunId = "run-history-2025";
  db.prepare(`
    INSERT INTO task_run (id, account_id, plot_id, type, status, input_json, summary, model_provider, model_name, created_at, completed_at)
    VALUES (?, ?, ?, 'recommend', 'completed', ?, '2025 年水稻方案已完成并归档。', 'mock', 'deterministic', ?, ?)
  `).run(
    historyRunId,
    account.id,
    activePlot.id,
    JSON.stringify({ archive: true }),
    "2025-03-28T02:10:00.000Z",
    "2025-09-25T08:00:00.000Z"
  );
  const riceCrop = CROPS.rice;
  const historyPlan = buildPlan(riceCrop, activePlot, weather, soil, new Date("2025-04-05T00:00:00+08:00"));
  insertRecommendation({
    id: "rec-history-rice",
    runId: historyRunId,
    plotId: activePlot.id,
    cropCode: "rice",
    cropName: riceCrop.name,
    rank: 1,
    score: 82,
    confidence: 0.86,
    riskLevel: "中",
    seasonStatus: "适播",
    summary: "2025 年一季中稻历史方案。",
    decisionReasons: ["稻油轮作衔接", "灌溉条件满足", "历史反馈已归档"],
    warnings: [],
    economics: computeEconomics(riceCrop, activePlot.areaMu),
    goalScores: riceCrop.goals,
    evidence: riceCrop.evidence,
    plan: historyPlan
  });
  insertPlan({
    id: "plan-history-rice",
    accountId: account.id,
    plotId: activePlot.id,
    recommendationId: "rec-history-rice",
    cropCode: "rice",
    cropName: riceCrop.name,
    status: "completed",
    season: "2025 一季中稻",
    startDate: "2025-04-05",
    plan: { ...historyPlan, cropName: "2025 一季中稻" },
    createdAt: "2025-03-28T02:15:00.000Z"
  });
  insertOutcome({
    id: "outcome-demo-rice",
    plotId: activePlot.id,
    planId: "plan-history-rice",
    cropName: "水稻",
    yieldKg: 25_284,
    yieldPerMu: 602,
    quality: "二等，水分 13.6%",
    revenue: 70_290,
    cost: 40_530,
    margin: 29_760,
    notes: "8 月下旬高温过程后加强灌溉，实收产量高于方案中位值约 1.7%。",
    createdAt: "2025-09-24T06:00:00.000Z"
  });
  insertFeedback({
    id: "feedback-demo-rice",
    planId: "plan-history-rice",
    outcomeId: "outcome-demo-rice",
    rating: 5,
    comment: "高温预警后的灌水提示及时，实收记录也方便复盘。",
    createdAt: "2025-09-25T07:40:00.000Z"
  });

  seedAgentVersions(createdAt);
  seedEvaluations(createdAt);
}

export function writePlotContext(plotId: string, context: PlotContext): void {
  db.prepare(`
    INSERT INTO plot_context (plot_id, weather_json, soil_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plot_id) DO UPDATE SET
      weather_json = excluded.weather_json,
      soil_json = excluded.soil_json,
      updated_at = excluded.updated_at
  `).run(
    plotId,
    JSON.stringify(context.weather),
    JSON.stringify(context.soil),
    context.updatedAt
  );
}

export function readPlotContext(plotId: string): PlotContext | null {
  const row = db.prepare("SELECT * FROM plot_context WHERE plot_id = ?").get(plotId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    weather: JSON.parse(String(row.weather_json)),
    soil: JSON.parse(String(row.soil_json)),
    updatedAt: String(row.updated_at)
  };
}

export function insertRecommendation(recommendation: Recommendation): void {
  db.prepare(`
    INSERT INTO recommendation (
      id, run_id, plot_id, crop_code, crop_name, rank, score, confidence, risk_level,
      season_status, summary, decision_reasons_json, warnings_json, economics_json,
      goal_scores_json, evidence_json, plan_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recommendation.id,
    recommendation.runId,
    recommendation.plotId,
    recommendation.cropCode,
    recommendation.cropName,
    recommendation.rank,
    recommendation.score,
    recommendation.confidence,
    recommendation.riskLevel,
    recommendation.seasonStatus,
    recommendation.summary,
    JSON.stringify(recommendation.decisionReasons),
    JSON.stringify(recommendation.warnings),
    JSON.stringify(recommendation.economics),
    JSON.stringify(recommendation.goalScores),
    JSON.stringify(recommendation.evidence),
    JSON.stringify(recommendation.plan),
    new Date().toISOString()
  );
}

export function insertPlan(plan: PlantingPlan): void {
  db.prepare(`
    INSERT INTO planting_plan (
      id, account_id, plot_id, recommendation_id, crop_code, crop_name,
      status, season, start_date, plan_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plan.id,
    plan.accountId,
    plan.plotId,
    plan.recommendationId,
    plan.cropCode,
    plan.cropName,
    plan.status,
    plan.season,
    plan.startDate,
    JSON.stringify(plan.plan),
    plan.createdAt
  );
}

export function insertOperation(record: OperationRecord): void {
  db.prepare(`
    INSERT INTO operation_record (
      id, plot_id, plan_id, type, title, planned_date, actual_date,
      status, notes, cost, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.plotId,
    record.planId,
    record.type,
    record.title,
    record.plannedDate,
    record.actualDate,
    record.status,
    record.notes,
    record.cost,
    record.createdAt
  );
}

export function insertOutcome(outcome: OutcomeRecord): void {
  db.prepare(`
    INSERT INTO outcome_record (
      id, plot_id, plan_id, crop_name, yield_kg, yield_per_mu, quality,
      revenue, cost, margin, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    outcome.id,
    outcome.plotId,
    outcome.planId,
    outcome.cropName,
    outcome.yieldKg,
    outcome.yieldPerMu,
    outcome.quality,
    outcome.revenue,
    outcome.cost,
    outcome.margin,
    outcome.notes,
    outcome.createdAt
  );
}

export function insertFeedback(feedback: FeedbackRecord): void {
  db.prepare(`
    INSERT INTO feedback (id, plan_id, outcome_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    feedback.id,
    feedback.planId,
    feedback.outcomeId,
    feedback.rating,
    feedback.comment,
    feedback.createdAt
  );
}

export function insertEvent(event: AgentEvent): void {
  db.prepare(`
    INSERT INTO agent_event (
      run_id, seq, agent, agent_label, kind, title, detail, status, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.runId,
    event.seq,
    event.agent,
    event.agentLabel,
    event.kind,
    event.title,
    event.detail,
    event.status,
    event.payload === undefined ? null : JSON.stringify(event.payload),
    event.createdAt
  );
}

export function getEvents(runId: string, afterSeq = 0): AgentEvent[] {
  const rows = db
    .prepare("SELECT * FROM agent_event WHERE run_id = ? AND seq > ? ORDER BY seq")
    .all(runId, afterSeq) as Array<Record<string, unknown>>;
  return rows.map(mapEvent);
}

export function mapEvent(row: Record<string, unknown>): AgentEvent {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    seq: Number(row.seq),
    agent: String(row.agent),
    agentLabel: String(row.agent_label),
    kind: String(row.kind) as AgentEvent["kind"],
    title: String(row.title),
    detail: String(row.detail),
    status: String(row.status) as AgentEvent["status"],
    payload: row.payload_json ? JSON.parse(String(row.payload_json)) : undefined,
    createdAt: String(row.created_at)
  };
}

export function mapRecommendation(row: Record<string, unknown>): Recommendation {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    plotId: String(row.plot_id),
    cropCode: String(row.crop_code) as CropCode,
    cropName: String(row.crop_name),
    rank: Number(row.rank),
    score: Number(row.score),
    confidence: Number(row.confidence),
    riskLevel: String(row.risk_level),
    seasonStatus: String(row.season_status) as Recommendation["seasonStatus"],
    summary: String(row.summary),
    decisionReasons: JSON.parse(String(row.decision_reasons_json)),
    warnings: JSON.parse(String(row.warnings_json)),
    economics: JSON.parse(String(row.economics_json)),
    goalScores: JSON.parse(String(row.goal_scores_json)),
    evidence: JSON.parse(String(row.evidence_json)),
    plan: JSON.parse(String(row.plan_json))
  };
}

export function mapPlan(row: Record<string, unknown>): PlantingPlan {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    plotId: String(row.plot_id),
    recommendationId: String(row.recommendation_id),
    cropCode: String(row.crop_code) as CropCode,
    cropName: String(row.crop_name),
    status: String(row.status) as PlantingPlan["status"],
    season: String(row.season),
    startDate: String(row.start_date),
    plan: JSON.parse(String(row.plan_json)),
    createdAt: String(row.created_at)
  };
}

export function mapOperation(row: Record<string, unknown>): OperationRecord {
  return {
    id: String(row.id),
    plotId: String(row.plot_id),
    planId: String(row.plan_id),
    type: String(row.type),
    title: String(row.title),
    plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null,
    status: String(row.status) as OperationRecord["status"],
    notes: String(row.notes),
    cost: Number(row.cost),
    createdAt: String(row.created_at)
  };
}

export function mapOutcome(row: Record<string, unknown>): OutcomeRecord {
  return {
    id: String(row.id),
    plotId: String(row.plot_id),
    planId: String(row.plan_id),
    cropName: String(row.crop_name),
    yieldKg: Number(row.yield_kg),
    yieldPerMu: Number(row.yield_per_mu),
    quality: String(row.quality),
    revenue: Number(row.revenue),
    cost: Number(row.cost),
    margin: Number(row.margin),
    notes: String(row.notes),
    createdAt: String(row.created_at)
  };
}

export function mapFeedback(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    outcomeId: row.outcome_id ? String(row.outcome_id) : null,
    rating: Number(row.rating),
    comment: String(row.comment),
    createdAt: String(row.created_at)
  };
}

export function mapEvaluation(row: Record<string, unknown>): EvaluationSummary {
  return {
    id: String(row.id),
    suiteName: String(row.suite_name),
    agentVersion: String(row.agent_version),
    status: String(row.status) as EvaluationSummary["status"],
    passRate: Number(row.pass_rate),
    cases: Number(row.cases),
    metrics: JSON.parse(String(row.metrics_json)),
    ranAt: String(row.ran_at)
  };
}

export function makeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function insertRecommendations(recommendations: Recommendation[]): void {
  for (const recommendation of recommendations) {
    insertRecommendation(recommendation);
  }
}

function insertDemoEvents(runId: string, weatherSource: string, soilSource: string): void {
  const start = Date.now() - 24 * 60 * 1000;
  const events: Array<Omit<AgentEvent, "id" | "runId" | "createdAt">> = [
    {
      seq: 1,
      agent: "orchestrator",
      agentLabel: "任务编排",
      kind: "plan",
      title: "已生成 6 节点执行图",
      detail: "并行读取气象与土壤，再进入选种、经济测算、农艺编译和独立校验。",
      status: "success"
    },
    {
      seq: 2,
      agent: "weather",
      agentLabel: "气象风险",
      kind: "tool",
      title: weatherSource === "open-meteo" ? "未来 7 日天气已同步" : "使用缓存天气演示数据",
      detail: "完成低温、大风、降水和蒸散阈值检查。",
      status: weatherSource === "open-meteo" ? "success" : "warning"
    },
    {
      seq: 3,
      agent: "soil",
      agentLabel: "土壤证据",
      kind: "tool",
      title: soilSource === "soilgrids" ? "表层土壤属性已获取" : "土壤采用区域先验",
      detail: soilSource === "soilgrids" ? "已获取 0-5 cm 黏粒、砂粒、pH 与有机碳。" : "公开土壤服务超时，已标注降级来源并提示测土校准。",
      status: soilSource === "soilgrids" ? "success" : "warning"
    },
    {
      seq: 4,
      agent: "crop-selection",
      agentLabel: "选种决策",
      kind: "a2a",
      title: "5 个候选作物已分目标排序",
      detail: "未合并为单一结论；稳健收益、低风险、省工和养地分别保留候选。",
      status: "success"
    },
    {
      seq: 5,
      agent: "economics",
      agentLabel: "经济测算",
      kind: "tool",
      title: "公开数据区间已生成",
      detail: "价格、亩产和成本均使用可覆盖字段，未标记为实时收购价。",
      status: "success"
    },
    {
      seq: 6,
      agent: "agronomy",
      agentLabel: "农艺执行",
      kind: "a2a",
      title: "候选方案任务草案已编译",
      detail: "按湖北区域播期、水肥和天气阈值生成可执行任务。",
      status: "success"
    },
    {
      seq: 7,
      agent: "verifier",
      agentLabel: "独立校验",
      kind: "verify",
      title: "校验通过 · 带数据质量提示",
      detail: "单位、季节、轮作和经济计算通过；土壤先验被保留为显式风险。",
      status: "success"
    }
  ];
  for (const event of events) {
    insertEvent({
      ...event,
      id: 0,
      runId,
      createdAt: new Date(start + event.seq * 2200).toISOString()
    });
  }
}

function seedAgentVersions(createdAt: string): void {
  const versions = [
    ["orchestrator", "1.3.0", "stable", "支持按数据质量动态插入修复节点", 0.96],
    ["crop-selection", "1.5.0", "stable", "增加目标分离排序与不适播保护", 0.94],
    ["agronomy", "1.5.2", "candidate", "加入土壤降级时的排水复核任务", 0.91],
    ["verifier", "1.6.0", "stable", "新增单位、轮作和证据覆盖硬校验", 0.98]
  ];
  for (const [agentId, version, status, note, passRate] of versions) {
    db.prepare(`
      INSERT INTO agent_version (id, agent_id, version, status, change_note, evaluation_pass_rate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `version-${agentId}-${version}`,
      String(agentId),
      String(version),
      String(status),
      String(note),
      Number(passRate),
      createdAt
    );
  }
}

function seedEvaluations(createdAt: string): void {
  const metrics = [
    { name: "结构化输出", value: "48/48", target: "100%", passed: true },
    { name: "数值复算", value: "32/32", target: "100%", passed: true },
    { name: "不适播保护", value: "12/12", target: "100%", passed: true },
    { name: "证据覆盖", value: "46/48", target: "≥95%", passed: true },
    { name: "修复循环", value: "6/6", target: "100%", passed: true }
  ];
  db.prepare(`
    INSERT INTO evaluation_run (id, suite_name, agent_version, status, pass_rate, cases, metrics_json, ran_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "eval-demo-001",
    "湖北秋冬种回归集",
    "verifier@1.6.0",
    "passed",
    0.96,
    48,
    JSON.stringify(metrics),
    new Date(new Date(createdAt).getTime() - 3 * 60 * 60 * 1000).toISOString()
  );
}

function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}
