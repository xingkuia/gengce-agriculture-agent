import { EventEmitter } from "node:events";
import {
  CROPS,
  CROP_ORDER,
  buildPlan,
  computeEconomics,
  isInSuitableWindow,
  round,
  seasonStatus
} from "../data.js";
import {
  db,
  insertEvent,
  insertRecommendation,
  makeId,
  mapOperation,
  mapPlan,
  readPlotContext,
  writePlotContext
} from "../db.js";
import { plotPosition } from "../geo.js";
import { repairAgentText, verifyGroundedText } from "../grounding.js";
import { runReadonlyMcpTools } from "../mcp-agent.js";
import { selectQuestionSkill } from "../skill-guidance.js";
import { SKILL_BY_ID } from "../skills.js";
import { getSoil } from "../tools/soil.js";
import { getWeather } from "../tools/weather.js";
import type {
  AgentEvent,
  CapabilitySnapshot,
  CropCode,
  Farm,
  OperationRecord,
  PlantingPlan,
  Plot,
  PlotContext,
  PriceOverride,
  Recommendation,
  RuntimeCapabilityOverride,
  SoilSnapshot,
  VerificationIssue,
  WeatherSnapshot
} from "../types.js";

export { repairAgentText } from "../grounding.js";

export type RunMode = "recommend" | "question";
export type RunGoal = "profit" | "low_risk" | "labor_saving" | "soil_health";

export interface StartRunInput {
  accountId: string;
  plotId: string;
  mode: RunMode;
  goal?: RunGoal;
  message?: string;
  overrides?: PriceOverride;
  capabilityOverrides?: RuntimeCapabilityOverride[];
}

export interface RunContext {
  plot: Plot;
  farm: Farm;
}

export interface McpEvidenceResult {
  evidence?: string;
  summary?: string;
  sources: string[];
}

export interface ActivePlanContext {
  plan: PlantingPlan | null;
  operations: OperationRecord[];
}

interface RunBus {
  emitter: EventEmitter;
  done: boolean;
  seq: number;
  draft?: string;
}

const runBuses = new Map<string, RunBus>();

export function createRunBus(runId: string): void {
  const bus: RunBus = { emitter: new EventEmitter(), done: false, seq: 0 };
  bus.emitter.setMaxListeners(20);
  runBuses.set(runId, bus);
}

export function streamDraft(runId: string, delta: string): void {
  const bus = runBuses.get(runId);
  if (!bus) return;
  bus.draft = (bus.draft ?? "") + delta;
  bus.emitter.emit("text", bus.draft);
}

export function subscribeRunText(runId: string, listener: (text: string) => void): () => void {
  const bus = runBuses.get(runId);
  bus?.emitter.on("text", listener);
  if (bus?.draft) listener(bus.draft);
  return () => {
    bus?.emitter.off("text", listener);
  };
}

export function subscribeRunEvents(
  runId: string,
  listener: (event: AgentEvent | null) => void
): () => void {
  let bus = runBuses.get(runId);
  if (!bus) {
    bus = { emitter: new EventEmitter(), done: isRunDone(runId), seq: currentEventSeq(runId) };
    runBuses.set(runId, bus);
  }
  const onEvent = (event: AgentEvent) => listener(event);
  const onDone = () => listener(null);
  bus.emitter.on("event", onEvent);
  bus.emitter.on("done", onDone);
  if (bus.done) queueMicrotask(onDone);
  return () => {
    bus?.emitter.off("event", onEvent);
    bus?.emitter.off("done", onDone);
  };
}

export function finishRunBus(runId: string): void {
  const bus = runBuses.get(runId);
  if (!bus) return;
  bus.done = true;
  bus.emitter.emit("done");
}

export async function failRun(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "未知运行错误";
  try {
    db.prepare("UPDATE task_run SET status = 'failed', summary = ?, completed_at = ? WHERE id = ?").run(
      `任务失败：${message}`,
      new Date().toISOString(),
      runId
    );
    await emitRunEvent(
      runId,
      "orchestrator",
      "system",
      "Mastra 工作流执行失败",
      message,
      "error",
      { artifact: "MastraWorkflowFailure", error: message }
    );
  } finally {
    finishRunBus(runId);
  }
}

export function nextEventSeq(runId: string): number {
  const bus = runBuses.get(runId);
  if (bus) {
    bus.seq += 1;
    return bus.seq;
  }
  return currentEventSeq(runId) + 1;
}

export async function emitRunEvent(
  runId: string,
  agentId: string,
  kind: AgentEvent["kind"],
  title: string,
  detail: string,
  status: AgentEvent["status"],
  payload: unknown,
  delayMs = 0
): Promise<AgentEvent> {
  if (process.env.AGENT_DEMO_DELAYS === "true" && delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  const skill = SKILL_BY_ID.get(agentId);
  const event: AgentEvent = {
    id: 0,
    runId,
    seq: nextEventSeq(runId),
    agent: agentId,
    agentLabel: skill?.name.replace(" Agent", "") ?? agentId,
    kind,
    title,
    detail,
    status,
    payload,
    createdAt: new Date().toISOString()
  };
  insertEvent(event);
  runBuses.get(runId)?.emitter.emit("event", event);
  return event;
}

export function loadRunContext(plotId: string): RunContext | null {
  const row = db
    .prepare(`
      SELECT p.*, f.id AS farm_id, f.account_id, f.name AS farm_name, f.province,
             f.city, f.district, f.latitude, f.longitude, f.altitude
      FROM plot p
      JOIN farm f ON f.id = p.farm_id
      WHERE p.id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL
    `)
    .get(plotId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    plot: {
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
    },
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

export async function ensureQuestionContext(
  context: RunContext
): Promise<{ plotContext: PlotContext; refreshed: boolean }> {
  let cached = readPlotContext(context.plot.id);
  if (!cached) {
    const [weather, soil] = await Promise.all([
      getWeather(context.plot, context.farm),
      getSoil(context.plot, context.farm)
    ]);
    cached = { weather, soil, updatedAt: new Date().toISOString() };
    writePlotContext(context.plot.id, cached);
    return { plotContext: cached, refreshed: true };
  }
  if (cached.soil.source === "regional-prior") {
    cached = {
      ...cached,
      soil: await getSoil(context.plot, context.farm, cached.soil),
      updatedAt: new Date().toISOString()
    };
    writePlotContext(context.plot.id, cached);
  }
  if (Date.now() - Date.parse(cached.updatedAt) > 30 * 60_000 || !Number.isFinite(Date.parse(cached.updatedAt))) {
    const [weather, soil] = await Promise.all([
      getWeather(context.plot, context.farm),
      getSoil(context.plot, context.farm, cached.soil)
    ]);
    cached = { weather, soil, updatedAt: new Date().toISOString() };
    writePlotContext(context.plot.id, cached);
    return { plotContext: cached, refreshed: true };
  }
  return { plotContext: cached, refreshed: false };
}

export async function fetchDecisionEvidence(
  context: RunContext
): Promise<{ weather: WeatherSnapshot; soil: SoilSnapshot }> {
  const [weather, soil] = await Promise.all([
    getWeather(context.plot, context.farm),
    getSoil(context.plot, context.farm, readPlotContext(context.plot.id)?.soil)
  ]);
  writePlotContext(context.plot.id, {
    weather,
    soil,
    updatedAt: new Date().toISOString()
  });
  return { weather, soil };
}

export function buildRecommendations(
  runId: string,
  input: StartRunInput,
  plot: Plot,
  weather: WeatherSnapshot,
  soil: SoilSnapshot
): Recommendation[] {
  const goal = input.goal ?? "profit";
  const currentMonth = new Date().getMonth() + 1;
  const recommendations = CROP_ORDER.map(cropCode => {
    const crop = CROPS[cropCode];
    const status = seasonStatus(crop, currentMonth);
    const economics = computeEconomics(crop, plot.areaMu, input.overrides);
    const plan = buildPlan(crop, plot, weather, soil);
    const conditionAdjustment =
      (isInSuitableWindow(crop, currentMonth) ? 4 : -26) +
      (soil.clayPercent > 32 && crop.code === "rice" ? 2 : 0) +
      (plot.drainage === "中等" && crop.code === "rapeseed" ? -2 : 0);
    const goalScores = {
      profit: clampScore(crop.goals.profit + conditionAdjustment),
      low_risk: clampScore(crop.goals.low_risk + conditionAdjustment),
      labor_saving: clampScore(crop.goals.labor_saving + conditionAdjustment),
      soil_health: clampScore(crop.goals.soil_health + conditionAdjustment)
    };
    return {
      id: makeId("rec"),
      runId,
      plotId: plot.id,
      cropCode: crop.code,
      cropName: crop.name,
      rank: 0,
      score: goalScores[goal],
      confidence: status === "适播" ? 0.89 : 0.61,
      riskLevel: crop.riskLevel,
      seasonStatus: status,
      summary: crop.fitNote,
      decisionReasons: buildDecisionReasons(crop.code, plot, weather, soil, status),
      warnings: buildRecommendationWarnings(crop.code, weather, soil, status),
      economics,
      goalScores,
      evidence: crop.evidence,
      plan
    } satisfies Recommendation;
  }).sort((left, right) => right.score - left.score);
  recommendations.forEach((recommendation, index) => {
    recommendation.rank = index + 1;
  });
  return recommendations;
}

export async function emitCapabilityPreparation(
  runId: string,
  snapshot: CapabilitySnapshot
): Promise<void> {
  const personalSkills = snapshot.skills.filter(skill => skill.source === "personal");
  const mcpTools = snapshot.mcp.reduce((sum, server) => sum + server.tools.length, 0);
  const overrideCount = snapshot.overrides?.length ?? 0;
  const knowledgeTitles = [...new Set(snapshot.knowledge.matches.map(match => match.documentTitle))];
  const knowledgeDetail = knowledgeTitles.length
    ? `；检索到 ${snapshot.knowledge.matches.length} 个本地知识片段：${knowledgeTitles.slice(0, 3).join("、")}`
    : "；本轮没有匹配的本地知识片段";
  await emitRunEvent(
    runId,
    "orchestrator",
    "tool",
    "Mastra 能力快照已冻结",
    `解析出 ${snapshot.skills.length} 个技能（${personalSkills.length} 个个人技能）、${mcpTools} 个已授权 MCP 工具${knowledgeDetail}${overrideCount ? `；应用 ${overrideCount} 条本轮临时授权` : ""}。`,
    snapshot.degraded.length ? "warning" : "success",
    {
      artifact: "CapabilitySnapshot",
      snapshotId: snapshot.id,
      engine: snapshot.engine,
      skills: snapshot.skills.map(skill => ({
        name: skill.name,
        version: skill.version,
        source: skill.source
      })),
      mcpServers: snapshot.mcp.map(server => ({
        name: server.name,
        tools: server.tools.map(tool => tool.name)
      })),
      overrides: snapshot.overrides ?? [],
      knowledge: {
        bases: snapshot.knowledge.bases.map(base => base.name),
        matches: snapshot.knowledge.matches.map(match => ({
          title: match.documentTitle,
          base: match.knowledgeBaseName,
          chunkId: match.id,
          publisher: match.publisher,
          publishedAt: match.publishedAt,
          sourceUrl: match.sourceUrl
        }))
      },
      degraded: snapshot.degraded
    },
    160
  );
}

export async function runMcpCapabilities(input: {
  runId: string;
  snapshot: CapabilitySnapshot;
  question: string;
  context: {
    farmName: string;
    plotName: string;
    crop: string;
    region: string;
  };
}): Promise<McpEvidenceResult> {
  const result = await runReadonlyMcpTools({
    runId: input.runId,
    snapshot: input.snapshot,
    question: input.question,
    context: input.context,
    onApprovalRequest: async approval => {
      await emitRunEvent(
        input.runId,
        "orchestrator",
        "tool",
        `等待确认只读 MCP 调用：${approval.toolTitle}`,
        approval.reason || `本轮计划调用 ${approval.serverName} / ${approval.toolName}。`,
        "running",
        { artifact: "McpApprovalRequest", approval },
        140
      );
    },
    onApprovalDecision: async (approval, status, errorMessage) => {
      const approved = status === "approved";
      await emitRunEvent(
        input.runId,
        "orchestrator",
        "tool",
        approved
          ? "已允许调用只读 MCP 工具"
          : status === "denied"
            ? "已取消 MCP 工具调用"
            : "MCP 工具确认已过期",
        approved
          ? `${approval.serverName} / ${approval.toolTitle} 将继续执行，结果作为外部证据接受核对。`
          : errorMessage ?? "本轮不会执行该外部工具，继续使用本地证据。",
        approved ? "success" : "warning",
        {
          artifact: "McpApprovalResult",
          approvalId: approval.id,
          server: approval.serverName,
          tool: approval.toolName,
          status,
          error: errorMessage ?? null
        },
        140
      );
    },
    onStart: async call => {
      await emitRunEvent(
        input.runId,
        "orchestrator",
        "tool",
        `正在调用只读 MCP 工具：${call.toolTitle}`,
        call.reason || `从本轮已冻结能力中选择 ${call.serverName} / ${call.toolName}。`,
        "running",
        {
          artifact: "McpToolCall",
          server: call.serverName,
          tool: call.toolName,
          arguments: safeJson(call.arguments, 1000)
        },
        120
      );
    },
    onComplete: async call => {
      await emitRunEvent(
        input.runId,
        "orchestrator",
        "tool",
        call.status === "success" ? "只读 MCP 工具调用完成" : "只读 MCP 工具调用失败",
        call.status === "success"
          ? `${call.serverName} / ${call.toolTitle} 返回外部证据，已写入调用审计并交由后续回答核对。`
          : `${call.serverName} / ${call.toolTitle} 未返回结果，本轮继续使用本地证据。`,
        call.status === "success" ? "success" : "warning",
        {
          artifact: "McpToolResult",
          server: call.serverName,
          tool: call.toolName,
          status: call.status,
          latencyMs: call.latencyMs ?? null,
          resultSummary: call.status === "success" ? safeJson(call.result, 3000) : null,
          error: call.error ?? null
        },
        180
      );
    }
  });
  if (result.warning) {
    await emitRunEvent(
      input.runId,
      "orchestrator",
      "tool",
      "只读 MCP 工具未自动执行",
      result.warning,
      "warning",
      { artifact: "McpToolFallback", warning: result.warning },
      160
    );
  }
  return {
    evidence: result.evidence,
    summary: result.summary,
    sources: result.sources
  };
}

export function buildCapabilityInstructions(snapshot: CapabilitySnapshot): string | undefined {
  const personal = snapshot.skills.filter(skill => skill.source === "personal");
  if (!personal.length) return undefined;
  return personal
    .slice(0, 8)
    .map(skill => `【${skill.name} v${skill.version}】\n${skill.instruction.slice(0, 5000)}`)
    .join("\n\n")
    .slice(0, 20_000);
}

export function buildKnowledgeEvidence(snapshot: CapabilitySnapshot): string | undefined {
  if (!snapshot.knowledge.matches.length) return undefined;
  return snapshot.knowledge.matches
    .slice(0, 6)
    .map((match, index) =>
      [
        `[本地知识 ${index + 1}] ${match.knowledgeBaseName} / ${match.documentTitle} / 片段 ${match.chunkIndex + 1}`,
        match.publisher ? `发布机构：${match.publisher}` : "",
        match.publishedAt ? `发布日期：${match.publishedAt}` : "",
        match.sourceUrl ? `原文：${match.sourceUrl}` : "",
        match.content
      ].filter(Boolean).join("\n")
    )
    .join("\n\n")
    .slice(0, 14_000);
}

export function buildKnowledgeAnswer(snapshot: CapabilitySnapshot): string {
  const matches = snapshot.knowledge.matches.slice(0, 2);
  if (!matches.length) return "";
  const excerpts = matches.map(match => {
    const content = match.content.replace(/\s+/g, " ").trim().slice(0, 260);
    return `《${match.documentTitle}》：${content}${match.content.length > 260 ? "…" : ""}`;
  });
  return `\n\n本地知识库补充（仅作待核对证据）：${excerpts.join("；")}`;
}

export function buildDecisionSummary(
  recommendations: Recommendation[],
  goal: RunGoal,
  mcpResult: McpEvidenceResult
): string {
  const top = recommendations[0];
  return `已完成 ${recommendations.length} 个候选作物评估。按“${goalLabel(goal)}”目标，${top.cropName}当前排序第一，预估亩均净收益约 ${top.economics.marginPerMu} 元；${seasonLabel(top.seasonStatus)}。` +
    (mcpResult.summary ? `\n\nMCP 只读工具补充（外部证据，待核对）：${mcpResult.summary}` : "");
}

export function verifyRecommendations(
  recommendations: Recommendation[],
  weather: WeatherSnapshot,
  soil: SoilSnapshot
): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const top = recommendations[0];
  const expectedMargin = round(top.economics.revenuePerMu - top.economics.costPerMu, 0);
  if (Math.abs(expectedMargin - top.economics.marginPerMu) > 0.5) {
    issues.push({
      code: "ECONOMICS_MISMATCH",
      severity: "critical",
      message: "亩均净收益与收入减成本不一致。",
      repair: "recalculate-economics"
    });
  }
  if (recommendations.some(recommendation => !recommendation.plan.tasks.length)) {
    issues.push({
      code: "EMPTY_PLAN",
      severity: "critical",
      message: "存在没有作业任务的候选方案。",
      repair: "rebuild-plan"
    });
  }
  if (top.seasonStatus === "非当前播期" && top.confidence > 0.7) {
    issues.push({
      code: "SEASON_CONFIDENCE",
      severity: "critical",
      message: "非当前播期候选的可信度过高。",
      repair: "lower-confidence"
    });
  }
  if (soil.isFallback && !recommendations.every(recommendation => hasSoilCalibrationTask(recommendation))) {
    issues.push({
      code: "SOIL_PRIOR_NOT_ACTIONABLE",
      severity: "warning",
      message: "土壤使用区域先验，但方案尚未把测土校准写入正式作业。",
      repair: "add-soil-calibration-task"
    });
  }
  const severeWeather = weather.warnings.some(warning => warning.level === "severe");
  if (severeWeather && !recommendations.every(recommendation => hasWeatherGuardTask(recommendation))) {
    issues.push({
      code: "SEVERE_WEATHER_GUARD",
      severity: "warning",
      message: "存在高等级天气风险，作业清单缺少明确的应急复核项。",
      repair: "add-weather-guard-task"
    });
  }
  issues.push({
    code: "REGION_RULES",
    severity: "info",
    message: "湖北区域规则、播期与轮作约束已通过。"
  });
  issues.push({
    code: "EVIDENCE_COVERAGE",
    severity: "info",
    message: "每个候选至少包含两条区域或作物证据。"
  });
  return issues;
}

export async function emitVerification(
  runId: string,
  issues: VerificationIssue[],
  roundNumber: number
): Promise<void> {
  const blockers = issues.filter(issue => issue.severity === "critical");
  const warnings = issues.filter(issue => issue.severity === "warning");
  await emitRunEvent(
    runId,
    "verifier",
    "verify",
    blockers.length ? "校验未通过" : warnings.length ? "校验通过，触发局部修复" : "独立校验通过",
    `第 ${roundNumber} 轮：${issues.length - blockers.length - warnings.length} 项信息检查，${warnings.length} 项可修复提醒，${blockers.length} 项阻断问题。`,
    blockers.length ? "error" : warnings.length ? "warning" : "success",
    { artifact: "VerificationReport", round: roundNumber, issues },
    300
  );
}

export async function repairRecommendations(input: {
  runId: string;
  recommendations: Recommendation[];
  issues: VerificationIssue[];
  weather: WeatherSnapshot;
  soil: SoilSnapshot;
  roundNumber: number;
}): Promise<void> {
  const repairable = input.issues.filter(issue => issue.severity !== "info" && issue.repair);
  await emitRunEvent(
    input.runId,
    "orchestrator",
    "repair",
    `Mastra Workflow 检测到 ${repairable.length} 项可修复问题`,
    "工作流进入局部修复分支，不重新执行天气、土壤和全部候选计算。",
    "warning",
    { artifact: "MastraRepairRequest", issues: repairable, loop: input.roundNumber },
    280
  );
  applyRepairs(input.recommendations, repairable, input.weather, input.soil);
  await emitRunEvent(
    input.runId,
    "agronomy",
    "repair",
    "农艺 Agent 已补入复核任务",
    "修复仅作用于缺失的作业项，并保留原方案其余内容。",
    "success",
    { artifact: "PlantingPlanDraft[]", repair: "incremental", tasksAdded: repairable.length },
    260
  );
}

export function persistRecommendations(recommendations: Recommendation[]): void {
  for (const recommendation of recommendations) {
    insertRecommendation(recommendation);
  }
}

export function routeQuestion(question: string, weather: WeatherSnapshot, soil: SoilSnapshot) {
  const selected = selectQuestionSkill(question);
  if (selected === "pest-vision") {
    return {
      agent: selected,
      retrieval: "text-only/await-image",
      evidence: "本轮是文字咨询，未收到图像证据，不执行视觉识别。",
      sources: ["用户文字描述"]
    };
  }
  if (selected === "soil") {
    return {
      agent: selected,
      retrieval: "soil.get_properties",
      evidence: `土壤来源 ${soil.source}，质地 ${soil.texture}，pH ${soil.ph}。`,
      sources: ["本轮土壤证据"]
    };
  }
  if (selected === "agronomy") {
    return {
      agent: selected,
      retrieval: "agronomy.rule.lookup+soil.get_properties",
      evidence: `土壤来源 ${soil.source}，${soil.texture}，pH ${soil.ph}；施肥建议需结合测土配方。`,
      sources: ["土壤证据", "湖北省农业主推技术指南"]
    };
  }
  if (selected === "weather") {
    return {
      agent: selected,
      retrieval: "weather.get_forecast",
      evidence: `天气来源 ${weather.source}，未来 7 日最低 ${Math.min(...weather.daily.map(day => day.tempMin))}°C。`,
      sources: ["Open-Meteo / 缓存天气", "地块坐标"]
    };
  }
  if (selected === "economics") {
    return {
      agent: selected,
      retrieval: "market.get_reference+economics.calculate",
      evidence: "经济 Agent 使用公开数据区间；用户覆盖值优先，并明确标注非实时报价。",
      sources: ["公开价格估算", "用户覆盖值（如有）"]
    };
  }
  return {
    agent: selected,
    retrieval: "plot.read+weather.get_forecast+soil.get_properties",
    evidence: `已读取当前地块作物记录、气象来源 ${weather.source} 与土壤来源 ${soil.source}。`,
    sources: ["地块档案", "天气证据", "土壤证据", "区域农艺规则"]
  };
}

export function readActivePlan(plotId: string): ActivePlanContext {
  const planRow = db
    .prepare("SELECT * FROM planting_plan WHERE plot_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(plotId) as Record<string, unknown> | undefined;
  const plan = planRow ? mapPlan(planRow) : null;
  const operations = plan
    ? (db.prepare("SELECT * FROM operation_record WHERE plan_id = ? ORDER BY created_at DESC").all(plan.id) as
        Array<Record<string, unknown>>).map(mapOperation)
    : [];
  return { plan, operations };
}

export function buildQuestionAnswer(
  question: string,
  agent: string,
  plot: Plot,
  weather: WeatherSnapshot,
  soil: SoilSnapshot,
  active: ActivePlanContext
): string {
  if (agent === "pest-vision") {
    return `${plot.name}本轮只有文字描述，尚未进行图片识别。请上传叶片正反面、整株和疑似虫体近照，并说明何时发现、哪些部位受害。症状也可能来自病害、缺素或机械损伤，补齐证据前不能确定对象或给出用药处方。`;
  }
  const soilSource =
    soil.source === "manual"
      ? "用户录入的测土数据"
      : soil.isFallback
        ? "区域土壤先验"
        : "公开土壤属性";
  if (agent === "soil") {
    return `${plot.name}当前土壤来源为${soilSource}，质地${soil.texture}，pH ${soil.ph}。请先核对测土报告的采样时间、深度和单位；区域先验或公开属性不能替代现场测土，也不能直接推导精确施肥量。`;
  }
  if (agent === "weather") {
    const nextThreeRain = weather.daily.slice(0, 3).reduce((sum, day) => sum + day.precipitation, 0);
    return `${plot.name}未来 7 日最低气温约 ${Math.min(...weather.daily.map(day => day.tempMin))}°C，未来 3 日累计降水约 ${round(nextThreeRain, 1)} mm。当前最值得先做的是检查沟渠和播后墒情；若当地发布霜冻或大风预警，应暂停施药并调整播种作业。天气源为${weather.source === "open-meteo" ? " Open-Meteo 实时预报" : "缓存演示数据，需用当地短临预警复核"}。`;
  }
  if (agent === "economics") {
    if (/施肥|肥料|灌溉|浇水|打药|农药|人工|机械/.test(question)) {
      return `${plot.name}登记面积为 ${plot.areaMu} 亩；本轮缺少单次作业的材料数量、单价及人工机械费用，不能用全季成本代替。请先说明这次具体作业和投入用量、单价，已有费用也可以直接提供。`;
    }
    const wheat = computeEconomics(CROPS.wheat, plot.areaMu);
    return `以冬小麦公开中位值为例，${plot.areaMu} 亩预计收入约 ${wheat.revenueTotal} 元、成本约 ${wheat.costTotal} 元、净收益约 ${wheat.marginTotal} 元。这只是公开数据估算，不含地租和融资成本。你可以用当地实际收购价、预期亩产和成本覆盖默认值后再比较。`;
  }
  if (agent === "agronomy") {
    if (/下一步|根据当前种植方案|未来.*(优先|做什么)/.test(question)) {
      if (!active.plan) return `${plot.name}还没有正在执行的种植方案，请先比较并采用方案，再安排下一步作业。`;
      const done = new Set(
        active.operations
          .filter(record => record.status === "done" || record.status === "skipped")
          .map(record => record.title)
      );
      const pending = active.plan.plan.tasks.filter(task => !done.has(task.title));
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      const horizon = new Date(Date.now() + 6 * 86400000).toLocaleDateString("en-CA", {
        timeZone: "Asia/Shanghai"
      });
      const scheduled = pending.filter(task => {
        const dates = task.dateWindow.match(/\d{4}-\d{2}-\d{2}/g);
        return !dates || dates.length < 2 || (dates[0] <= horizon && dates[1] >= today);
      });
      const selected = (scheduled.length ? scheduled : pending).slice(0, 3);
      return `${plot.name}当前采用的是${active.plan.cropName}方案，开始日期为 ${active.plan.startDate}。${active.operations.length ? "已读取本方案的农事记录，完成或跳过的同名任务不再列入待办。" : "本方案尚无农事记录，不能据此认定作业未执行。"}\n\n` +
        (selected.length
          ? `${scheduled.length ? "优先核对以下作业的执行条件" : "未来一周没有匹配的日程，请先复核以下待办的日期及进度"}：${selected.map(task => `${task.title}（${task.dateWindow}）：${task.method}`).join("；")}。请先确认实际播种日期、生育阶段及已经完成的事项，再执行水肥等投入。`
          : "方案中的任务均已有完成或跳过记录，请确认田间状态，暂不重复安排投入。");
    }
    return `${plot.name}档案中的作物状态为“${plot.currentCrop}”，土壤依据为${soilSource}。本轮尚未提供完整的生育期和近期作业记录，不能直接判断是否需要再次施肥、灌水或施药。请先说明作物当前阶段，以及最近一次同类作业的时间和用量；同时现场查看墒情、沟渠和叶片状态，再结合有效测土与天气资料安排。`;
  }
  return `${plot.name}当前档案中的作物状态为“${plot.currentCrop}”。如果准备下一季选种，请先说明更重视收益、低风险、省工还是轮作养地，再结合当前日期、所在地与当地价格比较候选；如果已经种植，请说明作物阶段，以便讨论本季管理。`;
}

export function verifyAgentText(text: string, evidence: string): boolean {
  return verifyGroundedText(text, evidence);
}

export function goalLabel(goal: RunGoal): string {
  return {
    profit: "稳健收益",
    low_risk: "低风险",
    labor_saving: "省工易管",
    soil_health: "养地轮作"
  }[goal];
}

export function seasonLabel(status: Recommendation["seasonStatus"]): string {
  return {
    适播: "当前处于适播窗口",
    临近播期: "播期临近",
    非当前播期: "当前不在主播期"
  }[status];
}

export function plotDescriptor(context: RunContext): string {
  const position = plotPosition(context.plot, context.farm);
  return `${context.plot.location ? context.plot.name : context.farm.name}的 WGS84 坐标 ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

function currentEventSeq(runId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_event WHERE run_id = ?")
    .get(runId) as { seq: number };
  return Number(row?.seq ?? 0);
}

function isRunDone(runId: string): boolean {
  const row = db.prepare("SELECT status FROM task_run WHERE id = ?").get(runId) as { status: string } | undefined;
  return Boolean(row && ["completed", "failed"].includes(row.status));
}

function buildDecisionReasons(
  cropCode: CropCode,
  plot: Plot,
  weather: WeatherSnapshot,
  soil: SoilSnapshot,
  status: Recommendation["seasonStatus"]
): string[] {
  const crop = CROPS[cropCode];
  const minTemp = Math.min(...weather.daily.map(day => day.tempMin));
  return [
    status === "适播" ? "当前处于高置信适播窗口" : status === "临近播期" ? "已进入下一播期准备窗口" : "当前不在主播期",
    `地块轮作记录为${plot.rotation}，${crop.rotationValue}`,
    `土壤${soil.texture}，排水条件${plot.drainage}；${soil.isFallback ? "需测土校准" : "已使用公开土壤属性"}`,
    `未来 7 日最低 ${round(minTemp, 1)}°C；${weather.warnings[0]?.title ?? "无阈值预警"}`
  ];
}

function buildRecommendationWarnings(
  cropCode: CropCode,
  weather: WeatherSnapshot,
  soil: SoilSnapshot,
  status: Recommendation["seasonStatus"]
): string[] {
  const warnings = weather.warnings
    .filter(warning => warning.level !== "info")
    .map(warning => warning.title);
  if (soil.isFallback) warnings.push("土壤证据为区域先验");
  if (status !== "适播") warnings.push("非当前主播期，仅作比较");
  if (!CROPS[cropCode].deepGuidance) warnings.push("首版仅提供适宜性与经济测算");
  return [...new Set(warnings)];
}

function applyRepairs(
  recommendations: Recommendation[],
  issues: VerificationIssue[],
  weather: WeatherSnapshot,
  soil: SoilSnapshot
): void {
  for (const issue of issues) {
    if (issue.repair === "add-soil-calibration-task") {
      for (const recommendation of recommendations) {
        if (!hasSoilCalibrationTask(recommendation)) {
          recommendation.plan.tasks.unshift({
            id: `${recommendation.cropCode}-soil-calibration`,
            phase: "播前复核",
            title: "采集土样并校准施肥量",
            dateWindow: "播前 1 至 3 日",
            method: soil.isFallback
              ? "按梅花形采集耕层混合样；在测土结果出来前，仅按当地配方下限准备基肥"
              : "复核最近一次测土报告，确认 pH、有机质与磷钾用量",
            quantity: "1 份代表性混合样，施肥量以检测或当地配方为准",
            rationale: soil.note,
            priority: "critical"
          });
        }
      }
    }
    if (issue.repair === "add-weather-guard-task") {
      const severe = weather.warnings.find(warning => warning.level === "severe");
      for (const recommendation of recommendations) {
        if (!hasWeatherGuardTask(recommendation)) {
          recommendation.plan.tasks.unshift({
            id: `${recommendation.cropCode}-weather-guard`,
            phase: "天气应对",
            title: "高等级天气前现场复核",
            dateWindow: "预警发布后 24 小时内",
            method: severe?.detail ?? "复核当地短临天气预警并调整作业窗口",
            quantity: "按实际预警等级执行",
            rationale: "高风险天气事件可能改变播期、施药窗口或排水安排",
            priority: "critical"
          });
        }
      }
    }
    if (issue.repair === "lower-confidence") {
      for (const recommendation of recommendations) {
        if (recommendation.seasonStatus === "非当前播期") {
          recommendation.confidence = Math.min(recommendation.confidence, 0.58);
        }
      }
    }
    if (issue.repair === "recalculate-economics") {
      for (const recommendation of recommendations) {
        recommendation.economics.marginPerMu = round(
          recommendation.economics.revenuePerMu - recommendation.economics.costPerMu,
          0
        );
      }
    }
  }
}

function hasSoilCalibrationTask(recommendation: Recommendation): boolean {
  return recommendation.plan.tasks.some(task => task.title.includes("土样") || task.title.includes("测土"));
}

function hasWeatherGuardTask(recommendation: Recommendation): boolean {
  return recommendation.plan.tasks.some(task => task.title.includes("天气") || task.title.includes("防冻"));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeJson(value: unknown, limit: number): string {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}
