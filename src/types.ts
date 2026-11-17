import type { PlotLocation } from "../server/geo.js";
export type GoalKey = "profit" | "low_risk" | "labor_saving" | "soil_health";
export type CropCode = "wheat" | "rapeseed" | "rice" | "corn" | "soybean";

export interface Account {
  id: string;
  name: string;
  ownerName: string;
  plan: string;
  isDemo: boolean;
}

export interface Farm {
  isPinned?: boolean;
  id: string;
  accountId: string;
  name: string;
  province: string;
  city: string;
  district: string;
  latitude: number;
  longitude: number;
  altitude?: number;
}
export interface Workspace {
  account: Account;
  farms: Array<Farm & { plots: Plot[] }>;
  deletedFarms: Array<Farm & { plots: Plot[] }>;
  deletedPlots: Plot[];
}

export interface Plot {
  id: string;
  farmId: string;
  name: string;
  areaMu: number;
  location?: PlotLocation | null;
  soilTexture: string;
  irrigation: string;
  drainage: string;
  currentCrop: string;
  rotation: string;
  note: string;
}

export interface WeatherDay {
  date: string;
  weather: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
}

export interface WeatherWarning {
  id: string;
  level: "info" | "attention" | "severe";
  title: string;
  detail: string;
}

export interface WeatherSnapshot {
  source: "open-meteo" | "cached-demo";
  fetchedAt: string;
  isFallback: boolean;
  condition: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  et0: number;
  soilTemperature: number;
  soilMoisture: number;
  daily: WeatherDay[];
  warnings: WeatherWarning[];
}

export interface SoilSnapshot {
  source: "soilgrids" | "soilgrids-local" | "manual" | "regional-prior";
  fetchedAt: string;
  isFallback: boolean;
  texture: string;
  clayPercent: number;
  sandPercent: number;
  ph: number;
  organicCarbon: number;
  drainage: string;
  note: string;
}

export interface PlotContext {
  weather: WeatherSnapshot;
  soil: SoilSnapshot;
  updatedAt: string;
}

export interface EconomicsEstimate {
  pricePerKg: number;
  priceRange: [number, number];
  yieldPerMu: number;
  yieldRange: [number, number];
  costPerMu: number;
  revenuePerMu: number;
  marginPerMu: number;
  revenueTotal: number;
  costTotal: number;
  marginTotal: number;
  source: "public-estimate" | "user-overridden";
  assumptions: string[];
}

export interface PlanTask {
  id: string;
  phase: string;
  title: string;
  dateWindow: string;
  method: string;
  quantity: string;
  rationale: string;
  priority: "normal" | "important" | "critical";
}

export interface PlanDraft {
  cropCode: CropCode;
  cropName: string;
  startDate: string;
  season: string;
  summary: string;
  decisionReasons: string[];
  tasks: PlanTask[];
  monitoring: string[];
  inputPlan: string[];
  waterPlan: string[];
  evidence: string[];
}

export interface Recommendation {
  id: string;
  runId: string;
  plotId: string;
  cropCode: CropCode;
  cropName: string;
  rank: number;
  score: number;
  confidence: number;
  riskLevel: string;
  seasonStatus: "适播" | "临近播期" | "非当前播期";
  summary: string;
  decisionReasons: string[];
  warnings: string[];
  economics: EconomicsEstimate;
  goalScores: Record<GoalKey, number>;
  evidence: string[];
  plan: PlanDraft;
}

export interface PlantingPlan {
  id: string;
  accountId: string;
  plotId: string;
  recommendationId: string;
  cropCode: CropCode;
  cropName: string;
  status: "draft" | "active" | "completed" | "archived";
  season: string;
  startDate: string;
  plan: PlanDraft;
  createdAt: string;
}

export interface OperationRecord {
  id: string;
  plotId: string;
  planId: string;
  type: string;
  title: string;
  plannedDate: string;
  actualDate: string | null;
  status: "planned" | "done" | "skipped";
  notes: string;
  cost: number;
  createdAt: string;
}

export interface OutcomeRecord {
  id: string;
  plotId: string;
  planId: string;
  cropName: string;
  yieldKg: number;
  yieldPerMu: number;
  quality: string;
  revenue: number;
  cost: number;
  margin: number;
  notes: string;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  planId: string;
  outcomeId: string | null;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface AgentEvent {
  id: number;
  runId: string;
  seq: number;
  agent: string;
  agentLabel: string;
  kind: "plan" | "tool" | "a2a" | "verify" | "repair" | "answer" | "system";
  title: string;
  detail: string;
  status: "queued" | "running" | "success" | "warning" | "error";
  payload?: unknown;
  createdAt: string;
}

export interface AgentSkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: string[];
  inputContract: string;
  outputContract: string;
  modelRole: "generator" | "reasoner" | "verifier" | "planner" | "none";
}

export interface EvaluationSummary {
  id: string;
  suiteName: string;
  agentVersion: string;
  status: "passed" | "warning" | "failed";
  passRate: number;
  cases: number;
  metrics: Array<{ name: string; value: string; target: string; passed: boolean }>;
  ranAt: string;
}

export interface ModelStatus {
  provider: "mock" | "deepseek" | "qwen";
  model: string;
  configured: boolean;
  baseUrl: string;
  note: string;
}

export interface CapabilityBinding {
  id: string;
  capabilityType: "skill" | "mcp" | "knowledge";
  capabilityId: string;
  scopeType: "account" | "farm" | "plot";
  scopeId: string;
  enabled: boolean;
  priority: number;
}

export interface SkillVersionSummary {
  id: string;
  version: string;
  status: "draft" | "published" | "archived";
  instruction: string;
  guidance?: unknown;
  createdAt: string;
  publishedAt: string | null;
}

export interface CapabilitySkill {
  id: string;
  accountId: string | null;
  slug: string;
  name: string;
  kind: "system" | "personal";
  status: "active" | "archived";
  description: string;
  appliesTo: string;
  tools: string[];
  currentVersionId: string | null;
  currentVersion: SkillVersionSummary | null;
  draftVersion: SkillVersionSummary | null;
  bindings: CapabilityBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface MCPToolDefinition {
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
  enabled: boolean;
  executionMode: "auto" | "confirm" | "manual";
  createdAt: string;
  updatedAt: string;
}

export type McpApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface McpApprovalRequestView {
  id: string;
  runId: string;
  accountId: string;
  serverId: string;
  serverName: string;
  toolId: string;
  toolName: string;
  toolTitle: string;
  arguments: Record<string, unknown>;
  reason: string;
  status: McpApprovalStatus;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

export interface MCPServerSummary {
  id: string;
  accountId: string;
  name: string;
  transport: "http" | "stdio";
  endpoint: string | null;
  command: string | null;
  args: string[];
  envKeys: string[];
  headerNames: string[];
  status: "unconfigured" | "connected" | "error";
  statusMessage: string;
  lastCheckedAt: string | null;
  tools: MCPToolDefinition[];
  bindings: CapabilityBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface MCPCallLog {
  id: string;
  serverId: string;
  toolName: string;
  runId: string | null;
  status: "success" | "error";
  latencyMs: number;
  inputSummary: string;
  outputSummary: string;
  createdAt: string;
}

export interface KnowledgeDocumentSummary {
  id: string;
  knowledgeBaseId: string;
  title: string;
  sourceName: string;
  publisher: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  mimeType: string;
  status: "ready" | "error";
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseSummary {
  id: string;
  accountId: string;
  name: string;
  description: string;
  scopeType: "account" | "farm" | "plot";
  scopeId: string;
  documents: KnowledgeDocumentSummary[];
  bindings: CapabilityBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilitiesPayload {
  runtime: {
    engine: "Mastra Workflow";
    version: string;
    workflowId: string;
    note: string;
  };
  skills: CapabilitySkill[];
  mcpServers: MCPServerSummary[];
  knowledgeBases: KnowledgeBaseSummary[];
  recentCalls: MCPCallLog[];
}

export interface BootstrapPayload {
  account: Account;
  farms: Array<Farm & { plots: Plot[] }>;
  activePlotId: string;
  plotContext: PlotContext;
  recommendations: Recommendation[];
  activePlan: PlantingPlan | null;
  activePlanRecommendation?: Recommendation | null;
  operations: OperationRecord[];
  outcomes: OutcomeRecord[];
  feedback: FeedbackRecord[];
  latestRun: {
    id: string;
    status: string;
    summary: string;
    events: AgentEvent[];
  } | null;
  skills: AgentSkillDefinition[];
  evaluations: EvaluationSummary[];
  model: ModelStatus;
  meta: {
    regionCoverage: string;
    dataNotice: string;
    demoMode: boolean;
    currentDate: string;
  };
}

export interface RunOverrides {
  pricePerKg?: number;
  yieldPerMu?: number;
  costPerMu?: number;
}

export interface ChatTurn {
  restored?: boolean;
  draft?: string;
  recommendations?: Recommendation[];
  planSnapshot?: PlantingPlan;
  id: string;
  role: "user" | "assistant";
  kind: "message" | "run" | "plan";
  content: string;
  createdAt: string;
  runId?: string;
  mode?: "recommend" | "question";
  goal?: GoalKey;
  events?: AgentEvent[];
  status?: "running" | "done" | "error";
  planId?: string;
  actionLabel?: string;
  actionView?: "plan" | "records" | "results" | "farms" | "evaluation" | "capabilities";
  actionPrompt?: string;
}

export interface ChatSummary { id: string; plotId: string; title: string; updatedAt: string; status?: string; preview?: string }
export interface SavedChat extends ChatSummary { turns: ChatTurn[] }
