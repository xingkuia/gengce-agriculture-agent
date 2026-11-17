import { PlanApproval } from "../components/PlanApproval";
import { McpApprovalStack } from "../components/McpApproval";
import { StreamHistory, StreamingText } from "../components/StreamingText";
import { PestInspector } from "../components/PestInspector";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudSun,
  Coins,
  Droplets,
  FileText,
  ImagePlus,
  Info,
  Leaf,
  ListChecks,
  LoaderCircle,
  MapPin,
  Menu,
  MessageSquare,
  NotebookPen,
  PanelRight,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  ThermometerSun,
  TrendingUp,
  Waves,
  Wheat,
  Wind,
  X
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { formatCurrency, formatNumber } from "../lib/format";
import type {
  AgentEvent,
  BootstrapPayload,
  ChatTurn,
  CropCode,
  Farm,
  GoalKey,
  PlantingPlan,
  Plot,
  Recommendation,
  RunOverrides
} from "../types";
import type { BusinessView } from "../components/AssistantSidebar";

export interface SendOptions {
  goal: GoalKey;
  overrides?: RunOverrides;
}

interface AssistantViewProps {
  data: BootstrapPayload;
  plot: Plot;
  farm: Farm;
  turns: ChatTurn[];
  running: boolean;
  creatingPlan: boolean;
  refreshing: boolean;
  traceOpen: boolean;
  focusTurnId: string | null;
  focusSignal: number;
  onSend: (message: string, options: SendOptions) => void;
  onPestOutput?: (kind: "start" | "text" | "done" | "error", text: string) => void;
  onPestBusy?: (busy: boolean) => void;
  onChoosePlan: (recommendationId: string) => void;
  onOpenTrace: (turnId?: string) => void;
  onOpenBusiness: (view: BusinessView) => void;
  onRefresh: () => void;
  onOpenSidebar: () => void;
}

const goalOptions: Array<{
  key: GoalKey;
  label: string;
  short: string;
  icon: typeof TrendingUp;
}> = [
  { key: "profit", label: "稳健收益", short: "先看现金回报", icon: TrendingUp },
  { key: "low_risk", label: "低风险", short: "减少失收波动", icon: ShieldCheck },
  { key: "labor_saving", label: "省工易管", short: "适配现有劳力", icon: Waves },
  { key: "soil_health", label: "养地轮作", short: "兼顾下一季地力", icon: Sprout }
];

const cropIcons: Record<CropCode, typeof Wheat> = {
  wheat: Wheat,
  rapeseed: Sprout,
  rice: Waves,
  corn: ThermometerSun,
  soybean: Leaf
};

function GoalPicker({ value, onChange, disabled }: {
  value: GoalKey; onChange: (goal: GoalKey) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selected = goalOptions.find(option => option.key === value)!;
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    root.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="goal-picker" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="goal-picker-trigger" disabled={disabled}
      aria-label={"种植目标：" + selected.label} aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(current => !current)}>
      <Sparkles size={14} /><span>{selected.label}</span><ChevronDown size={12} />
    </button>
    {open && <fieldset id={panelId} className="goal-picker-panel">
      <legend>种植目标</legend>
      {goalOptions.map(option => {
        const Icon = option.icon;
        return <label key={option.key} className="goal-picker-option">
          <input type="radio" name={panelId} value={option.key} checked={value === option.key}
            onChange={() => onChange(option.key)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
            }} onClick={event => { if (event.detail > 0) { setOpen(false); trigger.current?.focus(); } }} />
          <Icon size={16} /><span><strong>{option.label}</strong><small>{option.short}</small></span>
          {value === option.key && <Check size={15} />}
        </label>;
      })}
    </fieldset>}
  </div>;
}

export function AssistantView({
  data,
  plot,
  farm,
  turns,
  running,
  creatingPlan,
  refreshing,
  traceOpen,
  focusTurnId,
  focusSignal,
  onSend, onPestOutput, onPestBusy,
  onChoosePlan,
  onOpenTrace,
  onOpenBusiness,
  onRefresh,
  onOpenSidebar
}: AssistantViewProps) {
  const [message, setMessage] = useState("");
  const [goal, setGoal] = useState<GoalKey>("profit");
  const [showOverrides, setShowOverrides] = useState(false);
  const [overrides, setOverrides] = useState<RunOverrides>({});
  const [showPest, setShowPest] = useState(false);
  const [composerNotice, setComposerNotice] = useState("");
  const [showJump, setShowJump] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestSeq = turns.at(-1)?.events?.at(-1)?.seq ?? 0;

  useEffect(() => {
    if (!scrollingThread(scrollRef.current)) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: turns.length > 1 ? "smooth" : "auto"
    });
  }, [latestSeq, running, turns.length]);

  useEffect(() => {
    if (!focusTurnId || !scrollRef.current) return;
    const target = scrollRef.current.querySelector<HTMLElement>(`[data-turn-id="${focusTurnId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusTurnId]);

  useEffect(() => {
    if (!focusSignal) return;
    textareaRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (!composerNotice) return;
    const timeout = window.setTimeout(() => setComposerNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [composerNotice]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = message.trim();
    if (!value || running) return;
    onSend(value, { goal, overrides });
    setMessage("");
  };

  const sendQuickPrompt = (prompt: string, promptGoal = goal) => {
    if (running) return;
    onSend(prompt, { goal: promptGoal, overrides });
    setMessage("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const setOverride = (key: keyof RunOverrides, value: string) => {
    setOverrides((current) => ({
      ...current,
      [key]: value === "" ? undefined : Number(value)
    }));
  };

  const pendingTasks = data.activePlan
    ? data.activePlan.plan.tasks.filter(
        (task) =>
          !data.operations.some(
            (operation) => operation.status === "done" && operation.title === task.title
          )
      ).length
    : 0;

  return (
    <main className="assistant-main">
      <header className="assistant-topbar">
        <button
          className="assistant-icon-button assistant-menu-button"
          type="button"
          onClick={onOpenSidebar}
          aria-label="打开侧栏"
        >
          <Menu size={18} />
        </button>
        <div className="assistant-location">
          <span>{farm.name}</span>
          <ChevronDown size={12} />
          <strong>{plot.name}</strong>
        </div>
        <div className="assistant-topbar-actions">
          <span className="topbar-weather">
            <CloudSun size={15} />
            <strong>{data.plotContext.weather.temperature}°</strong>
            <span>{data.plotContext.weather.condition}</span>
          </span>
          <span className="topbar-condition">
            <Droplets size={14} />
            {data.plotContext.weather.soilMoisture}%
          </span>
          {data.activePlan && (
            <button
              className="current-plan-chip"
              type="button"
              onClick={() => onOpenBusiness("plan")}
            >
              <Wheat size={14} />
              <span>{data.activePlan.cropName}</span>
              <small>{pendingTasks} 项待办</small>
            </button>
          )}
          <button
            className={`assistant-icon-button ${refreshing ? "is-spinning" : ""}`}
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="刷新天气和土壤"
            title="刷新天气和土壤"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className={`assistant-icon-button trace-toolbar-button ${traceOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => onOpenTrace()}
            aria-label={traceOpen ? "收起执行轨迹" : "打开执行轨迹"}
            title={traceOpen ? "收起执行轨迹" : "打开执行轨迹"}
          >
            <PanelRight size={17} />
          </button>
        </div>
      </header>

      <div className="assistant-thread-scroll" ref={scrollRef} onScroll={event => { const el = event.currentTarget; setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 180); }}>
        <div className={`conversation-thread ${turns.length ? "has-turns" : ""}`}>
          {!turns.length && (
            <WelcomePanel
              plot={plot}
              farm={farm}
              data={data}
              running={running}
              onQuickPrompt={sendQuickPrompt}
            />
          )}

          {turns.map((turn) => (
            <StreamHistory.Provider key={turn.id} value={Boolean(turn.restored)}>
            <ConversationTurn
              turn={turn}
              data={data}
              running={running}
              creatingPlan={creatingPlan}
              onChoosePlan={onChoosePlan}
              onAsk={sendQuickPrompt}
              onOpenTrace={onOpenTrace}
              onOpenBusiness={onOpenBusiness}
            />
            </StreamHistory.Provider>
          ))}
        </div>
      </div>

      {showJump && <button type="button" className="jump-to-latest" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}>回到最新消息 ↓</button>}
      <div className="assistant-composer-region">
        <div className="assistant-composer-wrap">
          {composerNotice && (
            <div className="composer-inline-notice" role="status">
              <Info size={14} />
              <span>{composerNotice}</span>
              <button type="button" onClick={() => setComposerNotice("")} aria-label="关闭提示">
                <X size={13} />
              </button>
            </div>
          )}
          {showOverrides && (
            <div className="composer-overrides" aria-label="本地行情覆盖">
              <div className="composer-overrides-copy">
                <strong>本地行情</strong>
                <span>留空时使用公开数据估算</span>
              </div>
              <label>
                收购价
                <span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={overrides.pricePerKg ?? ""}
                    onChange={(event) => setOverride("pricePerKg", event.target.value)}
                    placeholder="公开值"
                  />
                  元/kg
                </span>
              </label>
              <label>
                亩产
                <span>
                  <input
                    type="number"
                    min="0"
                    value={overrides.yieldPerMu ?? ""}
                    onChange={(event) => setOverride("yieldPerMu", event.target.value)}
                    placeholder="公开值"
                  />
                  kg
                </span>
              </label>
              <label>
                成本
                <span>
                  <input
                    type="number"
                    min="0"
                    value={overrides.costPerMu ?? ""}
                    onChange={(event) => setOverride("costPerMu", event.target.value)}
                    placeholder="公开值"
                  />
                  元/亩
                </span>
              </label>
            </div>
          )}
          {showPest && <PestInspector key={plot.id} plotId={plot.id} onOutput={(kind, text) => { onPestOutput?.(kind, text); if (kind === "done") setShowPest(false); }} onBusyChange={onPestBusy} disabled={running} onClose={() => setShowPest(false)} />}
          <form className="assistant-composer" onSubmit={submit}>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => { setMessage(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, window.innerHeight * 0.55)}px`; }}
              onKeyDown={handleKeyDown}
              placeholder={`问问${plot.name}该种什么、天气风险或田间管理…`}
              rows={message.includes("\n") ? 8 : 2}
              aria-label="给农业助手下达任务"
              disabled={running}
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                <GoalPicker value={goal} onChange={setGoal} disabled={running} />
                <button
                  className={showOverrides ? "is-active" : ""}
                  type="button"
                  aria-expanded={showOverrides}
                  onClick={() => setShowOverrides((value) => !value)}
                >
                  <SlidersHorizontal size={14} />
                  <span>本地行情</span>
                </button>
                <button
                  type="button"
                  aria-expanded={showPest}
                  onClick={() => setShowPest(value => !value)}
                >
                  <ImagePlus size={14} />
                  <span>虫害图片</span>
                </button>
              </div>
              <button
                className="composer-send"
                type="submit"
                disabled={running || !message.trim()}
                aria-label="发送"
              >
                {running ? <LoaderCircle className="is-spinning" size={17} /> : <ArrowUp size={18} />}
              </button>
            </div>
          </form>
          <p className="composer-footnote">
            建议基于公开天气、土壤与农艺规则。价格和成本可覆盖，结果不构成产量保证。
          </p>
        </div>
      </div>
    </main>
  );
}

function WelcomePanel({
  plot,
  farm,
  data,
  running,
  onQuickPrompt
}: {
  plot: Plot;
  farm: Farm;
  data: BootstrapPayload;
  running: boolean;
  onQuickPrompt: (prompt: string, goal?: GoalKey) => void;
}) {
  const warning = data.plotContext.weather.warnings[0];

  return (
    <section className="assistant-welcome" aria-labelledby="assistant-welcome-title">
      <div className="welcome-mark" aria-hidden="true">
        <Sprout size={25} strokeWidth={1.8} />
      </div>
      <h1 id="assistant-welcome-title">让每一季，都有据可循。</h1>
      <p className="welcome-copy">
        我会结合{farm.district}的天气、{plot.name}的土壤和上一季记录，
        一起安排好这一季。
      </p>
      <div className="welcome-context">
        <span><MapPin size={13} />{farm.city} · {farm.district}</span>
        <span><Droplets size={13} />土壤湿度 {data.plotContext.weather.soilMoisture}%</span>
        <span><Wind size={13} />{data.plotContext.weather.windSpeed} m/s</span>
        {warning && <span className="has-warning"><AlertTriangle size={13} />{warning.title}</span>}
      </div>
      <div className="welcome-prompts">
        <button type="button" disabled={running} onClick={() => onQuickPrompt("比较这季适合种什么，优先考虑稳健收益。", "profit")}>
          <span className="prompt-icon"><Wheat size={17} /></span>
          <span>
            <strong>比较这季种什么</strong>
            <small>按收益、风险和劳力给出不同选择</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button type="button" disabled={running} onClick={() => onQuickPrompt("未来 7 天有哪些天气风险，需要提前做什么？")}>
          <span className="prompt-icon"><CloudSun size={17} /></span>
          <span>
            <strong>看看天气风险</strong>
            <small>结合未来降水和风速给出提醒</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button type="button" disabled={running} onClick={() => onQuickPrompt("家里劳力有限，哪种作物更省工？", "labor_saving")}>
          <span className="prompt-icon"><Waves size={17} /></span>
          <span>
            <strong>哪种作物更省工</strong>
            <small>把家庭劳动力作为首要约束</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <button type="button" disabled={running} onClick={() => onQuickPrompt("根据当前土壤，播种前应做哪些测土和施肥准备？")}><span className="prompt-icon"><Sprout size={17} /></span><span><strong>安排田间管理</strong><small>从测土到水肥，明确下一步</small></span><ArrowRight size={15} /></button>
      </div>
    </section>
  );
}

function ConversationTurn({
  turn,
  data,
  running,
  creatingPlan,
  onChoosePlan,
  onAsk,
  onOpenTrace,
  onOpenBusiness
}: {
  turn: ChatTurn;
  data: BootstrapPayload;
  running: boolean;
  creatingPlan: boolean;
  onChoosePlan: (recommendationId: string) => void;
  onAsk: (prompt: string) => void;
  onOpenTrace: (turnId?: string) => void;
  onOpenBusiness: (view: BusinessView) => void;
}) {
  if (turn.role === "user") {
    return (
      <article className="chat-turn user-turn" data-turn-id={turn.id}>
        <div className="user-message">{turn.content}</div>
      </article>
    );
  }

  if (turn.kind === "message") {
    return (
      <article className="chat-turn assistant-turn" data-turn-id={turn.id} data-status={turn.status}>
        <div className="assistant-avatar" aria-hidden="true">
          <Sprout size={15} />
        </div>
        <div className="assistant-message">
          <StreamingText text={turn.content} className="assistant-stream-copy" />
          {!!turn.events?.length && <button type="button" className="pest-trace-link" onClick={() => onOpenTrace(turn.id)}>识别过程 · {turn.events.length} 项</button>}
          {turn.actionLabel && (turn.actionPrompt || turn.actionView) && (
            <div className="message-inline-actions">
              <button
                type="button"
                onClick={() => {
                  if (turn.actionPrompt) onAsk(turn.actionPrompt);
                  else if (turn.actionView) onOpenBusiness(turn.actionView);
                }}
              >
                {turn.actionLabel}
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </article>
    );
  }

  if (turn.kind === "plan") {
    const plan = turn.planSnapshot ?? (data.activePlan?.id === turn.planId ? data.activePlan : null);
    return (
      <article className="chat-turn assistant-turn plan-response" data-turn-id={turn.id}>
        <div className="assistant-avatar" aria-hidden="true">
          <Sprout size={15} />
        </div>
        <div className="assistant-message">
          <StreamingText text={turn.content} className="assistant-stream-copy" />
          {plan ? (
            <PlanDocumentBlock
              plan={plan}
              data={data}
              onAsk={onAsk}
              onOpenBusiness={onOpenBusiness}
            />
          ) : (
            <p className="plan-document-missing">当前活动方案已切换，这份文档仍保留在对话记录中。</p>
          )}
        </div>
      </article>
    );
  }

  const events = turn.events ?? [];
  const latestEvent = events.at(-1);
  const answerEvent = events.find((event) => event.kind === "answer");
  const recommendations = turn.recommendations ?? data.recommendations.filter((item) => item.runId === turn.runId);

  return (
    <article className="chat-turn assistant-turn run-turn" data-turn-id={turn.id}>
      <div className="assistant-avatar" aria-hidden="true">
        <Sprout size={15} />
      </div>
      <div className="assistant-message run-message">
        <div className="run-status-line">
          {turn.status === "running" && (
            <>
              <LoaderCircle className="is-spinning" size={14} />
              <span><StreamingText key={latestEvent?.seq ?? 0} text={latestEvent?.title ?? "正在读取地块证据"} /></span>
            </>
          )}
          {turn.status === "done" && (
            <>
              <CheckCircle2 size={14} />
              <span>{turn.mode === "recommend" ? "已完成比较与独立校验" : "已核对证据并完成回答"}</span>
            </>
          )}

        {turn.status === "error" && (
            <>
              <AlertTriangle size={14} />
              <span>本次任务未完成</span>
            </>
          )}
          <button type="button" onClick={() => onOpenTrace(turn.id)}>
            执行轨迹
            <ChevronDown size={12} />
          </button>
        </div>

        <McpApprovalStack events={events} accountId={data.account.id} />

          {events.some((event) => event.kind === "tool") && <details className="thread-tools"><summary>工具调用 · {events.filter((event) => event.kind === "tool").length} 项</summary>{events.filter((event) => event.kind === "tool").map((event) => <div key={event.seq}><code>{event.agent}</code><span>{event.title}</span><small>{event.status === "running" ? "执行中" : "已返回"}</small></div>)}</details>}
        {turn.status === "running" && (
          <div className="running-skeleton" aria-label="Agent 正在生成结果">
            <p><StreamingText key={latestEvent?.seq ?? 0} text={latestEvent?.detail ?? "正在读取地块档案，随后并行获取天气与土壤证据。"} /></p>
          </div>
        )}

        {turn.status === "error" && (
          <p className="run-error-copy">Agent 连接中断或服务暂不可用，请检查本地服务后重试。</p>
        )}

        {turn.mode === "question" && (answerEvent || turn.draft) && (
          <AnswerBlock pending={turn.status !== "done"} event={answerEvent ?? { detail: turn.draft, payload: { answer: turn.draft } } as AgentEvent} onOpenBusiness={onOpenBusiness} hasPlan={Boolean(data.activePlan)} />
        )}

        {turn.status === "running" && turn.mode === "recommend" && turn.draft && <p className="stream-draft"><StreamingText text={turn.draft} /></p>}
        {turn.status === "done" && turn.mode === "recommend" && (
          <RecommendationBlock
            recommendations={recommendations}
            initialGoal={turn.goal ?? "profit"}
            activePlan={data.activePlan}
            creatingPlan={creatingPlan}
            running={running}
            onChoosePlan={onChoosePlan}
          />
        )}
      </div>
    </article>
  );
}

function AnswerBlock({
  event, pending = false,
  onOpenBusiness,
  hasPlan
}: {
  event: AgentEvent;
  pending?: boolean;
  onOpenBusiness: (view: BusinessView) => void;
  hasPlan: boolean;
}) {
  const payload = event.payload as
    | { answer?: string; sources?: string[]; modelUsed?: boolean }
    | undefined;
  const answer = payload?.answer ?? event.detail;

  return (
    <section className="answer-block">
      <div className="answer-copy">
        <StreamingText text={answer} className="answer-copy-text" />
      </div>
      <div className="answer-footer">
        <span>
          <BadgeCheck size={13} />
          {pending ? "正在生成，结论待复核" : payload?.modelUsed ? "模型表达 · 证据已复核" : "规则回答 · 证据已复核"}
        </span>
        {payload?.sources?.length ? <span>{payload.sources.length} 项依据</span> : null}
        {hasPlan && (
          <button type="button" onClick={() => onOpenBusiness("records")}>
            记录农事
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </section>
  );
}

function PlanDocumentBlock({
  plan,
  data,
  onAsk,
  onOpenBusiness
}: {
  plan: PlantingPlan;
  data: BootstrapPayload;
  onAsk: (prompt: string) => void;
  onOpenBusiness: (view: BusinessView) => void;
}) {
  const plotName =
    data.farms.flatMap((farm) => farm.plots).find((plot) => plot.id === plan.plotId)?.name ??
    "当前地块";
  const criticalCount = plan.plan.tasks.filter((task) => task.priority === "critical").length;
  const [expanded,setExpanded]=useState(true);

  return (
    <article className="plan-document-card" aria-label={`${plotName}${plan.cropName}种植方案文档`}>
      <header className="plan-document-header">
        <span className="plan-document-icon" aria-hidden="true">
          <FileText size={18} />
        </span>
        <span className="plan-document-heading">
          <strong>{plotName} · {plan.cropName}种植方案</strong>
          <small>{plan.season} · {plan.plan.tasks.length} 项作业 · {criticalCount} 项关键窗口</small>
        </span>
        <span className="plan-document-status">
          <BadgeCheck size={13} />
          已建立
        </span>
      </header>

      <div className="plan-document-meta">
        <div>
          <MapPin size={14} />
          <span>
            <small>执行地块</small>
            <strong>{plotName}</strong>
          </span>
        </div>
        <div>
          <CalendarDays size={14} />
          <span>
            <small>建议开始</small>
            <strong>{plan.startDate}</strong>
          </span>
        </div>
        <div>
          <ListChecks size={14} />
          <span>
            <small>执行节奏</small>
            <strong>{plan.plan.tasks.length} 项可记录作业</strong>
          </span>
        </div>
      </div>

      <details className="plan-document-details" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
        <summary>
          <span>
            <ListChecks size={14} />
            详细执行规划
          </span>
          <span>
            {expanded ? "收起" : "展开"}全部 {plan.plan.tasks.length} 项
            <ChevronDown size={13} />
          </span>
        </summary>
        <ol className="plan-document-tasks">
          {plan.plan.tasks.map((task, index) => (
            <li key={task.id}>
              <span className="plan-task-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="plan-task-copy">
                <strong><StreamingText text={task.title} /></strong>
                <small>{task.phase} · {task.dateWindow}</small>
                <p className="inline-plan-method"><StreamingText text={task.method} /></p>
                <p><span>用量 / 标准：</span><StreamingText text={task.quantity} /></p>
                <p><span>安排原因：</span><StreamingText text={task.rationale} /></p>
              </div>
              {task.priority === "critical" && <span className="plan-task-priority">关键</span>}
            </li>
          ))}
        </ol>
        <div className="inline-plan-guidance">
          {[
            ["方案依据",plan.plan.decisionReasons],
            ["施肥框架",plan.plan.inputPlan],
            ["水分管理",plan.plan.waterPlan],
            ["田间监测",plan.plan.monitoring],
            ["证据来源",plan.plan.evidence]
          ].map(([title,items])=><section key={String(title)}><h4>{String(title)}</h4><ul>{(items as string[]).map((item,index)=><li key={index}><StreamingText text={item} /></li>)}</ul></section>)}
        </div>
      </details>

      <footer className="plan-document-actions">
        <button
          className="is-primary"
          type="button"
          onClick={() => onAsk("根据当前种植方案，告诉我未来 7 天最应该优先做什么。")}
        >
          <Sparkles size={14} />
          继续问下一步
        </button>
        <button type="button" onClick={() => setExpanded(current=>!current)}>
          <PanelRight size={14} />
          {expanded ? "收起详细规划" : "展开详细规划"}
        </button>
        <button type="button" onClick={() => onOpenBusiness("records")}>
          <NotebookPen size={14} />
          记录农事
        </button>
      </footer>
    </article>
  );
}

function RecommendationBlock({
  recommendations,
  initialGoal,
  activePlan,
  creatingPlan,
  running,
  onChoosePlan
}: {
  recommendations: Recommendation[];
  initialGoal: GoalKey;
  activePlan: BootstrapPayload["activePlan"];
  creatingPlan: boolean;
  running: boolean;
  onChoosePlan: (recommendationId: string) => void;
}) {
  const detailId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [activeGoal, setActiveGoal] = useState<GoalKey>(initialGoal);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...recommendations].sort((left, right) => right.goalScores[activeGoal] - left.goalScores[activeGoal]),
    [activeGoal, recommendations]
  );
  const selected = sorted.find((item) => item.id === selectedId) ?? sorted[0] ?? null;

  if (!recommendations.length) {
    return (
      <div className="recommendation-loading">
        <LoaderCircle className="is-spinning" size={16} />
        正在整理候选结果…
      </div>
    );
  }

  if (!selected) return null;
  const SelectedIcon = cropIcons[selected.cropCode] ?? Wheat;
  const alreadyApplied = activePlan?.recommendationId === selected.id;

  return (
    <section className="recommendation-block">
      <div className="recommendation-intro">
        <div>
          <span className="result-kicker">本季建议</span>
          <h2><StreamingText text={`先考虑${selected.cropName}`} /></h2>
          <p><StreamingText text={selected.summary} className="recommendation-summary" /></p>
        </div>
        <span className={`risk-badge risk-${selected.riskLevel}`}>
          {selected.riskLevel}风险
        </span>
      </div>

      <div className="assistant-goal-tabs" role="tablist" aria-label="切换种植目标">
        {goalOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeGoal === option.key}
              className={activeGoal === option.key ? "is-active" : ""}
              key={option.key}
              onClick={() => {
                setActiveGoal(option.key);
                setCollapsed(false);
                const next = [...recommendations].sort(
                  (left, right) => right.goalScores[option.key] - left.goalScores[option.key]
                )[0];
                setSelectedId(next?.id ?? null);
              }}
            >
              <Icon size={14} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="goal-explanation">
        {goalOptions.find((option) => option.key === activeGoal)?.short}。排序会随目标变化，没有唯一的综合分。
      </p>

      <div className="assistant-candidate-list" role="list">
        {sorted.map((recommendation, index) => {
          const Icon = cropIcons[recommendation.cropCode] ?? Wheat;
          const expanded = selected.id === recommendation.id && !collapsed;
          return (
            <div className="assistant-candidate-item" role="listitem" key={recommendation.id}>
            <button
              className={`assistant-candidate-row ${selected.id === recommendation.id ? "is-selected" : ""}`}
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? `${detailId}-${recommendation.id}` : undefined}
              onClick={() => {
                setSelectedId(recommendation.id);
                setCollapsed(expanded);
              }}
            >
              <span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="candidate-crop-icon"><Icon size={17} /></span>
              <span className="candidate-name">
                <strong>{recommendation.cropName}</strong>
                <small>{recommendation.seasonStatus}</small>
              </span>
              <span className="candidate-fit">
                <strong>{recommendation.goalScores[activeGoal]}</strong>
                <small>目标匹配</small>
              </span>
              <span className="candidate-economics">
                <strong>{formatCurrency(recommendation.economics.marginPerMu)}</strong>
                <small>估算收益/亩</small>
              </span>
              <span className={`candidate-risk risk-${recommendation.riskLevel}`}>{recommendation.riskLevel}</span>
            </button>
            {selected.id === recommendation.id && (
            <div className={`candidate-expansion ${expanded ? "is-open" : ""}`} aria-hidden={!expanded} inert={!expanded}><div className="candidate-expansion-clip">
      <div className="candidate-detail-panel" id={`${detailId}-${recommendation.id}`} role="region" aria-label={`${selected.cropName}方案详情`}>
        <div className="candidate-detail-title">
          <span className="candidate-detail-icon"><SelectedIcon size={19} /></span>
          <div>
            <h3><StreamingText text={selected.cropName} /></h3>
            <p>{selected.plan.season} · {selected.seasonStatus} · 置信度 {Math.round(selected.confidence * 100)}%</p>
          </div>
          <span className="verified-inline"><BadgeCheck size={14} />数值复算通过</span>
        </div>
        <div className="candidate-reasons">
          {selected.decisionReasons.slice(0, 3).map((reason) => (
            <span key={reason}><Check size={13} /><StreamingText text={reason} /></span>
          ))}
        </div>
        <div className="candidate-economics-strip">
          <div><Coins size={14} /><span>估算亩均收益</span><strong>{formatCurrency(selected.economics.marginPerMu)}</strong></div>
          <div><TrendingUp size={14} /><span>估算总收益</span><strong>{formatCurrency(selected.economics.marginTotal)}</strong></div>
          <div><MapPin size={14} /><span>预估亩产</span><strong>{formatNumber(selected.economics.yieldPerMu, 0)} kg/亩</strong></div>
        </div>
        {selected.warnings[0] && (
          <p className="candidate-warning"><Info size={13} /><StreamingText text={selected.warnings[0]} /></p>
        )}
        <div className="candidate-actions">
          <button
            className="primary-button"
            type="button"
            disabled={creatingPlan || running || alreadyApplied}
            onClick={() => onChoosePlan(selected.id)}
          >
            {creatingPlan ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}
            {alreadyApplied ? "已采用该方案" : creatingPlan ? "正在建立方案" : "采用这个方案"}
          </button>
          <details className="candidate-evidence">
            <summary>查看依据与公开估算</summary>
            <ul>
              {selected.evidence.slice(0, 4).map((item) => <li key={item}><StreamingText text={item} /></li>)}
              <li>经济数据为公开数据估算，可通过本地行情覆盖。</li>
            </ul>
          </details>
        </div>
        <PlanApproval recommendation={selected} />
      </div>
            </div></div>
            )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function scrollingThread(element: HTMLElement | null) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < 220;
}
