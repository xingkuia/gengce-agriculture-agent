import { SKILL_GUIDANCE, type SkillId } from "./skill-guidance.js";
import type { AgentSkillDefinition } from "./types.js";

const DEFINITIONS: AgentSkillDefinition[] = [
  {
    id: "orchestrator",
    name: "任务编排 Agent",
    version: "2.0.0",
    description: "识别用户目标，按固定流程和问答规则路由专家，标记缺失输入并限制修复次数。",
    tools: ["run.plan", "agent.dispatch", "a2a.route"],
    inputContract: "FarmIntent",
    outputContract: "MastraDecisionPlan",
    modelRole: "planner"
  },
  {
    id: "weather",
    name: "气象风险 Agent",
    version: "2.0.0",
    description: "读取预报与模型化环境指标，区分实时预报和演示缓存，解释天气对作业的影响。",
    tools: ["weather.get_forecast"],
    inputContract: "GeoPoint",
    outputContract: "WeatherEvidence",
    modelRole: "reasoner"
  },
  {
    id: "soil",
    name: "土壤证据 Agent",
    version: "2.0.0",
    description: "区分用户测土、公开土壤属性与区域先验，保留单位、来源和适用限制。",
    tools: ["soil.get_properties", "soil.read_manual"],
    inputContract: "GeoPoint+Plot",
    outputContract: "SoilEvidence",
    modelRole: "reasoner"
  },
  {
    id: "crop-selection",
    name: "选种决策 Agent",
    version: "2.0.0",
    description: "按收益、风险、省工和养地目标分别排序候选作物，不以单一总分替代选择。",
    tools: ["crop.suitability.evaluate", "crop.goal.rank"],
    inputContract: "WeatherEvidence+SoilEvidence+FarmGoal",
    outputContract: "CandidateSet",
    modelRole: "generator"
  },
  {
    id: "economics",
    name: "经济测算 Agent",
    version: "2.0.0",
    description: "把公开价格区间与用户本地值组合为可追溯的亩均和总收益估算。",
    tools: ["market.get_reference", "economics.calculate"],
    inputContract: "CandidateSet+PriceOverride",
    outputContract: "EconomicEstimate",
    modelRole: "none"
  },
  {
    id: "agronomy",
    name: "农艺执行 Agent",
    version: "2.0.0",
    description: "依据湖北区域规则生成播期、水肥、病虫监测和天气应对任务。",
    tools: ["agronomy.rule.lookup", "plan.compile"],
    inputContract: "Candidate+Weather+Soil",
    outputContract: "PlantingPlanDraft",
    modelRole: "generator"
  },
  {
    id: "verifier",
    name: "独立校验 Agent",
    version: "2.0.0",
    description: "执行数值复算、播期和证据规则检查；保留检查范围、阻断问题与回退原因。",
    tools: ["numeric.recheck", "season.recheck", "evidence.recheck", "policy.recheck"],
    inputContract: "CandidateSet+PlanDraft",
    outputContract: "VerificationReport",
    modelRole: "verifier"
  },
  {
    id: "pest-vision",
    name: "病虫害初筛 Agent",
    version: "2.0.0",
    description: "视觉初筛：观察图像证据、区分相似对象，证据不足时要求补拍；结果按地块留档。",
    tools: ["vision.classify"],
    inputContract: "FieldImage+PlotContext",
    outputContract: "PestAssessment",
    modelRole: "verifier"
  }
];

export const SKILLS = DEFINITIONS.map(skill => ({...skill, guidance: SKILL_GUIDANCE[skill.id as SkillId]}));

export const SKILL_BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

export const TOOL_MANIFEST = [
  {
    name: "weather.get_forecast",
    title: "未来天气与蒸散",
    transport: "in-process/MCP-compatible",
    input: "latitude, longitude",
    output: "WeatherEvidence",
    timeoutMs: Number(process.env.OPEN_METEO_TIMEOUT_MS ?? 6000),
    fallback: "cached-demo"
  },
  {
    name: "soil.get_properties",
    title: "表层土壤属性",
    transport: "in-process/MCP-compatible",
    input: "latitude, longitude",
    output: "SoilEvidence",
    timeoutMs: Number(process.env.SOILGRIDS_TIMEOUT_MS ?? 4500),
    fallback: "regional-prior"
  },
  {
    name: "market.get_reference",
    title: "公开价格区间",
    transport: "in-process/MCP-compatible",
    input: "cropCode",
    output: "MarketReference",
    timeoutMs: 0,
    fallback: "curated-public-estimate"
  },
  {
    name: "plan.compile",
    title: "农艺任务编译",
    transport: "in-process",
    input: "Crop+Plot+Weather+Soil",
    output: "PlantingPlanDraft",
    timeoutMs: 0,
    fallback: "none"
  }
];
