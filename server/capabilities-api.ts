import type { IncomingMessage, ServerResponse } from "node:http";
import {
  archiveSkill,
  cloneSkill,
  createKnowledgeBase,
  createMcpServer,
  createSkill,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  deleteMcpServer,
  getCapabilitiesPayload,
  getCapabilitySnapshot,
  getDefaultAccountId,
  getKnowledgeBase,
  getMcpServer,
  getSkill,
  insertKnowledgeDocument,
  listKnowledgeDocuments,
  publishSkill,
  setCapabilityBinding,
  updateMcpToolAccess,
  testSkill,
  updateKnowledgeBase,
  updateMcpServer,
  updateSkill
} from "./capabilities-store.js";
import { decideMcpApproval } from "./mcp-approval.js";
import { discoverMcpServer, invokeMcpTool } from "./mcp-manager.js";
import { indexKnowledgeDocument, removeDocumentIndex, searchKnowledge, validateKnowledgeDocument } from "./knowledge.js";
import { resolveScopes } from "./capabilities-store.js";
import { parseSkillImport } from "./skill-import.js";

type ReadJson = (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
type SendJson = (response: ServerResponse, status: number, payload: unknown) => void;

export async function handleCapabilityApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readJson: ReadJson,
  sendJson: SendJson
): Promise<boolean> {
  const method = request.method ?? "GET";
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/capabilities") &&
      !pathname.startsWith("/api/skills") &&
      !pathname.startsWith("/api/mcp-servers") &&
      !pathname.startsWith("/api/knowledge-bases") &&
      !pathname.startsWith("/api/knowledge-documents") &&
      !pathname.startsWith("/api/capability-bindings") &&
      !pathname.startsWith("/api/mcp-approvals") &&
      !/^\/api\/runs\/[^/]+\/capabilities$/.test(pathname)) {
    return false;
  }

  try {
    if (method === "GET" && pathname === "/api/capabilities") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      sendJson(response, 200, getCapabilitiesPayload(
        accountId,
        url.searchParams.get("farmId"),
        url.searchParams.get("plotId")
      ));
      return true;
    }

    if (method === "POST" && pathname === "/api/skills") {
      const body = await readJson(request);
      sendJson(response, 201, createSkill(accountIdFrom(body), {
        name: String(body.name ?? ""),
        description: String(body.description ?? ""),
        appliesTo: String(body.appliesTo ?? ""),
        instruction: String(body.instruction ?? ""),
        tools: Array.isArray(body.tools) ? body.tools.map(String) : undefined,
        guidance: body.guidance
      }));
      return true;
    }

    if (method === "POST" && pathname === "/api/skills/import") {
      const body = await readJson(request, 200_000);
      const imported = parseSkillImport({
        fileName: body.fileName,
        mimeType: body.mimeType,
        content: body.content
      });
      sendJson(response, 201, {
        skill: createSkill(accountIdFrom(body), imported),
        format: imported.format
      });
      return true;
    }

    const snapshotMatch = pathname.match(/^\/api\/runs\/([^/]+)\/capabilities$/);
    if (method === "GET" && snapshotMatch) {
      const snapshot = getCapabilitySnapshot(decodeURIComponent(snapshotMatch[1]));
      if (!snapshot) {
        sendJson(response, 404, { message: "该运行没有能力快照" });
        return true;
      }
      sendJson(response, 200, snapshot);
      return true;
    }

    const cloneMatch = pathname.match(/^\/api\/skills\/([^/]+)\/clone$/);
    if (method === "POST" && cloneMatch) {
      const body = await readJson(request);
      const accountId = accountIdFrom(body);
      sendJson(response, 201, cloneSkill(decodeURIComponent(cloneMatch[1]), accountId, {
        name: body.name ? String(body.name) : undefined
      }));
      return true;
    }

    const skillPublishMatch = pathname.match(/^\/api\/skills\/([^/]+)\/publish$/);
    if (method === "POST" && skillPublishMatch) {
      const body = await readJson(request);
      sendJson(response, 200, publishSkill(decodeURIComponent(skillPublishMatch[1]), accountIdFrom(body)));
      return true;
    }

    const skillTestMatch = pathname.match(/^\/api\/skills\/([^/]+)\/test$/);
    if (method === "POST" && skillTestMatch) {
      const body = await readJson(request);
      sendJson(response, 200, testSkill(
        decodeURIComponent(skillTestMatch[1]),
        accountIdFrom(body),
        String(body.question ?? "本地水稻田未来一周是否需要追肥？")
      ));
      return true;
    }

    const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (skillMatch && method === "PATCH") {
      const body = await readJson(request);
      sendJson(response, 200, updateSkill(
        decodeURIComponent(skillMatch[1]),
        accountIdFrom(body),
        {
          name: body.name === undefined ? undefined : String(body.name),
          description: body.description === undefined ? undefined : String(body.description),
          appliesTo: body.appliesTo === undefined ? undefined : String(body.appliesTo),
          instruction: body.instruction === undefined ? undefined : String(body.instruction),
          guidance: body.guidance,
          tools: Array.isArray(body.tools) ? body.tools.map(String) : undefined
        }
      ));
      return true;
    }
    if (skillMatch && method === "DELETE") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      archiveSkill(decodeURIComponent(skillMatch[1]), accountId);
      sendJson(response, 200, { archived: true });
      return true;
    }

    if (method === "POST" && pathname === "/api/capability-bindings") {
      const body = await readJson(request);
      const capabilityType = body.capabilityType;
      const scopeType = body.scopeType;
      if (!["skill", "mcp", "knowledge"].includes(String(capabilityType)) ||
          !["account", "farm", "plot"].includes(String(scopeType))) {
        sendJson(response, 400, { message: "能力类型或作用域无效" });
        return true;
      }
      const binding = setCapabilityBinding({
        capabilityType: capabilityType as "skill" | "mcp" | "knowledge",
        capabilityId: required(body.capabilityId, "capabilityId"),
        scopeType: scopeType as "account" | "farm" | "plot",
        scopeId: required(body.scopeId, "scopeId"),
        enabled: Boolean(body.enabled)
      });
      sendJson(response, 200, binding);
      return true;
    }

    if (method === "GET" && pathname === "/api/mcp-servers") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      sendJson(response, 200, getCapabilitiesPayload(accountId).mcpServers);
      return true;
    }
    if (method === "POST" && pathname === "/api/mcp-servers") {
      const body = await readJson(request);
      sendJson(response, 201, createMcpServer(accountIdFrom(body), body));
      return true;
    }
    const mcpApprovalMatch = pathname.match(/^\/api\/mcp-approvals\/([^/]+)\/decision$/);
    if (mcpApprovalMatch && method === "POST") {
      const body = await readJson(request);
      const decision = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;
      if (!decision) {
        sendJson(response, 400, { message: "确认决定必须是 approve 或 deny" });
        return true;
      }
      sendJson(response, 200, decideMcpApproval({
        approvalId: decodeURIComponent(mcpApprovalMatch[1]),
        accountId: accountIdFrom(body),
        decision
      }));
      return true;
    }
    const mcpToolMatch = pathname.match(/^\/api\/mcp-servers\/([^/]+)\/tools\/([^/]+)$/);
    if (mcpToolMatch && method === "PATCH") {
      const body = await readJson(request);
      const server = requireMcpOwnership(decodeURIComponent(mcpToolMatch[1]), accountIdFrom(body));
      const executionMode = body.executionMode === "auto" ||
        body.executionMode === "confirm" ||
        body.executionMode === "manual"
        ? body.executionMode
        : undefined;
      const tool = updateMcpToolAccess(server.id, decodeURIComponent(mcpToolMatch[2]), {
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        executionMode
      });
      sendJson(response, 200, tool);
      return true;
    }
    const mcpToolInvokeMatch = pathname.match(/^\/api\/mcp-servers\/([^/]+)\/tools\/([^/]+)\/invoke$/);
    if (mcpToolInvokeMatch && method === "POST") {
      const body = await readJson(request);
      const server = requireMcpOwnership(decodeURIComponent(mcpToolInvokeMatch[1]), accountIdFrom(body));
      const tool = server.tools.find(item => item.id === decodeURIComponent(mcpToolInvokeMatch[2]));
      if (!tool) {
        sendJson(response, 404, { message: "未找到 MCP 工具" });
        return true;
      }
      const result = await invokeMcpTool({
        serverId: server.id,
        toolName: tool.name,
        arguments: objectValue(body.arguments),
        runId: body.runId ? String(body.runId) : null
      });
      sendJson(response, 200, { tool: tool.name, ...result });
      return true;
    }
    const mcpTestMatch = pathname.match(/^\/api\/mcp-servers\/([^/]+)\/(test|discover)$/);
    if (mcpTestMatch && method === "POST") {
      const body = await readJson(request);
      requireMcpOwnership(decodeURIComponent(mcpTestMatch[1]), accountIdFrom(body));
      const discovered = await discoverMcpServer(decodeURIComponent(mcpTestMatch[1]));
      const fresh = getMcpServer(discovered.id);
      sendJson(response, 200, fresh ?? discovered);
      return true;
    }
    const mcpMatch = pathname.match(/^\/api\/mcp-servers\/([^/]+)$/);
    if (mcpMatch && method === "PATCH") {
      const body = await readJson(request);
      requireMcpOwnership(decodeURIComponent(mcpMatch[1]), accountIdFrom(body));
      sendJson(response, 200, updateMcpServer(decodeURIComponent(mcpMatch[1]), body));
      return true;
    }
    if (mcpMatch && method === "DELETE") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      const server = requireMcpOwnership(decodeURIComponent(mcpMatch[1]), accountId);
      deleteMcpServer(server.id);
      sendJson(response, 200, { deleted: true });
      return true;
    }

    if (method === "GET" && pathname === "/api/knowledge-bases") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      sendJson(response, 200, getCapabilitiesPayload(accountId).knowledgeBases);
      return true;
    }
    if (method === "POST" && pathname === "/api/knowledge-bases") {
      const body = await readJson(request);
      sendJson(response, 201, createKnowledgeBase(accountIdFrom(body), body));
      return true;
    }
    const kbSearchMatch = pathname.match(/^\/api\/knowledge-bases\/([^/]+)\/search$/);
    if (kbSearchMatch && method === "POST") {
      const body = await readJson(request);
      const base = requireKnowledgeOwnership(decodeURIComponent(kbSearchMatch[1]), accountIdFrom(body));
      const scope = resolveScopes(
        base.accountId,
        base.scopeType === "farm" ? base.scopeId : null,
        base.scopeType === "plot" ? base.scopeId : null
      );
      const result = searchKnowledge({
        accountId: base.accountId,
        scopes: scope.scopes,
        query: required(body.query, "query"),
        limit: 8
      });
      sendJson(response, 200, {
        ...result,
        matches: result.matches.filter(match => match.knowledgeBaseId === base.id)
      });
      return true;
    }
    const kbDocumentsMatch = pathname.match(/^\/api\/knowledge-bases\/([^/]+)\/documents$/);
    if (kbDocumentsMatch && method === "POST") {
      const body = await readJson(request, 8_000_000);
      const base = requireKnowledgeOwnership(decodeURIComponent(kbDocumentsMatch[1]), accountIdFrom(body));
      const content = required(body.content, "content");
      if (content.length > 2_000_000) throw new Error("单个知识文档不能超过 2,000,000 字符");
      const mimeType = normalizeKnowledgeMime(body.mimeType, body.sourceName);
      const document = insertKnowledgeDocument({
        knowledgeBaseId: base.id,
        title: String(body.title ?? body.sourceName ?? "未命名资料").trim().slice(0, 160),
        sourceName: String(body.sourceName ?? body.title ?? "手动录入").trim().slice(0, 200),
        mimeType,
        content
      });
      try {
        const chunkCount = await indexKnowledgeDocument({
          documentId: document.id,
          knowledgeBaseId: base.id,
          title: document.title,
          mimeType,
          content
        });
        sendJson(response, 201, { ...document, status: "ready", chunkCount });
      } catch (error) {
        sendJson(response, 422, {
          message: error instanceof Error ? error.message : "知识文档索引失败",
          documentId: document.id
        });
      }
      return true;
    }
    if (kbDocumentsMatch && method === "GET") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      const base = requireKnowledgeOwnership(decodeURIComponent(kbDocumentsMatch[1]), accountId);
      sendJson(response, 200, listKnowledgeDocuments(base.id));
      return true;
    }
    const knowledgeDocumentMatch = pathname.match(/^\/api\/knowledge-documents\/([^/]+)$/);
    if (knowledgeDocumentMatch && method === "DELETE") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      const document = validateKnowledgeDocument(decodeURIComponent(knowledgeDocumentMatch[1]));
      requireKnowledgeOwnership(document.knowledgeBaseId, accountId);
      removeDocumentIndex(document.documentId);
      deleteKnowledgeDocument(document.documentId);
      sendJson(response, 200, { deleted: true });
      return true;
    }
    const kbMatch = pathname.match(/^\/api\/knowledge-bases\/([^/]+)$/);
    if (kbMatch && method === "PATCH") {
      const body = await readJson(request);
      requireKnowledgeOwnership(decodeURIComponent(kbMatch[1]), accountIdFrom(body));
      sendJson(response, 200, updateKnowledgeBase(decodeURIComponent(kbMatch[1]), body));
      return true;
    }
    if (kbMatch && method === "DELETE") {
      const accountId = url.searchParams.get("accountId") || getDefaultAccountId();
      const base = requireKnowledgeOwnership(decodeURIComponent(kbMatch[1]), accountId);
      for (const document of base.documents) removeDocumentIndex(document.id);
      deleteKnowledgeBase(base.id);
      sendJson(response, 200, { deleted: true });
      return true;
    }
  } catch (error) {
    sendJson(response, 400, {
      error: "CAPABILITY_ERROR",
      message: error instanceof Error ? error.message : "能力管理操作失败"
    });
    return true;
  }
  return false;
}

function accountIdFrom(body: Record<string, unknown>): string {
  return String(body.accountId ?? "").trim() || getDefaultAccountId();
}

function requireMcpOwnership(serverId: string, accountId: string) {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("未找到 MCP 服务");
  if (server.accountId !== accountId) throw new Error("无权操作该 MCP 服务");
  return server;
}

function requireKnowledgeOwnership(knowledgeBaseId: string, accountId: string) {
  const base = getKnowledgeBase(knowledgeBaseId);
  if (!base) throw new Error("未找到知识库");
  if (base.accountId !== accountId) throw new Error("无权操作该知识库");
  return base;
}

function required(value: unknown, name: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} 不能为空`);
  return text;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeKnowledgeMime(mimeType: unknown, sourceName: unknown): string {
  const value = String(mimeType ?? "").toLowerCase();
  const name = String(sourceName ?? "").toLowerCase();
  if (value === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (value === "application/json" || name.endsWith(".json")) return "application/json";
  return "text/plain";
}
