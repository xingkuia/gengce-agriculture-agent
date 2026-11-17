import type {
  AgentEvent,
  BootstrapPayload,
  CapabilitiesPayload,
  CapabilityBinding,
  CapabilitySkill,
  KnowledgeBaseSummary,
  KnowledgeDocumentSummary,
  McpApprovalRequestView,
  MCPServerSummary,
  MCPToolDefinition,
  OperationRecord,
  OutcomeRecord,
  PlantingPlan,
  PlotContext,
  RunOverrides
} from "../types";
import type { ChatSummary, SavedChat, ChatTurn } from "../types";
import type { Workspace } from "../types";
export const getWorkspace = () => request<Workspace>("/api/workspace");
export const manageFarm = (kind: "farms" | "plots", id: string | undefined, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, restore = false) =>
  request<{ id?: string }>(`/api/${kind}${id ? '/' + encodeURIComponent(id) : ''}${restore ? '/restore' : ''}`, { method, body: body ? JSON.stringify(body) : undefined });

export interface LocationHint {
  soilTexture: string;
  source: "soilgrids" | "soilgrids-local" | "manual" | "regional-prior";
  isFallback: boolean;
  note: string;
}

export const getLocationHint = (location: {
  longitude: number;
  latitude: number;
  coordinateSystem: "WGS84" | "GCJ-02";
}) => request<LocationHint>("/api/plots/location-hints", {
  method: "POST",
  body: JSON.stringify(location)
});

export const listChats = () => request<ChatSummary[]>("/api/chats");
export const getChat = (id: string) => request<SavedChat>(`/api/chats/${encodeURIComponent(id)}`);
export const saveChat = (id: string, plotId: string, turns: ChatTurn[]) => request(`/api/chats/${encodeURIComponent(id)}`, {
  method: "PUT", body: JSON.stringify({ plotId, turns })
});

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

export function getBootstrap(plotId?: string): Promise<BootstrapPayload> {
  const query = plotId ? `?plotId=${encodeURIComponent(plotId)}` : "";
  return request<BootstrapPayload>(`/api/bootstrap${query}`);
}

export function startAgricultureRun(input: {
  accountId: string;
  plotId: string;
  mode: "recommend" | "question";
  goal: string;
  message?: string;
  overrides?: RunOverrides;
  capabilityOverrides?: Array<{
    capabilityType: "skill" | "mcp" | "knowledge";
    capabilityId: string;
    enabled: boolean;
  }>;
}): Promise<{ runId: string; status: string }> {
  return request("/api/runs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function streamRun(
  runId: string,
  onEvent: (event: AgentEvent) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  onText?: (text: string) => void
): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const queue: AgentEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false, disposed = false, failure = false;
  const drain = () => {
    if (disposed) return;
    const event = queue.shift();
    if (event) onEvent(event);
    if (queue.length) timer = setTimeout(drain, 240);
    else { timer = undefined; if (done) { disposed = true; failure ? onError(new Error("本次任务未通过校验，请检查执行轨迹")) : onDone(); } }
  };
  source.addEventListener("agent", (message) => {
    const event = JSON.parse((message as MessageEvent).data) as AgentEvent;
    queue.push(event);
    if (!timer) timer = setTimeout(drain, 80);
  });
  source.addEventListener("text", message => {
    if (!disposed) onText?.((JSON.parse((message as MessageEvent).data) as { text: string }).text);
  });
  source.addEventListener("done", (message) => {
    source.close();
    done = true;
    failure = JSON.parse((message as MessageEvent).data).status === "failed";
    if (!timer) drain();
  });
  source.onerror = () => {
    source.close();
    if (!disposed && !done) { disposed = true; clearTimeout(timer); onError(new Error("Agent 轨迹连接中断，已保留收到的内容")); }
  };
  return () => { disposed = true; source.close(); clearTimeout(timer); };
}

export function refreshPlotContext(plotId: string): Promise<PlotContext> {
  return request(`/api/plots/${encodeURIComponent(plotId)}/context/refresh`, {
    method: "POST",
    body: "{}"
  });
}

export function saveManualSoil(
  plotId: string,
  soil: {
    texture: string;
    clayPercent: number;
    sandPercent: number;
    ph: number;
    organicCarbon: number;
    drainage: string;
    note: string;
  }
): Promise<PlotContext> {
  return request(`/api/plots/${encodeURIComponent(plotId)}/soil`, {
    method: "POST",
    body: JSON.stringify(soil)
  });
}

export function createPlantingPlan(recommendationId: string, accountId: string): Promise<PlantingPlan> {
  return request("/api/plans", {
    method: "POST",
    body: JSON.stringify({ recommendationId, accountId })
  });
}

export function addOperation(
  planId: string,
  record: {
    type: string;
    title: string;
    plannedDate: string;
    actualDate?: string;
    status: "planned" | "done" | "skipped";
    notes: string;
    cost: number;
  }
): Promise<OperationRecord> {
  return request(`/api/plans/${encodeURIComponent(planId)}/records`, {
    method: "POST",
    body: JSON.stringify(record)
  });
}

export function updateOperation(
  recordId: string,
  record: { status: "planned" | "done" | "skipped"; actualDate?: string; notes?: string }
): Promise<OperationRecord> {
  return request(`/api/records/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify(record)
  });
}

export function submitOutcome(
  planId: string,
  outcome: {
    yieldKg: number;
    quality: string;
    revenue: number;
    cost: number;
    notes: string;
  }
): Promise<OutcomeRecord> {
  return request(`/api/plans/${encodeURIComponent(planId)}/outcome`, {
    method: "POST",
    body: JSON.stringify(outcome)
  });
}

export function submitFeedback(
  planId: string,
  feedback: { outcomeId: string; rating: number; comment: string }
): Promise<unknown> {
  return request(`/api/plans/${encodeURIComponent(planId)}/feedback`, {
    method: "POST",
    body: JSON.stringify(feedback)
  });
}

export function getCapabilities(input: {
  accountId?: string;
  farmId?: string;
  plotId?: string;
} = {}): Promise<CapabilitiesPayload> {
  const params = new URLSearchParams();
  if (input.accountId) params.set("accountId", input.accountId);
  if (input.farmId) params.set("farmId", input.farmId);
  if (input.plotId) params.set("plotId", input.plotId);
  const query = params.size ? `?${params}` : "";
  return request(`/api/capabilities${query}`);
}

export function cloneCapabilitySkill(skillId: string, accountId: string, name?: string): Promise<CapabilitySkill> {
  return request(`/api/skills/${encodeURIComponent(skillId)}/clone`, {
    method: "POST",
    body: JSON.stringify({ accountId, name })
  });
}

export type CapabilitySkillInput = {
  name: string;
  description: string;
  appliesTo: string;
  instruction: string;
  tools?: string[];
  guidance?: unknown;
};

export function createCapabilitySkill(accountId: string, input: CapabilitySkillInput): Promise<CapabilitySkill> {
  return request("/api/skills", {
    method: "POST",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function importCapabilitySkill(
  accountId: string,
  fileName: string,
  content: string,
  mimeType?: string
): Promise<{ skill: CapabilitySkill; format: "json" | "markdown" }> {
  return request("/api/skills/import", {
    method: "POST",
    body: JSON.stringify({ accountId, fileName, content, mimeType })
  });
}

export function updateCapabilitySkill(
  skillId: string,
  accountId: string,
  input: {
    name?: string;
    description?: string;
    appliesTo?: string;
    instruction?: string;
    tools?: string[];
    guidance?: unknown;
  }
): Promise<CapabilitySkill> {
  return request(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function publishCapabilitySkill(skillId: string, accountId: string): Promise<CapabilitySkill> {
  return request(`/api/skills/${encodeURIComponent(skillId)}/publish`, {
    method: "POST",
    body: JSON.stringify({ accountId })
  });
}

export function testCapabilitySkill(skillId: string, accountId: string, question: string): Promise<{
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}> {
  return request(`/api/skills/${encodeURIComponent(skillId)}/test`, {
    method: "POST",
    body: JSON.stringify({ accountId, question })
  });
}

export function archiveCapabilitySkill(skillId: string, accountId: string): Promise<unknown> {
  return request(`/api/skills/${encodeURIComponent(skillId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE"
  });
}

export function setCapabilityBinding(input: {
  capabilityType: "skill" | "mcp" | "knowledge";
  capabilityId: string;
  scopeType: "account" | "farm" | "plot";
  scopeId: string;
  enabled: boolean;
}): Promise<CapabilityBinding> {
  return request("/api/capability-bindings", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createMcpServer(accountId: string, input: {
  name: string;
  transport: "http" | "stdio";
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}): Promise<MCPServerSummary> {
  return request("/api/mcp-servers", {
    method: "POST",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function updateMcpServer(serverId: string, accountId: string, input: Record<string, unknown>): Promise<MCPServerSummary> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function deleteMcpServer(serverId: string, accountId: string): Promise<unknown> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE"
  });
}

export function discoverMcpServer(serverId: string, accountId: string): Promise<MCPServerSummary> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}/discover`, {
    method: "POST",
    body: JSON.stringify({ accountId })
  });
}

export function setMcpToolEnabled(serverId: string, toolId: string, accountId: string, enabled: boolean): Promise<MCPToolDefinition> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountId, enabled })
  });
}

export function setMcpToolExecutionMode(
  serverId: string,
  toolId: string,
  accountId: string,
  executionMode: MCPToolDefinition["executionMode"]
): Promise<MCPToolDefinition> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountId, executionMode })
  });
}

export function decideMcpApproval(
  approvalId: string,
  accountId: string,
  decision: "approve" | "deny"
): Promise<McpApprovalRequestView> {
  return request(`/api/mcp-approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ accountId, decision })
  });
}

export function invokeMcpTool(
  serverId: string,
  toolId: string,
  accountId: string,
  args: Record<string, unknown>
): Promise<{ tool: string; result: unknown; latencyMs: number }> {
  return request(`/api/mcp-servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolId)}/invoke`, {
    method: "POST",
    body: JSON.stringify({ accountId, arguments: args })
  });
}

export function createKnowledgeBase(accountId: string, input: {
  name: string;
  description: string;
  scopeType: "account" | "farm" | "plot";
  scopeId: string;
}): Promise<KnowledgeBaseSummary> {
  return request("/api/knowledge-bases", {
    method: "POST",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function updateKnowledgeBase(baseId: string, accountId: string, input: Record<string, unknown>): Promise<KnowledgeBaseSummary> {
  return request(`/api/knowledge-bases/${encodeURIComponent(baseId)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function deleteKnowledgeBase(baseId: string, accountId: string): Promise<unknown> {
  return request(`/api/knowledge-bases/${encodeURIComponent(baseId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE"
  });
}

export function addKnowledgeDocument(
  baseId: string,
  accountId: string,
  input: {
    title: string;
    sourceName: string;
    mimeType: string;
    content: string;
  }
): Promise<KnowledgeDocumentSummary> {
  return request(`/api/knowledge-bases/${encodeURIComponent(baseId)}/documents`, {
    method: "POST",
    body: JSON.stringify({ accountId, ...input })
  });
}

export function deleteKnowledgeDocument(documentId: string, accountId: string): Promise<unknown> {
  return request(`/api/knowledge-documents/${encodeURIComponent(documentId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE"
  });
}

export function searchKnowledgeBase(baseId: string, accountId: string, query: string): Promise<{
  mode: "fts" | "like" | "none";
  matches: Array<{
    id: string;
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
    content: string;
  }>;
}> {
  return request(`/api/knowledge-bases/${encodeURIComponent(baseId)}/search`, {
    method: "POST",
    body: JSON.stringify({ accountId, query })
  });
}
