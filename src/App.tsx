import { PlanApprovalContext } from "./components/PlanApproval";
import { FarmManager } from "./components/FarmManager";
import { AlertTriangle, ArrowRight, RefreshCw, Sprout, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AssistantSidebar, type BusinessView } from "./components/AssistantSidebar";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { ExpertPanel } from "./components/ExpertPanel";
import {
  listChats, getChat, saveChat, getWorkspace,
  createPlantingPlan,
  getBootstrap,
  refreshPlotContext,
  startAgricultureRun,
  streamRun
} from "./lib/api";
import type {
  AgentEvent,
  BootstrapPayload,
  ChatTurn, ChatSummary, Workspace
} from "./types";
import { AssistantView, type SendOptions } from "./views/AssistantView";
import { CapabilitiesView } from "./views/CapabilitiesView";
import { EvaluationView } from "./views/EvaluationView";
import { FarmsView } from "./views/FarmsView";
import { PlanView } from "./views/PlanView";
import { RecordsView } from "./views/RecordsView";
import { ResultsView } from "./views/ResultsView";

const businessTitles: Record<BusinessView, string> = {
  plan: "种植方案",
  records: "农事记录",
  results: "结果复盘",
  farms: "基地与地块",
  evaluation: "Agent 评估",
  capabilities: "能力中心"
};

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [emptyWorkspace, setEmptyWorkspace] = useState<Workspace | null>(null);
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [chatId, setChatId] = useState<string>(createId);
  const [savedChats, setSavedChats] = useState<ChatSummary[]>([]);
  const saveQueue = useRef(Promise.resolve());
  const snapshot = useRef<{ id: string; plotId: string; turns: ChatTurn[] } | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [focusTurnId, setFocusTurnId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [running, setRunning] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [traceHistorical, setTraceHistorical] = useState(true);
  const [traceOpen, setTraceOpen] = useState(() => window.innerWidth >= 1180);
  const [businessView, setBusinessView] = useState<BusinessView | null>(null);
  const [farmEditRequest, setFarmEditRequest] = useState<{ farmId: string; token: number } | null>(null);
  const [fatalError, setFatalError] = useState("");
  const [actionError, setActionError] = useState("");
  const pestTurnRef = useRef<string | null>(null);
  const pestEventsRef = useRef<AgentEvent[]>([]);
  const streamCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const change = () => setTraceOpen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setBusinessView(null); setSidebarOpen(false); setTraceOpen(false); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const applyPayload = useCallback((payload: BootstrapPayload) => {
    setData(payload);
    return payload;
  }, []);

  const persistNow = useCallback(() => {
    const value = snapshot.current;
    if (!value?.turns.length) return;
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      await saveChat(value.id, value.plotId, value.turns);
    }).catch(error => setActionError(error instanceof Error ? error.message : "对话保存失败"));
  }, []);

  useEffect(() => {
    if (!data || !turns.length) { snapshot.current = null; return; }
    snapshot.current = { id: chatId, plotId: data.activePlotId, turns };
    const title = turns.find(t => t.role === 'user')?.content.slice(0, 80) ?? '新对话';
    const summary = { preview: turns.at(-1)?.content.slice(0,100), id: chatId, plotId: data.activePlotId, title, updatedAt: new Date().toISOString(), status: running ? 'running' : 'done' };
    setSavedChats(current => [summary, ...current.filter(c => c.id !== chatId)]);
    const timer = window.setTimeout(persistNow, 300);
    return () => window.clearTimeout(timer);
  }, [turns, chatId, data?.activePlotId, running, persistNow]);

  useEffect(() => {
    const flush = () => {
      const value = snapshot.current;
      if (value?.turns.length) navigator.sendBeacon('/api/chats/' + value.id, new Blob([JSON.stringify({ plotId: value.plotId, turns: value.turns })], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const startNewChat = useCallback(() => {
    if (running) return;
    persistNow();
    setChatId(createId());
    streamCleanup.current?.();
    streamCleanup.current = null;
    setPendingPlan(null);
    setTurns([]);
    setEvents([]);
    setRunId(null);
    setActiveTurnId(null);
    setFocusTurnId(null);
    setSidebarOpen(false);
    setBusinessView(null);
    window.setTimeout(() => setFocusSignal((value) => value + 1), 30);
  }, [running, persistNow]);

  useEffect(() => {
    let active = true;
    Promise.all([getWorkspace(), listChats()])
      .then(async ([workspace, chats]) => {
        if (!active) return;
        setSavedChats(chats);
        if (!workspace.farms.some(f => f.plots.length)) { setEmptyWorkspace(workspace); return; }
        const payload = await getBootstrap();
        const available = new Set(workspace.farms.flatMap(f => f.plots.map(p => p.id)));
        const recent = chats.find(c => available.has(c.plotId));
        if (recent) {
          const chat = await getChat(recent.id);
          const context = chat.plotId === payload.activePlotId ? payload : await getBootstrap(chat.plotId);
          if (!active) return;
          setData(context); setChatId(chat.id);
          const restored = chat.turns.map(t => ({ ...t, restored: true }));
          setTurns(restored);
          const last = [...restored].reverse().find(t => t.status === "running" && t.runId) ??
            [...restored].reverse().find(t => t.runId);
          setEvents(last?.events ?? []);
          setRunId(last?.runId ?? null);
          setActiveTurnId(last?.id ?? null);
          if (last?.status === "running" && last.runId) {
            setRunning(true);
            setTraceHistorical(false);
            beginStream(last.runId, last.id, chat.plotId);
          }
        } else setData(payload);
      })
      .catch((error: unknown) => {
        if (active) {
          setFatalError(error instanceof Error ? error.message : "农业助手加载失败");
        }
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    return () => {
      active = false;
      streamCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    if (!actionError) return;
    const timeout = window.setTimeout(() => setActionError(""), 6500);
    return () => window.clearTimeout(timeout);
  }, [actionError]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [startNewChat]);

  const openBusiness = (view: BusinessView) => {
    setBusinessView(view);
    setSidebarOpen(false);
  };

  const openFarmEditor = (farmId: string) => {
    setFarmEditRequest({ farmId, token: Date.now() });
    setBusinessView("farms");
    setSidebarOpen(false);
  };

  const openTrace = (turnId?: string) => {
    const target = turnId ? turns.find((turn) => turn.id === turnId) : null;
    if (target) {
      setTraceHistorical(target.status !== "running");
      setEvents(target.events ?? []);
      setRunId(target.runId ?? null);
      setActiveTurnId(target.id);
      setFocusTurnId(null);
      window.setTimeout(() => setFocusTurnId(target.id), 30);
    }
    setTraceOpen((current) => (turnId ? true : !current));
  };

  const selectConversation = async (id: string) => {
    if (running || id === chatId) return;
    persistNow();
    try {
      await saveQueue.current;
      const chat = await getChat(id);
      const context = await getBootstrap(chat.plotId);
      if (context.activePlotId !== chat.plotId) throw new Error("此对话关联的地块已删除，请先在基地管理中恢复");
      setTraceHistorical(true);
      setData(context); setChatId(id);
      const restored = chat.turns.map(t => ({ ...t, restored: true }));
      setTurns(restored);
      const last = [...restored].reverse().find(t => t.status === "running" && t.runId) ??
        [...restored].reverse().find(t => t.runId);
      setEvents(last?.events ?? []); setRunId(last?.runId ?? null);
      setActiveTurnId(last?.id ?? null); setFocusTurnId(restored.at(-1)?.id ?? null);
      setSidebarOpen(false); setBusinessView(null); setPendingPlan(null);
      if (last?.status === "running" && last.runId) {
        setRunning(true);
        setTraceHistorical(false);
        beginStream(last.runId, last.id, chat.plotId);
      }
    } catch(error) { setActionError(error instanceof Error ? error.message : '对话加载失败'); }
  };

  const finishTurn = async (turnId: string, plotId: string, status: "done" | "error") => {
    let nextPayload: BootstrapPayload | null = null;
    if (status === "done") {
      try {
        nextPayload = await getBootstrap(plotId);
        applyPayload(nextPayload);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "结果刷新失败");
        status = "error";
      }
    }
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? { ...turn, status, content: nextPayload?.latestRun?.id === turn.runId ? nextPayload?.latestRun?.summary ?? turn.content : turn.content, draft: undefined, recommendations: nextPayload?.recommendations.filter(r => r.runId === turn.runId) } : turn))
    );
    if (nextPayload) setTraceOpen(true);
  };

  const beginStream = (
    nextRunId: string,
    assistantTurnId: string,
    plotId: string
  ) => {
    streamCleanup.current?.();
    setTraceHistorical(false);
    setRunId(nextRunId);
    setEvents([]);
    streamCleanup.current = streamRun(
      nextRunId,
      (event) => {
        setEvents((current) =>
          current.some((item) => item.seq === event.seq) ? current : [...current, event]
        );
        setTurns((current) =>
          current.map((turn) => {
            if (turn.id !== assistantTurnId) return turn;
            const currentEvents = turn.events ?? [];
            return currentEvents.some((item) => item.seq === event.seq)
              ? turn
              : { ...turn, events: [...currentEvents, event] };
          })
        );
      },
      () => {
        streamCleanup.current = null;
        setRunning(false);
        void finishTurn(assistantTurnId, plotId, "done");
      },
      (error) => {
        streamCleanup.current = null;
        setRunning(false);
        setActionError(error.message);
        setTurns((current) =>
          current.map((turn) =>
            turn.id === assistantTurnId ? { ...turn, status: "error" } : turn
          )
        );
      },
      text => setTurns(current => current.map(turn => turn.id === assistantTurnId ? { ...turn, draft: text } : turn))
    );
  };

  const startConversationRun = async (
    message: string,
    mode: "recommend" | "question",
    options: SendOptions
  ) => {
    if (running || !data) return;
    const userId = createId();
    const assistantId = createId();
    const createdAt = new Date().toISOString();
    setTurns((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        kind: "message",
        content: message,
        createdAt
      },
      {
        id: assistantId,
        role: "assistant",
        kind: "run",
        content: message,
        createdAt,
        mode,
        goal: options.goal,
        events: [],
        status: "running"
      }
    ]);
    setActiveTurnId(assistantId);
    setFocusTurnId(assistantId);
    setRunning(true);
    setTraceOpen(true);
    setEvents([]);
    setRunId(null);
    setActionError("");

    try {
      const response = await startAgricultureRun({
        accountId: data.account.id,
        plotId: data.activePlotId,
        mode,
        goal: options.goal,
        message,
        overrides: options.overrides
      });
      setTurns((current) =>
        current.map((turn) => (turn.id === assistantId ? { ...turn, runId: response.runId } : turn))
      );
      beginStream(response.runId, assistantId, data.activePlotId);
    } catch (error) {
      setRunning(false);
      setActionError(error instanceof Error ? error.message : "无法启动 Agent 任务");
      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantId ? { ...turn, status: "error" } : turn
        )
      );
    }
  };

  const appendAssistantMessage = (
    content: string,
    actions?: Pick<ChatTurn, "actionLabel" | "actionView" | "actionPrompt">
  ) => {
    const turn: ChatTurn = {
      id: createId(),
      role: "assistant",
      kind: "message",
      content,
      createdAt: new Date().toISOString(),
      ...actions
    };
    setTurns((current) => [...current, turn]);
    setActiveTurnId(turn.id);
    setFocusTurnId(turn.id);
  };

  const handleSend = (message: string, options: SendOptions) => {
    if (!data) return;
    const recommendationIntent =
      /(种什么|种哪|选种|比较.*(作物|种植|方案)|种植方案|推荐.*(作物|种植)|稳健收益|低风险|省工|轮作|收益)/.test(
        message
      );
    const recordIntent =
      /(记录|记一下|完成了|已经.*(施肥|打药|播种|灌溉)|刚.*(施肥|打药|播种|灌溉))/.test(
        message
      );
    const resultIntent = /(实际产量|实收|结果复盘|收入.*成本|提交结果)/.test(message);

    if (recordIntent || resultIntent) {
      const targetView: BusinessView = resultIntent ? "results" : "records";
      setTurns((current) => [
        ...current,
        {
          id: createId(),
          role: "user",
          kind: "message",
          content: message,
          createdAt: new Date().toISOString()
        }
      ]);
      if (!data.activePlan) {
        appendAssistantMessage(
          "这块地还没有正在执行的种植方案。先在对话里比较本季作物并采用一套方案，之后农事记录才能与计划和成本对应。",
          {
            actionLabel: "开始比较本季作物",
            actionPrompt: "比较这块地本季适合种植的作物，优先考虑稳健收益。"
          }
        );
      } else {
        appendAssistantMessage(
          resultIntent
            ? "可以。结果复盘需要实际产量、品质、收入和成本，填入后才能与最初估算比较。需要录入时再展开结果文档。"
            : "可以。农事记录需要作业日期、完成状态、用量和现金成本。需要录入时再展开农事台账。",
          {
            actionLabel: resultIntent ? "展开结果复盘" : "展开农事记录",
            actionView: targetView
          }
        );
      }
      return;
    }

    const followUpIntent = /下一步|根据当前种植方案|未来.*(优先|做什么)/.test(message);
    void startConversationRun(message, recommendationIntent && !followUpIntent ? "recommend" : "question", options);
  };

  const handleSelectPlot = async (plotId: string) => {
    if (!data || plotId === data.activePlotId || running) return;
    persistNow();
    streamCleanup.current?.();
    streamCleanup.current = null;
    try {
      const payload = await getBootstrap(plotId);
      applyPayload(payload);
      setPendingPlan(null);
      setChatId(createId());
      setTurns([]);
      setEvents([]);
      setRunId(null);
      setActiveTurnId(null);
      setFocusTurnId(null);
      setBusinessView(null);
      setSidebarOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "地块切换失败");
    }
  };

  const handleChoosePlan = async (recommendationId: string) => {
    if (!data || creatingPlan) return false;
    setCreatingPlan(true);
    try {
      await createPlantingPlan(recommendationId, data.account.id);
      const payload = await getBootstrap(data.activePlotId);
      applyPayload(payload);
      if (!payload.activePlan) {
        appendAssistantMessage("方案已经建立，但详情暂时没有返回。你可以稍后重新打开当前工作区。");
        return;
      }

      const plan = payload.activePlan;
      const criticalCount = plan.plan.tasks.filter((task) => task.priority === "critical").length;
      const firstTask = plan.plan.tasks[0];
      const adoptedAt = new Date().toISOString();
      const adoptionTurn: ChatTurn = {
        id: createId(),
        role: "user",
        kind: "message",
        content: `采用${plan.cropName}方案`,
        createdAt: adoptedAt
      };
      const planTurn: ChatTurn = {
        id: createId(),
        role: "assistant",
        kind: "plan",
        planId: plan.id,
        planSnapshot: plan,
        content: [
          `已采用${plan.cropName}，并把候选建议整理成一份可执行方案。`,
          plan.plan.summary,
          firstTask
            ? `第一项是“${firstTask.title}”，执行窗口为${firstTask.dateWindow}。${criticalCount ? `方案中有 ${criticalCount} 项关键作业，建议优先确认。` : "当前没有标记为关键的作业。"}`
            : "当前方案的作业清单为空，请继续追问以补充执行安排。",
          "详细作业时间、做法、用量标准与水肥监测安排已列在下方。你可以继续在这里问播种、施肥、天气窗口或下一步安排。"
        ].join("\n\n"),
        createdAt: new Date().toISOString()
      };
      setTurns((current) => [...current, adoptionTurn, planTurn]);
      setActiveTurnId(adoptionTurn.id);
      setFocusTurnId(planTurn.id);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "种植方案建立失败");
      return false;
    } finally {
      setCreatingPlan(false);
    }
  };

  const handlePestOutput = (kind: 'start' | 'text' | 'done' | 'error', text: string) => {
    if (kind === 'start') {
      setTraceHistorical(false);
      const id = createId(); pestTurnRef.current = id; pestEventsRef.current = [];
      setTurns(current => [...current,
        { id: createId(), role: 'user', kind: 'message', content: '识别当前地块的虫害图片' + (text ? '：' + text : ''), createdAt: new Date().toISOString() },
        { id, role: 'assistant', kind: 'message', content: '', status: 'running', createdAt: new Date().toISOString() }
      ]);
      setActiveTurnId(id); setTraceOpen(true); setRunId(null); setEvents([]);
    }
    if (kind !== 'text' || pestEventsRef.current.length === 1) {
      const titles = { start: '正在读取图片', text: '正在观察图像特征', done: '图像初筛与结构检查已完成', error: '识别未完成，已保留收到的内容' };
      const seq = pestEventsRef.current.length + 1;
      const event: AgentEvent = { id: seq, seq, runId: 'pest', agent: 'pest-vision', agentLabel: '虫害识别 Agent', kind: kind === 'done' ? 'verify' : 'tool', title: titles[kind], detail: kind === 'done' ? '结论已保存，可继续补拍核实。' : kind === 'error' ? text : '根据照片中的可见特征逐步整理，结论待复核。', status: kind === 'error' ? 'error' : kind === 'done' ? 'success' : 'running', createdAt: new Date().toISOString() };
      pestEventsRef.current = [...pestEventsRef.current, event]; setEvents(pestEventsRef.current);
    }
    const trace = pestEventsRef.current;
    setTurns(current => current.map(turn => turn.id !== pestTurnRef.current ? turn : {
      ...turn, events: trace, content: kind === 'start' ? '' : kind === 'error' ? turn.content + '\n\n识别中断：' + text : text,
      status: kind === 'done' ? 'done' : kind === 'error' ? 'error' : 'running'
    }));
  };

  const refreshManagedWorkspace = async () => {
    persistNow();
    const workspace = await getWorkspace();
    if (!workspace.farms.some(f => f.plots.length)) {
      setEmptyWorkspace(workspace); setPendingPlan(null); return;
    }
    const payload = await getBootstrap(data?.activePlotId);
    if (!data || payload.activePlotId !== data.activePlotId) {
      setChatId(createId()); setTurns([]); setEvents([]); setRunId(null); setActiveTurnId(null); setFocusTurnId(null);
    }
    applyPayload(payload); setEmptyWorkspace(null); setPendingPlan(null);
  };

  const handleRefreshContext = async () => {
    if (!data || refreshingContext) return;
    setRefreshingContext(true);
    try {
      await refreshPlotContext(data.activePlotId);
      applyPayload(await getBootstrap(data.activePlotId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "天气和土壤刷新失败");
    } finally {
      setRefreshingContext(false);
    }
  };

  if (initialLoading) {
    return <AppSkeleton />;
  }

  if (emptyWorkspace) {
    return <div className="desktop-app"><DesktopTitleBar /><main className="workspace-onboarding"><h1>建立你的农业工作区</h1><p>先新建基地，再添加地块。已有档案可从下方恢复。</p><FarmManager onChanged={refreshManagedWorkspace} /></main></div>;
  }

  if (fatalError || !data) {
    return (
      <div className="desktop-app">
        <DesktopTitleBar />
        <div className="fatal-state desktop-fatal">
          <div className="fatal-mark"><AlertTriangle size={24} /></div>
          <h1>农业助手暂时无法启动</h1>
          <p>{fatalError || "本地服务没有返回初始化数据。"}</p>
          <button className="primary-button compact" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={15} />
            重新启动
          </button>
        </div>
      </div>
    );
  }

  const allPlots = data.farms.flatMap((farm) =>
    farm.plots.map((plot) => ({ plot, farm }))
  );
  const active = allPlots.find((entry) => entry.plot.id === data.activePlotId);
  if (!active) {
    return (
      <div className="desktop-app">
        <DesktopTitleBar />
        <div className="fatal-state desktop-fatal">
          <h1>地块数据不完整</h1>
        </div>
      </div>
    );
  }

  const { plot, farm } = active;
  const activeRecommendation =
    data.recommendations.find((recommendation) => recommendation.id === data.activePlan?.recommendationId) ??
    (data.activePlan ? data.activePlanRecommendation ?? turns.flatMap(t=>t.recommendations ?? []).find(r=>r.id===data.activePlan?.recommendationId) ?? null : data.recommendations[0] ?? null);
  const conversations = savedChats;

  return (
    <div className="desktop-app">
      <DesktopTitleBar />
      <div className={`desktop-frame ${traceOpen ? "trace-open" : ""}`}>
        <AssistantSidebar
          account={data.account}
          disabled={running}
          onWorkspaceChanged={refreshManagedWorkspace}
          farms={data.farms}
          activePlotId={data.activePlotId}
          model={data.model}
          plan={data.activePlan}
          conversations={conversations}
          activeConversationId={chatId}
          mobileOpen={sidebarOpen}
          onNewChat={startNewChat}
          onSelectConversation={(id) => void selectConversation(id)}
          onSelectPlot={(plotId) => void handleSelectPlot(plotId)}
          onEditFarm={openFarmEditor}
          onOpenBusiness={openBusiness}
          onClose={() => setSidebarOpen(false)}
        />

        <PlanApprovalContext.Provider value={{pendingId:pendingPlan,busy:creatingPlan,error:actionError,cancel:()=>setPendingPlan(null),approve:async()=>{if(!pendingPlan)return false;const saved=await handleChoosePlan(pendingPlan);if(saved)setPendingPlan(null);return Boolean(saved);}}}>
        <AssistantView
          data={data}
          plot={plot}
          farm={farm}
          turns={turns}
          running={running}
          creatingPlan={creatingPlan}
          refreshing={refreshingContext}
          traceOpen={traceOpen}
          focusTurnId={focusTurnId}
          focusSignal={focusSignal}
          onSend={handleSend}
          onPestBusy={setRunning}
          onPestOutput={handlePestOutput}
          onChoosePlan={(recommendationId) => {
            const candidate = [...data.recommendations, ...turns.flatMap(turn => turn.recommendations ?? [])].find(item => item.id === recommendationId);
            if (!candidate || candidate.plotId !== data.activePlotId) {
              setActionError("未找到当前地块的候选方案，请重新比较后再采用。"); return;
            }
            setActionError(""); setPendingPlan(recommendationId);
          }}
          onOpenTrace={openTrace}
          onOpenBusiness={openBusiness}
          onRefresh={() => void handleRefreshContext()}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        </PlanApprovalContext.Provider>

        <div
          className={`assistant-trace-scrim ${traceOpen ? "is-visible" : ""}`}
          onClick={() => setTraceOpen(false)}
        />
        <ExpertPanel
          historical={traceHistorical}
          events={events}
          running={running}
          runId={runId}
          plotName={plot.name}
          mobileOpen={traceOpen}
          onClose={() => setTraceOpen(false)}
          onFocusComposer={() => {
            setFocusSignal((value) => value + 1);
            setTraceOpen(false);
          }}
        />

        {businessView && (
          <BusinessDrawer
            view={businessView}
            title={businessTitles[businessView]}
            onClose={() => { setBusinessView(null); setFarmEditRequest(null); }}
          >
            {businessView === "plan" && data.activePlan && (
              <PlanView
                plan={data.activePlan}
                recommendation={activeRecommendation}
                plot={plot}
                farm={farm}
                onGoDecision={() => {
                  setBusinessView(null);
                  setFocusSignal((value) => value + 1);
                }}
                onGoRecords={() => setBusinessView("records")}
              />
            )}
            {businessView === "plan" && !data.activePlan && (
              <div className="drawer-empty">
                <Sprout size={25} />
                <h2>还没有种植方案</h2>
                <p>在对话里比较本季作物并采用一套方案后，执行日程会出现在这里。</p>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={() => {
                    setBusinessView(null);
                    setFocusSignal((value) => value + 1);
                  }}
                >
                  回到对话
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            {businessView === "records" && (
              <RecordsView
                plan={data.activePlan}
                operations={data.operations}
                onChanged={async () => {
                  applyPayload(await getBootstrap(data.activePlotId));
                }}
                onGoPlan={() => setBusinessView("plan")}
              />
            )}
            {businessView === "results" && (
              <ResultsView
                plan={data.activePlan}
                recommendation={activeRecommendation}
                plot={plot}
                outcomes={data.outcomes}
                feedback={data.feedback}
                onChanged={async () => {
                  applyPayload(await getBootstrap(data.activePlotId));
                }}
                onGoRecords={() => setBusinessView("records")}
              />
            )}
            {businessView === "farms" && (
              <FarmsView
                disabled={running}
                account={data.account}
                farms={data.farms}
                activePlotId={data.activePlotId}
                context={data.plotContext}
                plot={plot}
                farm={farm}
                editFarmId={farmEditRequest?.farmId}
                editFarmToken={farmEditRequest?.token}
                onEditFarmOpened={() => setFarmEditRequest(null)}
                onSelectPlot={(plotId) => {
                  void handleSelectPlot(plotId);
                  setBusinessView(null);
                }}
                onChanged={refreshManagedWorkspace}
              />
            )}
            {businessView === "evaluation" && (
              <EvaluationView
                evaluations={data.evaluations}
                skills={data.skills}
                model={data.model}
              />
            )}
            {businessView === "capabilities" && (
              <CapabilitiesView
                account={data.account}
                farms={data.farms}
                activePlotId={data.activePlotId}
                activeFarmId={farm.id}
              />
            )}
          </BusinessDrawer>
        )}

        {actionError && (
          <div className="app-toast" role="alert">
            <AlertTriangle size={17} />
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError("")}>知道了</button>
          </div>
        )}
      </div>
    </div>
  );
}

function BusinessDrawer({
  view,
  title,
  onClose,
  children
}: {
  view: BusinessView;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="business-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="business-drawer"
        data-business-view={view}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="business-drawer-header">
          <div>
            <span>耕策 · 业务详情</span>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={`关闭${title}`}>
            <X size={17} />
          </button>
        </header>
        <div className="business-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="desktop-app desktop-skeleton">
      <div className="desktop-titlebar skeleton-titlebar">
        <div className="skeleton-block titlebar-brand-skeleton" />
      </div>
      <div className="desktop-frame trace-open">
        <aside className="assistant-sidebar skeleton-sidebar">
          <div className="skeleton-block wide" />
          {Array.from({ length: 7 }, (_, index) => <div className="skeleton-block" key={index} />)}
        </aside>
        <main className="assistant-main skeleton-main">
          <div className="skeleton-topbar" />
          <div className="skeleton-center">
            <div className="skeleton-mark" />
            <div className="skeleton-block title" />
            <div className="skeleton-block wide" />
            <div className="skeleton-composer" />
          </div>
        </main>
        <aside className="dark-skeleton skeleton-trace" />
      </div>
    </div>
  );
}
