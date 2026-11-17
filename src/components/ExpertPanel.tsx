import { StreamingText } from "./StreamingText";
import {
  BadgeCheck,
  Bot,
  MessageSquare,
  RefreshCw,
  Route,
  Share2,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "../lib/format";
import type { AgentEvent } from "../types";

interface ExpertPanelProps {
  historical?: boolean;
  events: AgentEvent[];
  running: boolean;
  runId: string | null;
  plotName: string;
  mobileOpen: boolean;
  onClose: () => void;
  onFocusComposer: () => void;
}

const kindIcons = {
  plan: Route,
  tool: Wrench,
  a2a: Share2,
  verify: BadgeCheck,
  repair: RefreshCw,
  answer: MessageSquare,
  system: Terminal
};

const artifactLabels: Record<string, string> = {
  GroundedAnswer: "专家回答档案",
  RecommendationSet: "种植决策档案",
  CandidateSet: "候选作物档案",
  EconomicEstimate: "经济测算档案",
  WeatherEvidence: "气象证据",
  SoilEvidence: "土壤证据",
  EvidenceBundle: "证据汇总",
  VerificationReport: "独立校验记录",
  AnswerVerification: "回答校验记录",
  CapabilitySnapshot: "能力快照",
  PlantingPlanDraft: "农艺计划草案"
};

const fieldLabels: Record<string, string> = {
  answer: "专家回答",
  summary: "结论摘要",
  topCrop: "首要候选",
  repairRounds: "修复轮次",
  verification: "校验结果",
  sources: "证据来源",
  modelUsed: "模型参与",
  modelFallback: "模型回退原因",
  fallbackReason: "回退原因",
  numericRepairs: "数字修复",
  capabilitySnapshotId: "能力快照",
  knowledgeMatches: "匹配知识",
  knowledgeSources: "知识来源",
  mcpSources: "MCP 来源",
  planId: "当前方案",
  operationCount: "农事记录",
  workflowId: "工作流",
  route: "路由 Agent",
  retrieval: "检索方式",
  evidenceRefresh: "证据刷新",
  plot: "地块",
  crop: "作物",
  weatherSource: "气象来源",
  soilSource: "土壤来源",
  activePlanId: "当前方案",
  source: "数据来源",
  warnings: "风险提示",
  snapshot: "观测快照",
  candidates: "候选作物",
  goal: "决策目标",
  goalScores: "目标评分",
  score: "综合评分",
  seasonStatus: "农时状态",
  records: "测算明细",
  taskCount: "任务数量",
  round: "校验轮次",
  issues: "检查项",
  checks: "检查方法",
  skillId: "技能",
  message: "说明",
  severity: "级别",
  code: "编码",
  repair: "修复动作",
  nodes: "执行节点",
  repairBudget: "修复预算",
  engine: "运行时",
  skills: "启用技能",
  name: "名称",
  version: "版本",
  publisher: "发布机构",
  publishedAt: "发布时间",
  sourceUrl: "来源链接",
  chunkId: "知识片段",
  bases: "知识库",
  matches: "匹配片段",
  degraded: "降级能力",
  pricePerKg: "收购单价",
  priceRange: "价格区间",
  yieldPerMu: "亩产",
  yieldRange: "亩产区间",
  costPerMu: "亩成本",
  revenuePerMu: "亩收入",
  marginPerMu: "亩收益",
  revenueTotal: "总收入",
  costTotal: "总成本",
  marginTotal: "总收益",
  assumptions: "估算假设"
};

const primaryArtifactTypes = new Set(["GroundedAnswer", "RecommendationSet"]);
const readableArtifactTypes = new Set([
  "GroundedAnswer",
  "RecommendationSet",
  "CandidateSet",
  "EconomicEstimate",
  "WeatherEvidence",
  "SoilEvidence",
  "VerificationReport",
  "AnswerVerification"
]);
const artifactPriority = new Map([
  ["GroundedAnswer", 0],
  ["RecommendationSet", 1],
  ["CandidateSet", 2],
  ["EconomicEstimate", 3],
  ["WeatherEvidence", 4],
  ["SoilEvidence", 4],
  ["VerificationReport", 5],
  ["AnswerVerification", 5]
]);
const longTextFields = new Set(["answer", "summary", "detail", "message", "error"]);
const statusLabels: Record<AgentEvent["status"], string> = {
  queued: "等待",
  running: "进行中",
  success: "完成",
  warning: "提醒",
  error: "异常"
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function eventArtifactType(event: AgentEvent): string | null {
  if (event.kind === "answer" && event.payload !== undefined) return "GroundedAnswer";
  const payload = asRecord(event.payload);
  return typeof payload?.artifact === "string" ? payload.artifact : null;
}

function artifactLabel(type: string): string {
  return artifactLabels[type] ?? type;
}

function fieldLabel(key: string): string {
  return fieldLabels[key] ?? key;
}

function payloadText(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function eventLog(event: AgentEvent): string {
  const header = `[${event.seq.toString().padStart(2, "0")}] ${event.createdAt} · ${event.agentLabel} / ${event.status}`;
  const payload = event.payload === undefined ? "" : `\npayload\n${payloadText(event.payload)}`;
  return `${header}\n${event.title}\n${event.detail}${payload}`;
}

function ArtifactValue({
  value,
  field,
  instant,
  depth = 0
}: {
  value: unknown;
  field: string;
  instant: boolean;
  depth?: number;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="artifact-empty">未提供</span>;
  }
  if (typeof value === "string") {
    return longTextFields.has(field)
      ? <StreamingText text={value} className="artifact-prose" instant={instant} />
      : <span className="artifact-text">{value}</span>;
  }
  if (typeof value === "number") return <span className="artifact-scalar">{value.toLocaleString("zh-CN")}</span>;
  if (typeof value === "boolean") return <span className="artifact-scalar">{value ? "是" : "否"}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="artifact-empty">无记录</span>;
    const compact = value.every(item => item === null || ["string", "number", "boolean"].includes(typeof item));
    return (
      <ul className={`artifact-list ${compact ? "is-compact" : ""}`}>
        {value.map((item, index) => (
          <li key={index}>
            <ArtifactValue value={item} field={field} instant={instant} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  const record = asRecord(value);
  if (!record) return <span className="artifact-text">{String(value)}</span>;
  if (depth >= 4) return <span className="artifact-text">{payloadText(record)}</span>;
  const entries = Object.entries(record).filter(([key]) => key !== "artifact");
  if (!entries.length) return <span className="artifact-empty">无字段</span>;
  return (
    <dl className="artifact-fields">
      {entries.map(([key, entry]) => (
        <div className="artifact-field" key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd><ArtifactValue value={entry} field={key} instant={instant} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

function ArtifactCard({ event, instant }: { event: AgentEvent; instant: boolean }) {
  const payload = asRecord(event.payload);
  const type = eventArtifactType(event);
  if (!payload || !type) return null;
  const entries = Object.entries(payload).filter(([key]) => key !== "artifact");
  return (
    <details
      className="review-artifact-card"
      data-artifact={type}
      open={primaryArtifactTypes.has(type)}
    >
      <summary>
        <span className="artifact-summary-main">
          <span className="artifact-kind">{artifactLabel(type)}</span>
          <strong>{event.title}</strong>
        </span>
        <span className={`artifact-status status-${event.status}`}>{statusLabels[event.status]}</span>
      </summary>
      <div className="artifact-body">
        {entries.length
          ? <ArtifactValue value={Object.fromEntries(entries)} field={type} instant={instant} />
          : <p className="artifact-empty">该档案暂无详细字段。</p>}
        <div className="artifact-event-meta">
          <span>{event.agentLabel}</span>
          <span>事件 {event.seq.toString().padStart(2, "0")}</span>
          <time>{formatDateTime(event.createdAt)}</time>
        </div>
      </div>
    </details>
  );
}

export function ExpertPanel({
  historical = false,
  events,
  running,
  runId,
  plotName,
  mobileOpen,
  onClose,
  onFocusComposer
}: ExpertPanelProps) {
  const [tab, setTab] = useState("trace");
  const pinned = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const artifactEvents = events
    .filter(event => {
      const type = eventArtifactType(event);
      return type !== null && readableArtifactTypes.has(type);
    })
    .sort((left, right) => {
      const leftType = eventArtifactType(left) ?? "";
      const rightType = eventArtifactType(right) ?? "";
      return (artifactPriority.get(leftType) ?? 99) - (artifactPriority.get(rightType) ?? 99);
    });
  const logText = events.length
    ? events.map(eventLog).join("\n\n")
    : "尚无运行日志。发起任务后，执行记录会显示在这里。";

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (tab === "trace") {
      element.scrollTop = element.scrollHeight;
      pinned.current = true;
      return;
    }
    element.scrollTop = 0;
    pinned.current = false;
  }, [tab]);

  useEffect(() => {
    if (!scrollRef.current || !pinned.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length, running]);

  return (
    <aside className={`expert-panel assistant-expert-panel ${mobileOpen ? "is-open" : ""}`} aria-label="Agent 执行轨迹">
      <header className="expert-header">
        <div>
          <div className="expert-title-line">
            <span className={`live-indicator ${running ? "is-running" : ""}`} />
            <h2>运行与产出</h2>
          </div>
          <p>{plotName} · {events.length} 个执行事件</p>
        </div>
        <button className="dark-icon-button expert-close" type="button" onClick={onClose} aria-label="关闭专家轨迹">
          <X size={18} />
        </button>
      </header>

      <div className="expert-meta-row">
        <span className={`run-state ${running ? "is-running" : events.length ? "is-done" : ""}`}>
          {running ? "RUNNING" : events.length ? "REPLAYABLE" : "IDLE"}
        </span>
        <span className="run-id">{runId ? runId.slice(-12).toUpperCase() : "NO ACTIVE RUN"}</span>
        <span className="trace-version">MASTRA 1.0</span>
      </div>

      <div className="review-tabs" role="tablist" aria-label="运行面板">{[["trace","执行轨迹"],["artifacts","产物"],["terminal","日志"]].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
      <div className="expert-trace" ref={scrollRef} onScroll={event => { const el = event.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        {tab==="terminal" && <pre className="review-terminal" tabIndex={0} aria-label="只读运行日志">{logText}</pre>}
        {tab==="artifacts" && <div className="review-artifacts">{artifactEvents.map(event=><ArtifactCard key={`${event.seq}-${event.agent}`} event={event} instant={historical || !running}/>)}{!artifactEvents.length&&<p>尚未生成可阅读档案。运行一次地块分析后查看证据、候选、经济测算与校验结果。</p>}</div>}
        <div hidden={tab!=="trace"}>
        {!events.length && (
          <div className="trace-empty">
            <div className="trace-empty-icon">
              <Bot size={24} />
            </div>
            <h3>让过程清晰可见</h3>
            <p>生成种植建议或提出一个问题后，气象、土壤、选种、经济与校验 Agent 的协作过程会在这里出现。</p>
            <div className="trace-empty-protocol">
              <span>证据</span>
              <span>工具</span>
              <span>校验</span>
            </div>
          </div>
        )}

        {events.map((event, index) => {
          const Icon = kindIcons[event.kind] ?? Bot;
          const traceDetail = event.kind === "answer"
            ? "专家回答已归档，请在“产物”中查看完整档案。"
            : event.detail;
          return (
            <article className={`trace-event status-${event.status}`} key={`${event.seq}-${event.agent}`}>
              <div className="trace-rail">
                <span className="trace-icon">
                  <Icon size={14} strokeWidth={1.9} />
                </span>
                {index < events.length - 1 && <span className="trace-line" />}
              </div>
              <div className="trace-content">
                <div className="trace-event-topline">
                  <span className="agent-name">{event.agentLabel}</span>
                  <span className="event-kind">{event.kind.toUpperCase()}</span>
                  <time>{formatDateTime(event.createdAt)}</time>
                </div>
                <h3><StreamingText text={event.title} instant={historical} /></h3>
                <p><StreamingText text={traceDetail} instant={historical || !running} /></p>
              </div>
            </article>
          );
        })}

        {running && (
          <div className="thinking-row" aria-live="polite">
            <span />
            <span />
            <span />
            <p>Agent 正在校验当前证据</p>
          </div>
        )}
        </div>
      </div>

      <div className="expert-footer">
        <div className="expert-model-line">
          <ShieldCheck size={13} />
          <span>耕策智能体</span>
          <span className="footer-dot" />
          <span>证据约束已开启</span>
        </div>
        <button className="trace-compose-button" type="button" onClick={onFocusComposer}>
          <MessageSquare size={14} />
          <span>在主输入框继续追问</span>
        </button>
      </div>
    </aside>
  );
}
