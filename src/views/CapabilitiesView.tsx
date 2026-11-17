import {
  AlertCircle,
  Blocks,
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  FileText,
  LoaderCircle,
  PencilLine,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  addKnowledgeDocument,
  archiveCapabilitySkill,
  cloneCapabilitySkill,
  createKnowledgeBase,
  createMcpServer,
  createCapabilitySkill,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  deleteMcpServer,
  discoverMcpServer,
  getCapabilities,
  importCapabilitySkill,
  invokeMcpTool,
  publishCapabilitySkill,
  searchKnowledgeBase,
  setCapabilityBinding,
  setMcpToolEnabled,
  setMcpToolExecutionMode,
  testCapabilitySkill,
  updateCapabilitySkill
} from "../lib/api";
import type {
  Account,
  CapabilitiesPayload,
  CapabilityBinding,
  CapabilitySkill,
  Farm,
  KnowledgeBaseSummary,
  MCPServerSummary,
  MCPToolDefinition,
  Plot
} from "../types";
import "../capabilities.css";

type CapabilityTab = "mcp" | "skills" | "knowledge";

type SkillDraft = {
  name: string;
  description: string;
  appliesTo: string;
  instruction: string;
  tools: string;
};

interface Props {
  account: Account;
  farms: Array<Farm & { plots: Plot[] }>;
  activePlotId: string;
  activeFarmId: string;
}

const tabItems: Array<{ id: CapabilityTab; label: string; icon: typeof PlugZap }> = [
  { id: "mcp", label: "MCP 服务", icon: PlugZap },
  { id: "skills", label: "技能库", icon: Blocks },
  { id: "knowledge", label: "知识库", icon: Database }
];

export function CapabilitiesView({ account, farms, activePlotId, activeFarmId }: Props) {
  const [payload, setPayload] = useState<CapabilitiesPayload | null>(null);
  const [tab, setTab] = useState<CapabilityTab>("mcp");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setPayload(await getCapabilities({
        accountId: account.id,
        farmId: activeFarmId,
        plotId: activePlotId
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "能力中心加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account.id, activeFarmId, activePlotId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await refresh(true);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      return false;
    }
  };

  const stats = useMemo(() => {
    const personalSkills = payload?.skills.filter(skill => skill.kind === "personal").length ?? 0;
    const connectedMcp = payload?.mcpServers.filter(server => server.status === "connected").length ?? 0;
    const documents = payload?.knowledgeBases.reduce((sum, base) => sum + base.documents.length, 0) ?? 0;
    return { personalSkills, connectedMcp, documents };
  }, [payload]);

  return (
    <section className="capability-view" data-capability-view>
      <header className="capability-overview">
        <div className="capability-overview-copy">
          <span className="capability-runtime">
            <Workflow size={14} />
            {payload?.runtime.engine ?? "Mastra Workflow"}
            <small>{payload?.runtime.version ?? "1.0.0"}</small>
          </span>
          <h3>能力随每次任务冻结为快照</h3>
          <p>作用域从账号逐级覆盖到基地和地块；历史运行只引用已冻结的配置与证据。</p>
        </div>
        <button
          type="button"
          className="capability-icon-button"
          onClick={() => void refresh(true)}
          disabled={refreshing}
          aria-label="刷新能力中心"
        >
          <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} />
        </button>
      </header>

      <div className="capability-tabs" role="tablist" aria-label="能力类型">
        {tabItems.map(item => {
          const Icon = item.icon;
          const count = item.id === "mcp"
            ? stats.connectedMcp
            : item.id === "skills"
              ? stats.personalSkills
              : stats.documents;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              <Icon size={15} />
              <span>{item.label}</span>
              {count > 0 && <small>{count}</small>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="capability-message is-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="关闭错误提示"><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div className="capability-message is-success" role="status">
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <CapabilitySkeleton />
      ) : payload ? (
        <>
          {tab === "mcp" && (
            <McpPanel
              account={account}
              farms={farms}
              activePlotId={activePlotId}
              servers={payload.mcpServers}
              calls={payload.recentCalls}
              runAction={run}
            />
          )}
          {tab === "skills" && (
            <SkillsPanel
              account={account}
              farms={farms}
              activePlotId={activePlotId}
              skills={payload.skills}
              runAction={run}
            />
          )}
          {tab === "knowledge" && (
            <KnowledgePanel
              account={account}
              farms={farms}
              activePlotId={activePlotId}
              bases={payload.knowledgeBases}
              runAction={run}
            />
          )}
        </>
      ) : (
        <div className="capability-empty">
          <AlertCircle size={22} />
          <h3>能力数据未加载</h3>
          <button type="button" onClick={() => void refresh()}>重新加载</button>
        </div>
      )}
    </section>
  );
}

function McpPanel({
  account,
  farms,
  activePlotId,
  servers,
  calls,
  runAction
}: {
  account: Account;
  farms: Props["farms"];
  activePlotId: string;
  servers: MCPServerSummary[];
  calls: CapabilitiesPayload["recentCalls"];
  runAction: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    transport: "http" as "http" | "stdio",
    endpoint: "",
    headers: "",
    command: "npx",
    args: "",
    env: ""
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolResult, setToolResult] = useState<Record<string, string>>({});

  const create = async () => {
    if (!draft.name.trim()) return;
    let headers: Record<string, string> | undefined;
    let env: Record<string, string> | undefined;
    try {
      headers = draft.headers.trim() ? JSON.parse(draft.headers) as Record<string, string> : undefined;
      env = draft.env.trim() ? JSON.parse(draft.env) as Record<string, string> : undefined;
    } catch {
      setToolResult(current => ({ ...current, create: "认证头或环境变量不是有效 JSON。" }));
      return;
    }
    const ok = await runAction(() => createMcpServer(account.id, {
      name: draft.name,
      transport: draft.transport,
      endpoint: draft.transport === "http" ? draft.endpoint : undefined,
      headers,
      command: draft.transport === "stdio" ? draft.command : undefined,
      args: draft.transport === "stdio" ? splitArgs(draft.args) : undefined,
      env
    }), "MCP 服务已添加，完成发现后再启用。");
    if (ok) {
      setAdding(false);
      setDraft({ name: "", transport: "http", endpoint: "", headers: "", command: "npx", args: "", env: "" });
      setToolResult(current => ({ ...current, create: "" }));
    }
  };

  return (
    <div className="capability-panel">
      <div className="capability-panel-heading">
        <div>
          <h3>MCP 服务</h3>
          <p>工具按服务授权；只读工具可设为自动调用、调用前确认或仅手动，写操作始终仅手动。</p>
        </div>
        <button type="button" className="capability-primary-button" onClick={() => setAdding(value => !value)}>
          {adding ? <X size={15} /> : <Plus size={15} />}
          {adding ? "取消" : "添加服务"}
        </button>
      </div>

      {adding && (
        <div className="capability-editor mcp-editor">
          <div className="capability-field-grid">
            <label>
              <span>名称</span>
              <input
                value={draft.name}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                placeholder="例如：合作社农资目录"
              />
            </label>
            <label>
              <span>传输方式</span>
              <select
                value={draft.transport}
                onChange={event => setDraft(current => ({ ...current, transport: event.target.value as "http" | "stdio" }))}
              >
                <option value="http">HTTP / HTTPS</option>
                <option value="stdio">stdio（本地命令）</option>
              </select>
            </label>
          </div>
          {draft.transport === "http" ? (
            <>
              <label>
                <span>MCP 地址</span>
                <input
                  value={draft.endpoint}
                  onChange={event => setDraft(current => ({ ...current, endpoint: event.target.value }))}
                  placeholder="https://example.com/mcp"
                />
              </label>
              <label>
                <span>认证头 JSON</span>
                <textarea
                  value={draft.headers}
                  onChange={event => setDraft(current => ({ ...current, headers: event.target.value }))}
                  placeholder={'{"Authorization":"Bearer …"}'}
                  rows={2}
                />
              </label>
            </>
          ) : (
            <>
              <div className="capability-field-grid">
                <label>
                  <span>启动命令</span>
                  <select value={draft.command} onChange={event => setDraft(current => ({ ...current, command: event.target.value }))}>
                    <option value="npx">npx</option>
                    <option value="node">node</option>
                    <option value="pnpm">pnpm</option>
                    <option value="python">python</option>
                    <option value="python3">python3</option>
                    <option value="uvx">uvx</option>
                  </select>
                </label>
                <label>
                  <span>参数</span>
                  <input
                    value={draft.args}
                    onChange={event => setDraft(current => ({ ...current, args: event.target.value }))}
                    placeholder="-y @scope/server"
                  />
                </label>
              </div>
              <label>
                <span>环境变量 JSON</span>
                <textarea
                  value={draft.env}
                  onChange={event => setDraft(current => ({ ...current, env: event.target.value }))}
                  placeholder={'{"API_KEY":"…"}'}
                  rows={2}
                />
              </label>
            </>
          )}
          {toolResult.create && <p className="capability-inline-error">{toolResult.create}</p>}
          <div className="capability-editor-actions">
            <button type="button" className="capability-primary-button" onClick={() => void create()}>
              <Plus size={15} />
              保存服务
            </button>
          </div>
        </div>
      )}

      <div className="capability-list">
        {servers.map(server => (
          <article className="capability-list-item mcp-item" key={server.id}>
            <div className="capability-item-main">
              <div className="capability-item-title">
                <span className={`capability-status-dot is-${server.status}`} />
                <div>
                  <h4>{server.id.startsWith("mcp-demo-") ? "内置mcp" : server.name}</h4>
                  {!server.id.startsWith("mcp-demo-") && (
                    <p>
                      {server.transport === "http" ? server.endpoint : `${server.command} ${server.args.join(" ")}`}
                      <span> · {server.tools.length} 个工具</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="capability-inline-actions">
                <button
                  type="button"
                  onClick={() => void runAction(
                    () => discoverMcpServer(server.id, account.id),
                    `已重新发现 ${server.name} 的工具。`
                  )}
                >
                  <RefreshCw size={14} />
                  发现工具
                </button>
                {confirmDelete === server.id ? (
                  <span className="capability-confirm">
                    删除？
                    <button type="button" onClick={() => {
                      void runAction(() => deleteMcpServer(server.id, account.id), "MCP 服务已删除。");
                      setConfirmDelete(null);
                    }}>确认</button>
                    <button type="button" onClick={() => setConfirmDelete(null)}>取消</button>
                  </span>
                ) : (
                  <button type="button" className="is-danger" onClick={() => setConfirmDelete(server.id)}>
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
              </div>
            </div>

            {server.statusMessage && (
              <p className={`capability-status-copy is-${server.status}`}>{server.statusMessage}</p>
            )}
            <ScopeControl
              account={account}
              farms={farms}
              activePlotId={activePlotId}
              capabilityType="mcp"
              capabilityId={server.id}
              bindings={server.bindings}
              defaultEnabled={false}
              onAction={runAction}
            />

            {server.tools.length > 0 && (
              <details className="capability-details" open={server.status === "connected" && servers.length === 1}>
                <summary>
                  <span>工具与调用审计</span>
                  <ChevronDown size={15} />
                </summary>
                <div className="mcp-tools">
                  {server.tools.map(tool => (
                    <div className="mcp-tool" key={tool.id}>
                      <div className="mcp-tool-heading">
                        <label>
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            onChange={event => void runAction(
                              () => setMcpToolEnabled(server.id, tool.id, account.id, event.target.checked),
                              event.target.checked ? `${tool.title} 已启用。` : `${tool.title} 已停用。`
                            )}
                          />
                          <span>
                            <strong>{tool.title}</strong>
                            <small>{tool.name}</small>
                          </span>
                        </label>
                        <div className="mcp-tool-badges">
                          <select
                            className="mcp-tool-mode"
                            value={tool.executionMode}
                            disabled={!isReadonlyMcpTool(tool)}
                            aria-label={`${tool.title} 执行方式`}
                            onChange={event => void runAction(
                              () => setMcpToolExecutionMode(
                                server.id,
                                tool.id,
                                account.id,
                                event.target.value as MCPToolDefinition["executionMode"]
                              ),
                              event.target.value === "confirm"
                                ? `${tool.title} 将在调用前请求确认。`
                                : event.target.value === "manual"
                                  ? `${tool.title} 已改为仅手动。`
                                  : `${tool.title} 已改为自动调用。`
                            )}
                          >
                            {isReadonlyMcpTool(tool) ? (
                              <>
                                <option value="auto">只读可自动</option>
                                <option value="confirm">调用前确认</option>
                                <option value="manual">仅手动</option>
                              </>
                            ) : <option value="manual">仅手动</option>}
                          </select>
                          <span className={tool.enabled ? "capability-chip is-on" : "capability-chip"}>
                            {tool.enabled ? "已启用" : "已停用"}
                          </span>
                        </div>
                      </div>
                      {tool.description && <p>{tool.description}</p>}
                      <details className="mcp-tool-test">
                        <summary>测试调用</summary>
                        <textarea
                          rows={3}
                          value={toolArgs[tool.id] ?? "{}"}
                          onChange={event => setToolArgs(current => ({ ...current, [tool.id]: event.target.value }))}
                          aria-label={`${tool.title} JSON 参数`}
                        />
                        <div>
                          <button
                            type="button"
                            disabled={!tool.enabled}
                            onClick={async () => {
                              let args: Record<string, unknown>;
                              try {
                                args = JSON.parse(toolArgs[tool.id] ?? "{}") as Record<string, unknown>;
                              } catch {
                                setToolResult(current => ({ ...current, [tool.id]: "参数不是有效 JSON。" }));
                                return;
                              }
                              await runAction(async () => {
                                const result = await invokeMcpTool(server.id, tool.id, account.id, args);
                                setToolResult(current => ({
                                  ...current,
                                  [tool.id]: JSON.stringify(result.result, null, 2)
                                }));
                                return result;
                              }, "工具调用完成，审计记录已更新。");
                            }}
                          >
                            <Play size={14} />
                            执行
                          </button>
                        </div>
                        {toolResult[tool.id] && <pre>{toolResult[tool.id]}</pre>}
                      </details>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
        {!servers.length && (
          <CapabilityEmpty
            icon={PlugZap}
            title="还没有 MCP 服务"
            detail="添加远程 MCP 地址或本地 stdio 服务，发现工具后按范围授权。"
          />
        )}
      </div>

      {calls.length > 0 && (
        <details className="capability-details capability-audit">
          <summary>
            <span>最近调用</span>
            <ChevronDown size={15} />
          </summary>
          <div className="capability-audit-list">
            {calls.slice(0, 12).map(call => {
              const server = servers.find(item => item.id === call.serverId);
              return (
                <div key={call.id}>
                  <span className={`capability-status-dot is-${call.status}`} />
                  <strong>{server?.name ?? "已删除服务"} / {call.toolName}</strong>
                  <small>{formatDate(call.createdAt)} · {call.latencyMs} ms</small>
                  <p>{call.status === "success" ? call.outputSummary : call.outputSummary || call.inputSummary}</p>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function SkillsPanel({
  account,
  farms,
  activePlotId,
  skills,
  runAction
}: {
  account: Account;
  farms: Props["farms"];
  activePlotId: string;
  skills: CapabilitySkill[];
  runAction: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft>(() => emptySkillDraft());
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<SkillDraft>(() => emptySkillDraft());
  const [savingNew, setSavingNew] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [testQuestion, setTestQuestion] = useState("湖北水稻田未来一周是否需要追肥？");
  const [testResult, setTestResult] = useState<Record<string, {
    passed: boolean;
    score: number;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
  }>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const beginEdit = (skill: CapabilitySkill) => {
    const version = skill.draftVersion ?? skill.currentVersion;
    setDraft({
      name: skill.name,
      description: skill.description,
      appliesTo: skill.appliesTo,
      instruction: version?.instruction ?? "",
      tools: skill.tools.join(", ")
    });
    setEditingId(skill.id);
  };

  const create = async () => {
    if (!skillDraftReady(newDraft)) return;
    setSavingNew(true);
    let created: CapabilitySkill | undefined;
    const ok = await runAction(async () => {
      created = await createCapabilitySkill(account.id, skillInputFromDraft(newDraft));
      return created;
    }, "个人技能已保存为草稿，检查后即可发布。");
    setSavingNew(false);
    if (ok && created) {
      setCreating(false);
      setNewDraft(emptySkillDraft());
      beginEdit(created);
    }
  };

  const importFile = async (file: File) => {
    setImportError("");
    if (file.size > 300_000) {
      setImportError("导入文件过大，请控制在 100,000 个字符以内。");
      return;
    }
    const content = await file.text();
    if (Array.from(content).length > 100_000) {
      setImportError("导入文件不能超过 100,000 个字符。");
      return;
    }
    setImporting(true);
    let imported: CapabilitySkill | undefined;
    const ok = await runAction(async () => {
      const result = await importCapabilitySkill(account.id, file.name, content, file.type);
      imported = result.skill;
      return result;
    }, `${file.name} 已导入为个人技能草稿。`);
    setImporting(false);
    if (ok && imported) {
      setCreating(false);
      beginEdit(imported);
    }
  };

  return (
    <div className="capability-panel">
      <div className="capability-panel-heading">
        <div>
          <h3>技能库</h3>
          <p>系统技能只读；个人技能可从零创建、导入文件、编辑版本并绑定到账号、基地或地块。</p>
        </div>
        <div className="capability-heading-actions">
          <span className="capability-count">{skills.filter(skill => skill.kind === "personal").length} 个个人技能</span>
          <button
            type="button"
            className="capability-secondary-button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? <LoaderCircle size={15} className="is-spinning" /> : <Upload size={15} />}
            {importing ? "导入中" : "导入技能"}
          </button>
          <button
            type="button"
            className="capability-primary-button"
            onClick={() => {
              setCreating(value => !value);
              setEditingId(null);
              setImportError("");
            }}
          >
            {creating ? <X size={15} /> : <Plus size={15} />}
            {creating ? "取消" : "新建技能"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.md,.markdown,application/json,text/markdown,text/plain"
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>

      {importError && <p className="capability-inline-error" role="alert">{importError}</p>}

      {creating && (
        <div className="capability-editor skill-editor capability-create-editor">
          <div className="capability-editor-heading">
            <div>
              <strong>新建个人技能</strong>
              <p>先保存草稿，再运行检查并发布版本。</p>
            </div>
          </div>
          <SkillEditorFields draft={newDraft} onChange={setNewDraft} idPrefix="new-skill" />
          <div className="capability-editor-actions">
            <button
              type="button"
              className="capability-primary-button"
              disabled={!skillDraftReady(newDraft) || savingNew}
              onClick={() => void create()}
            >
              {savingNew ? <LoaderCircle size={15} className="is-spinning" /> : <Save size={15} />}
              {savingNew ? "保存中" : "保存草稿"}
            </button>
          </div>
        </div>
      )}

      <div className="capability-list">
        {skills.map(skill => {
          const version = skill.draftVersion ?? skill.currentVersion;
          const editing = editingId === skill.id;
          return (
            <article className="capability-list-item skill-item" key={skill.id}>
              <div className="capability-item-main">
                <div className="capability-item-title">
                  <span className={`capability-skill-mark ${skill.kind === "system" ? "is-system" : "is-personal"}`}>
                    {skill.kind === "system" ? <ShieldCheck size={15} /> : <Blocks size={15} />}
                  </span>
                  <div>
                    <h4>{skill.name}</h4>
                    <p>
                      v{version?.version ?? "未发布"}
                      <span> · {skill.kind === "system" ? "系统内置" : "个人技能"}</span>
                      {skill.draftVersion && <span className="capability-draft-badge">草稿待发布</span>}
                    </p>
                  </div>
                </div>
                <div className="capability-inline-actions">
                  {skill.kind === "system" ? (
                    <button
                      type="button"
                      onClick={() => void runAction(
                        () => cloneCapabilitySkill(skill.id, account.id),
                        "已复制为个人技能，可以修改并发布。"
                      )}
                    >
                      <Copy size={14} />
                      复制
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => editing ? setEditingId(null) : beginEdit(skill)}>
                        {editing ? <X size={14} /> : <PencilLine size={14} />}
                        {editing ? "收起" : "编辑"}
                      </button>
                      {skill.draftVersion && (
                        <button
                          type="button"
                          onClick={() => void runAction(
                            () => publishCapabilitySkill(skill.id, account.id),
                            `${skill.name} 已发布新版本。`
                          )}
                        >
                          <Upload size={14} />
                          发布
                        </button>
                      )}
                      {confirmDelete === skill.id ? (
                        <span className="capability-confirm">
                          停用？
                          <button type="button" onClick={() => {
                            void runAction(() => archiveCapabilitySkill(skill.id, account.id), "个人技能已停用。");
                            setConfirmDelete(null);
                          }}>确认</button>
                          <button type="button" onClick={() => setConfirmDelete(null)}>取消</button>
                        </span>
                      ) : (
                        <button type="button" className="is-danger" onClick={() => setConfirmDelete(skill.id)}>
                          <Trash2 size={14} />
                          停用
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <p className="capability-item-description">{skill.description}</p>
              {!editing && version?.instruction && (
                <details className="capability-details">
                  <summary>
                    <span>技能指令</span>
                    <ChevronDown size={15} />
                  </summary>
                  <pre className="capability-instruction">{version.instruction}</pre>
                </details>
              )}

              {editing && (
                <div className="capability-editor skill-editor">
                  <SkillEditorFields draft={draft} onChange={setDraft} idPrefix={`skill-${skill.id}`} />
                  <div className="capability-editor-actions">
                    <button
                      type="button"
                      className="capability-primary-button"
                      disabled={!skillDraftReady(draft)}
                      onClick={() => void runAction(
                        () => updateCapabilitySkill(skill.id, account.id, skillInputFromDraft(draft)),
                        "技能草稿已保存。"
                      )}
                    >
                      <Save size={15} />
                      保存草稿
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const result = await testCapabilitySkill(skill.id, account.id, testQuestion);
                          setTestResult(current => ({ ...current, [skill.id]: result }));
                        } catch (reason) {
                          setTestResult(current => ({
                            ...current,
                            [skill.id]: {
                              passed: false,
                              score: 0,
                              checks: [{ name: "测试失败", passed: false, detail: reason instanceof Error ? reason.message : "未知错误" }]
                            }
                          }));
                        }
                      }}
                    >
                      <Play size={15} />
                      运行检查
                    </button>
                  </div>
                  {testResult[skill.id] && (
                    <div className="capability-test-result">
                      <strong>{testResult[skill.id].score} 分 · {testResult[skill.id].passed ? "通过" : "需修正"}</strong>
                      {testResult[skill.id].checks.map(check => (
                        <span key={check.name} className={check.passed ? "is-passed" : "is-failed"}>
                          {check.passed ? <Check size={13} /> : <AlertCircle size={13} />}
                          {check.name}
                          <small>{check.detail}</small>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {skill.kind === "personal" && skill.currentVersion && !skill.draftVersion && (
                <ScopeControl
                  account={account}
                  farms={farms}
                  activePlotId={activePlotId}
                  capabilityType="skill"
                  capabilityId={skill.id}
                  bindings={skill.bindings}
                  defaultEnabled
                  onAction={runAction}
                />
              )}
            </article>
          );
        })}
      </div>
      <div className="capability-test-question">
        <label>
          <span>技能检查问题</span>
          <input value={testQuestion} onChange={event => setTestQuestion(event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function SkillEditorFields({
  draft,
  onChange,
  idPrefix
}: {
  draft: SkillDraft;
  onChange: Dispatch<SetStateAction<SkillDraft>>;
  idPrefix: string;
}) {
  return (
    <>
      <div className="capability-field-grid">
        <label htmlFor={`${idPrefix}-name`}>
          <span>技能名称</span>
          <input
            id={`${idPrefix}-name`}
            maxLength={80}
            value={draft.name}
            onChange={event => onChange(current => ({ ...current, name: event.target.value }))}
            placeholder="例如：水稻追肥检查"
          />
        </label>
        <label htmlFor={`${idPrefix}-applies`}>
          <span>适用问题</span>
          <input
            id={`${idPrefix}-applies`}
            maxLength={500}
            value={draft.appliesTo}
            onChange={event => onChange(current => ({ ...current, appliesTo: event.target.value }))}
            placeholder="例如：水稻追肥前核对天气与操作记录"
          />
        </label>
      </div>
      <label htmlFor={`${idPrefix}-description`}>
        <span>说明</span>
        <textarea
          id={`${idPrefix}-description`}
          rows={2}
          maxLength={500}
          value={draft.description}
          onChange={event => onChange(current => ({ ...current, description: event.target.value }))}
          placeholder="说明这个技能解决什么问题，以及它不覆盖什么。"
        />
      </label>
      <label htmlFor={`${idPrefix}-tools`}>
        <span>关联工具（可选）</span>
        <input
          id={`${idPrefix}-tools`}
          value={draft.tools}
          onChange={event => onChange(current => ({ ...current, tools: event.target.value }))}
          placeholder="weather.get_forecast, soil.get_properties"
        />
      </label>
      <label htmlFor={`${idPrefix}-instruction`}>
        <span>技能指令</span>
        <textarea
          id={`${idPrefix}-instruction`}
          className="capability-code-input"
          rows={9}
          maxLength={20_000}
          value={draft.instruction}
          onChange={event => onChange(current => ({ ...current, instruction: event.target.value }))}
          placeholder="写清证据要求、执行步骤、缺失数据的处理方式和禁止事项。"
        />
      </label>
    </>
  );
}

function emptySkillDraft(): SkillDraft {
  return {
    name: "",
    description: "",
    appliesTo: "",
    instruction: "",
    tools: ""
  };
}

function skillDraftReady(draft: SkillDraft): boolean {
  return Boolean(
    draft.name.trim() &&
    draft.description.trim() &&
    draft.appliesTo.trim() &&
    draft.instruction.trim()
  );
}

function skillInputFromDraft(draft: SkillDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    appliesTo: draft.appliesTo.trim(),
    instruction: draft.instruction.trim(),
    tools: draft.tools
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  };
}

function KnowledgePanel({
  account,
  farms,
  activePlotId,
  bases,
  runAction
}: {
  account: Account;
  farms: Props["farms"];
  activePlotId: string;
  bases: KnowledgeBaseSummary[];
  runAction: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    scopeType: "account" as "account" | "farm" | "plot",
    scopeId: account.id
  });
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [searchState, setSearchState] = useState<{
    baseId: string;
    query: string;
    loading: boolean;
    mode?: string;
    matches: Array<{ id: string; documentTitle: string; chunkIndex: number; content: string }>;
  }>({ baseId: "", query: "", loading: false, matches: [] });
  const [confirmBase, setConfirmBase] = useState<string | null>(null);
  const [confirmDocument, setConfirmDocument] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const scopeChoices = useMemo(() => buildScopeChoices(account, farms), [account, farms]);

  const create = async () => {
    if (!draft.name.trim()) return;
    const ok = await runAction(() => createKnowledgeBase(account.id, draft), "知识库已创建。");
    if (ok) {
      setAdding(false);
      setDraft({ name: "", description: "", scopeType: "account", scopeId: account.id });
    }
  };

  const upload = async (base: KnowledgeBaseSummary, file: File) => {
    if (file.size > 3_000_000) {
      setUploadError("单个资料不能超过 3 MB。请拆分资料后再导入。");
      return;
    }
    setUploadError("");
    setUploadingId(base.id);
    try {
      const content = await file.text();
      await runAction(() => addKnowledgeDocument(base.id, account.id, {
        title: file.name.replace(/\.[^.]+$/, ""),
        sourceName: file.name,
        mimeType: file.type || mimeFromName(file.name),
        content
      }), `${file.name} 已分块并加入本地索引。`);
    } finally {
      setUploadingId(null);
      const input = fileInputs.current[base.id];
      if (input) input.value = "";
    }
  };

  return (
    <div className="capability-panel">
      <div className="capability-panel-heading">
        <div>
          <h3>知识库</h3>
          <p>支持文本、Markdown、JSON 和 CSV；内容在本机使用 Mastra 分块并写入本地索引。</p>
        </div>
        <button type="button" className="capability-primary-button" onClick={() => setAdding(value => !value)}>
          {adding ? <X size={15} /> : <Plus size={15} />}
          {adding ? "取消" : "新建知识库"}
        </button>
      </div>
      {uploadError && (
        <div className="capability-message is-error" role="alert">
          <AlertCircle size={16} />
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError("")} aria-label="关闭资料错误提示"><X size={14} /></button>
        </div>
      )}

      {adding && (
        <div className="capability-editor">
          <div className="capability-field-grid">
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：襄州水稻本地经验" />
            </label>
            <label>
              <span>作用域</span>
              <select
                value={`${draft.scopeType}:${draft.scopeId}`}
                onChange={event => {
                  const [scopeType, scopeId] = event.target.value.split(":");
                  setDraft(current => ({
                    ...current,
                    scopeType: scopeType as "account" | "farm" | "plot",
                    scopeId
                  }));
                }}
              >
                {scopeChoices.map(choice => (
                  <option value={`${choice.type}:${choice.id}`} key={`${choice.type}:${choice.id}`}>{choice.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>说明</span>
            <textarea rows={2} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="记录资料来源、适用范围和更新时间" />
          </label>
          <div className="capability-editor-actions">
            <button type="button" className="capability-primary-button" onClick={() => void create()}>
              <Plus size={15} />
              创建
            </button>
          </div>
        </div>
      )}

      <div className="capability-list">
        {bases.map(base => {
          const searching = searchState.baseId === base.id;
          return (
            <article className="capability-list-item knowledge-item" key={base.id}>
              <div className="capability-item-main">
                <div className="capability-item-title">
                  <span className="capability-skill-mark is-knowledge"><Database size={15} /></span>
                  <div>
                    <h4>{base.name}</h4>
                    <p>{scopeLabel(base.scopeType, base.scopeId, account, farms)}<span> · {base.documents.length} 份资料</span></p>
                  </div>
                </div>
                <div className="capability-inline-actions">
                  <button type="button" onClick={() => fileInputs.current[base.id]?.click()} disabled={uploadingId === base.id}>
                    {uploadingId === base.id ? <LoaderCircle size={14} className="is-spinning" /> : <Upload size={14} />}
                    导入资料
                  </button>
                  <input
                    ref={element => { fileInputs.current[base.id] = element; }}
                    type="file"
                    accept=".txt,.md,.markdown,.json,.csv,text/plain,text/markdown,application/json,text/csv"
                    hidden
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (file) void upload(base, file);
                    }}
                  />
                  {confirmBase === base.id ? (
                    <span className="capability-confirm">
                      删除？
                      <button type="button" onClick={() => {
                        void runAction(() => deleteKnowledgeBase(base.id, account.id), "知识库已删除。");
                        setConfirmBase(null);
                      }}>确认</button>
                      <button type="button" onClick={() => setConfirmBase(null)}>取消</button>
                    </span>
                  ) : (
                    <button type="button" className="is-danger" onClick={() => setConfirmBase(base.id)}>
                      <Trash2 size={14} />
                      删除
                    </button>
                  )}
                </div>
              </div>
              {base.description && <p className="capability-item-description">{base.description}</p>}
              <ScopeControl
                account={account}
                farms={farms}
                activePlotId={activePlotId}
                capabilityType="knowledge"
                capabilityId={base.id}
                bindings={base.bindings}
                defaultEnabled
                onAction={runAction}
              />

              <div className="knowledge-documents">
                {base.documents.map(document => (
                  <div key={document.id} className="knowledge-document">
                    <FileText size={15} />
                    <span>
                      <strong>{document.title}</strong>
                      <small>
                        {document.publisher ?? document.sourceName}
                        {document.publishedAt ? ` · 发布于 ${document.publishedAt}` : ""}
                        {` · ${document.chunkCount} 个片段`}
                        {document.status === "error" && ` · ${document.errorMessage ?? "索引失败"}`}
                      </small>
                    </span>
                    {document.sourceUrl && (
                      <a
                        className="knowledge-source-link"
                        href={document.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开${document.title}原文`}
                        title="打开官方原文"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    {confirmDocument === document.id ? (
                      <span className="capability-confirm">
                        删除？
                        <button type="button" onClick={() => {
                          void runAction(() => deleteKnowledgeDocument(document.id, account.id), "资料已删除。");
                          setConfirmDocument(null);
                        }}>确认</button>
                        <button type="button" onClick={() => setConfirmDocument(null)}>取消</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDocument(document.id)} aria-label={`删除${document.title}`}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {!base.documents.length && (
                  <button type="button" className="knowledge-upload-empty" onClick={() => fileInputs.current[base.id]?.click()}>
                    <Upload size={16} />
                    导入第一份本地资料
                  </button>
                )}
              </div>

              <div className="knowledge-search">
                <label>
                  <Search size={14} />
                  <input
                    value={searching ? searchState.query : ""}
                    onChange={event => setSearchState({
                      baseId: base.id,
                      query: event.target.value,
                      loading: false,
                      matches: []
                    })}
                    placeholder="检索这个知识库"
                  />
                </label>
                <button
                  type="button"
                  disabled={!searching || !searchState.query.trim() || searchState.loading}
                  onClick={async () => {
                    if (!searching) return;
                    setSearchState(current => ({ ...current, loading: true }));
                    try {
                      const result = await searchKnowledgeBase(base.id, account.id, searchState.query);
                      setSearchState(current => ({
                        ...current,
                        loading: false,
                        mode: result.mode,
                        matches: result.matches
                      }));
                    } catch (reason) {
                      setSearchState(current => ({
                        ...current,
                        loading: false,
                        mode: reason instanceof Error ? reason.message : "检索失败",
                        matches: []
                      }));
                    }
                  }}
                >
                  {searchState.loading ? <LoaderCircle size={14} className="is-spinning" /> : "检索"}
                </button>
              </div>
              {searching && searchState.mode && (
                <div className="knowledge-search-results">
                  <p>{searchState.matches.length} 个结果 · {searchState.mode}</p>
                  {searchState.matches.slice(0, 4).map(match => (
                    <div key={match.id}>
                      <strong>{match.documentTitle} · 片段 {match.chunkIndex + 1}</strong>
                      <p>{match.content.slice(0, 280)}{match.content.length > 280 ? "…" : ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {!bases.length && (
          <CapabilityEmpty
            icon={Database}
            title="还没有知识库"
            detail="先建立账号、基地或地块级知识库，再导入本地农技资料。"
          />
        )}
      </div>
    </div>
  );
}

function ScopeControl({
  account,
  farms,
  activePlotId,
  capabilityType,
  capabilityId,
  bindings,
  defaultEnabled,
  onAction
}: {
  account: Account;
  farms: Props["farms"];
  activePlotId: string;
  capabilityType: "skill" | "mcp" | "knowledge";
  capabilityId: string;
  bindings: CapabilityBinding[];
  defaultEnabled: boolean;
  onAction: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}) {
  const choices = useMemo(() => buildScopeChoices(account, farms), [account, farms]);
  const initialScope = choices.find(choice => choice.type === "plot" && choice.id === activePlotId)
    ? `plot:${activePlotId}`
    : `account:${account.id}`;
  const [scopeKey, setScopeKey] = useState(initialScope);
  const binding = resolveBindingForScope(bindings, scopeKey, account.id, farms);
  const enabled = binding?.enabled ?? defaultEnabled;
  const [localBusy, setLocalBusy] = useState(false);

  const change = async (nextEnabled: boolean) => {
    const [scopeType, scopeId] = scopeKey.split(":");
    setLocalBusy(true);
    await onAction(
      () => setCapabilityBinding({
        capabilityType,
        capabilityId,
        scopeType: scopeType as "account" | "farm" | "plot",
        scopeId,
        enabled: nextEnabled
      }),
      nextEnabled ? "能力已在所选范围启用。" : "能力已在所选范围停用。"
    );
    setLocalBusy(false);
  };

  return (
    <div className="capability-scope">
      <label>
        <span>作用范围</span>
        <select value={scopeKey} onChange={event => setScopeKey(event.target.value)} disabled={localBusy}>
          {choices.map(choice => (
            <option key={`${choice.type}:${choice.id}`} value={`${choice.type}:${choice.id}`}>{choice.label}</option>
          ))}
        </select>
      </label>
      <label className="capability-switch">
        <input type="checkbox" checked={enabled} disabled={localBusy} onChange={event => void change(event.target.checked)} />
        <span>{localBusy ? "保存中" : enabled ? "已启用" : "已停用"}</span>
      </label>
    </div>
  );
}

function CapabilityEmpty({
  icon: Icon,
  title,
  detail
}: {
  icon: typeof PlugZap;
  title: string;
  detail: string;
}) {
  return (
    <div className="capability-empty">
      <Icon size={22} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function CapabilitySkeleton() {
  return (
    <div className="capability-skeleton" aria-label="正在加载能力中心">
      {[0, 1, 2].map(item => (
        <div key={item}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function buildScopeChoices(account: Account, farms: Props["farms"]) {
  return [
    { type: "account" as const, id: account.id, label: `账号 · ${account.name}` },
    ...farms.map(farm => ({ type: "farm" as const, id: farm.id, label: `基地 · ${farm.name}` })),
    ...farms.flatMap(farm => farm.plots.map(plot => ({
      type: "plot" as const,
      id: plot.id,
      label: `地块 · ${farm.name} / ${plot.name}`
    })))
  ];
}

function resolveBindingForScope(
  bindings: CapabilityBinding[],
  scopeKey: string,
  accountId: string,
  farms: Props["farms"]
): CapabilityBinding | undefined {
  const [scopeType, scopeId] = scopeKey.split(":");
  const keys = [`account:${accountId}`];
  if (scopeType === "farm") {
    keys.push(`farm:${scopeId}`);
  }
  if (scopeType === "plot") {
    const farm = farms.find(item => item.plots.some(plot => plot.id === scopeId));
    if (farm) keys.push(`farm:${farm.id}`);
    keys.push(`plot:${scopeId}`);
  }
  for (const key of keys.reverse()) {
    const binding = bindings.find(item => `${item.scopeType}:${item.scopeId}` === key);
    if (binding) return binding;
  }
  return undefined;
}

function scopeLabel(scopeType: KnowledgeBaseSummary["scopeType"], scopeId: string, account: Account, farms: Props["farms"]): string {
  if (scopeType === "account") return `账号 · ${account.name}`;
  if (scopeType === "farm") {
    const farm = farms.find(item => item.id === scopeId);
    return `基地 · ${farm?.name ?? "已删除基地"}`;
  }
  for (const farm of farms) {
    const plot = farm.plots.find(item => item.id === scopeId);
    if (plot) return `地块 · ${farm.name} / ${plot.name}`;
  }
  return "地块 · 已删除地块";
}

function splitArgs(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(item => item.replace(/^"|"$/g, "")) ?? [];
}

function isReadonlyMcpTool(tool: MCPToolDefinition): boolean {
  return tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true;
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  return "text/plain";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
