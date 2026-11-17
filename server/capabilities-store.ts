import { db, makeId } from "./db.js";
import { inferMcpExecutionMode, normalizeMcpExecutionMode } from "./mcp-policy.js";
import {
  findSkillPolicyViolations,
  normalizeSkillDefinition,
  type SkillDefinitionInput
} from "./skill-import.js";
import { SKILLS } from "./skills.js";
import type {
  CapabilityBinding,
  CapabilityScopeRef,
  CapabilitySkill,
  CapabilitySnapshot,
  CapabilitiesPayload,
  KnowledgeBaseSummary,
  KnowledgeDocumentSummary,
  McpApprovalRequest,
  McpApprovalStatus,
  McpExecutionMode,
  MCPCallLog,
  MCPServerSummary,
  MCPToolDefinition,
  RuntimeCapabilityOverride,
  SkillVersionSummary
} from "./types.js";

export const CAPABILITY_RUNTIME = {
  engine: "Mastra Workflow" as const,
  version: "1.0.0",
  workflowId: "gengce-capability-preparation",
  note: "Mastra Runtime 负责 Agent 注册、工作流调度、能力解析、知识召回与不可变快照；耕策提供确定性农艺工具和独立 Verifier。"
};

const scopeDepth: Record<CapabilityBinding["scopeType"], number> = {
  account: 1,
  farm: 2,
  plot: 3
};

export function migrateCapabilityPlane(): void {
  seedSystemSkills();
}

export function getScopeChain(accountId: string, farmId?: string | null, plotId?: string | null): CapabilityScopeRef[] {
  const scopes: CapabilityScopeRef[] = [{ type: "account", id: accountId }];
  if (farmId) scopes.push({ type: "farm", id: farmId });
  if (plotId) scopes.push({ type: "plot", id: plotId });
  return scopes;
}

export function resolveScopes(accountId: string, farmId?: string | null, plotId?: string | null): {
  accountId: string;
  farmId: string | null;
  plotId: string | null;
  scopes: CapabilityScopeRef[];
} {
  let resolvedFarmId = farmId ?? null;
  let resolvedPlotId = plotId ?? null;
  if ((!resolvedFarmId || !resolvedPlotId) && resolvedPlotId) {
    const plot = db.prepare("SELECT farm_id FROM plot WHERE id = ? AND deleted_at IS NULL").get(resolvedPlotId) as
      | { farm_id: string }
      | undefined;
    if (plot) resolvedFarmId = plot.farm_id;
  }
  if (!resolvedPlotId) {
    const plot = db.prepare(`
      SELECT p.id, p.farm_id
      FROM plot p
      JOIN farm f ON f.id = p.farm_id
      WHERE f.account_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL
      ORDER BY f.created_at, p.created_at
      LIMIT 1
    `).get(accountId) as { id: string; farm_id: string } | undefined;
    if (plot) {
      resolvedPlotId = plot.id;
      resolvedFarmId = plot.farm_id;
    }
  }
  if (resolvedFarmId && !resolvedPlotId) {
    const plot = db.prepare(`
      SELECT id FROM plot
      WHERE farm_id = ? AND deleted_at IS NULL
      ORDER BY created_at
      LIMIT 1
    `).get(resolvedFarmId) as { id: string } | undefined;
    resolvedPlotId = plot?.id ?? null;
  }
  return {
    accountId,
    farmId: resolvedFarmId,
    plotId: resolvedPlotId,
    scopes: getScopeChain(accountId, resolvedFarmId, resolvedPlotId)
  };
}

export function getCapabilitiesPayload(accountId: string, farmId?: string | null, plotId?: string | null): CapabilitiesPayload {
  resolveScopes(accountId, farmId, plotId);
  return {
    runtime: CAPABILITY_RUNTIME,
    skills: listSkills(accountId),
    mcpServers: listMcpServers(accountId),
    knowledgeBases: listKnowledgeBases(accountId),
    recentCalls: listMcpCalls(accountId, 30)
  };
}

export function listSkills(accountId: string): CapabilitySkill[] {
  const rows = db.prepare(`
    SELECT * FROM skill
    WHERE status = 'active' AND (kind = 'system' OR account_id = ?)
    ORDER BY CASE kind WHEN 'system' THEN 0 ELSE 1 END, updated_at DESC, name
  `).all(accountId) as Array<Record<string, unknown>>;
  return rows.map(mapSkill);
}

export function getSkill(skillId: string): CapabilitySkill | null {
  const row = db.prepare("SELECT * FROM skill WHERE id = ?").get(skillId) as Record<string, unknown> | undefined;
  return row ? mapSkill(row) : null;
}

export function createSkill(accountId: string, input: SkillDefinitionInput): CapabilitySkill {
  const normalized = normalizeSkillDefinition(input);
  const account = db.prepare("SELECT id FROM account WHERE id = ?").get(accountId);
  if (!account) throw new Error("账号不存在");

  const now = new Date().toISOString();
  const id = makeId("skill");
  const versionId = makeId("skillv");
  const slug = `personal-${id.slice(-8)}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO skill (
        id, account_id, slug, name, kind, status, description, applies_to,
        tools_json, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'personal', 'active', ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      accountId,
      slug,
      normalized.name,
      normalized.description,
      normalized.appliesTo,
      JSON.stringify(normalized.tools),
      now,
      now
    );
    db.prepare(`
      INSERT INTO skill_version (
        id, skill_id, version, status, instruction, guidance_json, created_at, published_at
      ) VALUES (?, ?, '1.0.0', 'draft', ?, ?, ?, NULL)
    `).run(
      versionId,
      id,
      normalized.instruction,
      normalized.guidance ? JSON.stringify(normalized.guidance) : null,
      now
    );
    upsertBinding("skill", id, "account", accountId, true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getSkill(id)!;
}

export function cloneSkill(skillId: string, accountId: string, options: { name?: string } = {}): CapabilitySkill {
  const source = getSkill(skillId);
  if (!source) throw new Error("未找到技能");
  if (source.kind === "personal" && source.accountId !== accountId) throw new Error("无权复制该技能");
  const sourceVersion = source.draftVersion ?? source.currentVersion;
  if (!sourceVersion) throw new Error("技能没有可复制的版本");
  const now = new Date().toISOString();
  const id = makeId("skill");
  const slug = `${source.slug}-${id.slice(-8)}`;
  const versionId = makeId("skillv");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO skill (
        id, account_id, slug, name, kind, status, description, applies_to,
        tools_json, current_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'personal', 'active', ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      accountId,
      slug,
      options.name?.trim().slice(0, 80) || `${source.name}（个人副本）`,
      source.description,
      source.appliesTo,
      JSON.stringify(source.tools),
      now,
      now
    );
    db.prepare(`
      INSERT INTO skill_version (
        id, skill_id, version, status, instruction, guidance_json, created_at, published_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, NULL)
    `).run(
      versionId,
      id,
      nextSkillVersion(sourceVersion.version),
      sourceVersion.instruction,
      sourceVersion.guidance ? JSON.stringify(sourceVersion.guidance) : null,
      now
    );
    upsertBinding("skill", id, "account", accountId, true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getSkill(id)!;
}

export function updateSkill(
  skillId: string,
  accountId: string,
  input: {
    name?: string;
    description?: string;
    appliesTo?: string;
    instruction?: string;
    guidance?: unknown;
    tools?: string[];
  }
): CapabilitySkill {
  const skill = requireMutableSkill(skillId, accountId);
  const latest = skill.draftVersion ?? skill.currentVersion;
  if (!latest) throw new Error("技能没有可编辑版本");
  const normalized = normalizeSkillDefinition({
    name: input.name === undefined ? skill.name : String(input.name),
    description: input.description === undefined ? skill.description : String(input.description),
    appliesTo: input.appliesTo === undefined ? skill.appliesTo : String(input.appliesTo),
    instruction: input.instruction === undefined ? latest.instruction : String(input.instruction),
    tools: input.tools === undefined ? skill.tools : input.tools,
    guidance: input.guidance === undefined ? latest.guidance : input.guidance
  });
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE skill
      SET name = ?, description = ?, applies_to = ?, tools_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalized.name,
      normalized.description,
      normalized.appliesTo,
      JSON.stringify(normalized.tools),
      now,
      skillId
    );
    if (skill.draftVersion) {
      db.prepare(`
        UPDATE skill_version SET instruction = ?, guidance_json = ? WHERE id = ?
      `).run(
        normalized.instruction,
        normalized.guidance ? JSON.stringify(normalized.guidance) : null,
        latest.id
      );
    } else {
      const draftId = makeId("skillv");
      db.prepare(`
        INSERT INTO skill_version (
          id, skill_id, version, status, instruction, guidance_json, created_at, published_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, NULL)
      `).run(
        draftId,
        skillId,
        nextSkillVersion(latest.version),
        normalized.instruction,
        normalized.guidance ? JSON.stringify(normalized.guidance) : null,
        now
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getSkill(skillId)!;
}

export function publishSkill(skillId: string, accountId: string): CapabilitySkill {
  const skill = requireMutableSkill(skillId, accountId);
  if (!skill.draftVersion) throw new Error("没有待发布的技能版本");
  normalizeSkillDefinition({
    name: skill.name,
    description: skill.description,
    appliesTo: skill.appliesTo,
    instruction: skill.draftVersion.instruction,
    tools: skill.tools,
    guidance: skill.draftVersion.guidance
  });
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE skill_version SET status = 'archived' WHERE skill_id = ? AND status = 'published'").run(skillId);
    db.prepare("UPDATE skill_version SET status = 'published', published_at = ? WHERE id = ?").run(now, skill.draftVersion.id);
    db.prepare("UPDATE skill SET current_version_id = ?, updated_at = ? WHERE id = ?").run(skill.draftVersion.id, now, skillId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getSkill(skillId)!;
}

export function testSkill(skillId: string, accountId: string, question: string): {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
} {
  const skill = getSkill(skillId);
  if (!skill) throw new Error("未找到技能");
  if (skill.kind === "personal" && skill.accountId !== accountId) throw new Error("无权测试该技能");
  const version = skill.draftVersion ?? skill.currentVersion;
  const instruction = version?.instruction ?? "";
  const policyViolations = findSkillPolicyViolations(instruction);
  const checks = [
    {
      name: "适用范围",
      passed: Boolean(skill.appliesTo.trim() && skill.description.trim()),
      detail: "技能应说明适用问题和预期输出。"
    },
    {
      name: "证据边界",
      passed: /证据|来源|数据|不得|不能|缺失/.test(instruction),
      detail: "指令应要求区分证据来源并说明缺失数据。"
    },
    {
      name: "安全边界",
      passed: /不得|不能|禁止|不编造|不承诺/.test(instruction),
      detail: "指令应明确禁止无证据结论和保证性承诺。"
    },
    {
      name: "问题覆盖",
      passed: Array.from(question.trim()).filter(char => /[\p{L}\p{N}]/u.test(char)).length >= 4,
      detail: "测试问题应至少包含一个完整业务语境。"
    },
    {
      name: "提示注入防护",
      passed: instruction.length <= 20_000 && policyViolations.length === 0,
      detail: policyViolations[0] ?? "技能不能包含覆盖系统规则或索取密钥的指令。"
    }
  ];
  const passed = checks.filter(check => check.passed).length;
  return {
    passed: passed === checks.length,
    score: Math.round((passed / checks.length) * 100),
    checks
  };
}

export function archiveSkill(skillId: string, accountId: string): void {
  requireMutableSkill(skillId, accountId);
  db.prepare("UPDATE skill SET status = 'archived', updated_at = ? WHERE id = ?").run(new Date().toISOString(), skillId);
}

export function listMcpServers(accountId: string): MCPServerSummary[] {
  const rows = db.prepare("SELECT * FROM mcp_server WHERE account_id = ? ORDER BY updated_at DESC").all(accountId) as
    Array<Record<string, unknown>>;
  return rows.map(mapMcpServer);
}

export function getMcpServer(serverId: string): MCPServerSummary | null {
  const row = db.prepare("SELECT * FROM mcp_server WHERE id = ?").get(serverId) as Record<string, unknown> | undefined;
  return row ? mapMcpServer(row) : null;
}

export function getMcpServerConfig(serverId: string): {
  server: MCPServerSummary;
  headers: Record<string, string>;
  env: Record<string, string>;
} {
  const row = db.prepare("SELECT * FROM mcp_server WHERE id = ?").get(serverId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("未找到 MCP 服务");
  return {
    server: mapMcpServer(row),
    headers: parseStringRecord(row.request_headers_json),
    env: parseStringRecord(row.env_json)
  };
}

export function createMcpServer(accountId: string, input: Record<string, unknown>): MCPServerSummary {
  const now = new Date().toISOString();
  const id = makeId("mcp");
  const name = cleanText(input.name, "未命名 MCP", 80);
  const transport = input.transport === "stdio" ? "stdio" : "http";
  validateMcpInput(transport, input);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO mcp_server (
        id, account_id, name, transport, endpoint, request_headers_json,
        command, args_json, env_json, status, status_message, last_checked_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unconfigured', '', NULL, ?, ?)
    `).run(
      id,
      accountId,
      name,
      transport,
      stringOrNull(input.endpoint),
      JSON.stringify(toStringRecord(input.headers)),
      stringOrNull(input.command),
      JSON.stringify(toStringArray(input.args)),
      JSON.stringify(toStringRecord(input.env)),
      now,
      now
    );
    upsertBinding("mcp", id, "account", accountId, false);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getMcpServer(id)!;
}

export function updateMcpServer(serverId: string, input: Record<string, unknown>): MCPServerSummary {
  const current = getMcpServerConfig(serverId);
  const transport = input.transport === "stdio" || input.transport === "http" ? input.transport : current.server.transport;
  validateMcpInput(transport, input, current);
  const headers = input.headers === undefined ? current.headers : toStringRecord(input.headers);
  const env = input.env === undefined ? current.env : toStringRecord(input.env);
  db.prepare(`
    UPDATE mcp_server
    SET name = ?, transport = ?, endpoint = ?, request_headers_json = ?,
        command = ?, args_json = ?, env_json = ?, status = 'unconfigured',
        status_message = '', updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(input.name, current.server.name, 80),
    transport,
    input.endpoint === undefined ? current.server.endpoint : stringOrNull(input.endpoint),
    JSON.stringify(headers),
    input.command === undefined ? current.server.command : stringOrNull(input.command),
    JSON.stringify(input.args === undefined ? current.server.args : toStringArray(input.args)),
    JSON.stringify(env),
    new Date().toISOString(),
    serverId
  );
  return getMcpServer(serverId)!;
}

export function deleteMcpServer(serverId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM mcp_approval_request WHERE server_id = ?").run(serverId);
    db.prepare("DELETE FROM mcp_call_log WHERE server_id = ?").run(serverId);
    db.prepare("DELETE FROM mcp_tool WHERE server_id = ?").run(serverId);
    db.prepare("DELETE FROM capability_binding WHERE capability_type = 'mcp' AND capability_id = ?").run(serverId);
    db.prepare("DELETE FROM mcp_server WHERE id = ?").run(serverId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function replaceMcpTools(serverId: string, definitions: Array<{
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}>): MCPToolDefinition[] {
  const existing = db.prepare("SELECT name, enabled, execution_mode FROM mcp_tool WHERE server_id = ?").all(serverId) as Array<{
    name: string;
    enabled: number;
    execution_mode: string;
  }>;
  const enabled = new Map(existing.map(item => [item.name, Boolean(item.enabled)]));
  const executionModes = new Map(existing.map(item => [item.name, item.execution_mode]));
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM mcp_tool WHERE server_id = ?").run(serverId);
    const insert = db.prepare(`
      INSERT INTO mcp_tool (
        id, server_id, name, title, description, input_schema_json,
        output_schema_json, annotations_json, enabled, execution_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const definition of definitions) {
      insert.run(
        makeId("mcptool"),
        serverId,
        definition.name,
        definition.title ?? definition.name,
        definition.description ?? "",
        JSON.stringify(definition.inputSchema ?? {}),
        definition.outputSchema === undefined ? null : JSON.stringify(definition.outputSchema),
        definition.annotations === undefined ? null : JSON.stringify(definition.annotations),
        enabled.get(definition.name) === false ? 0 : 1,
        executionModes.has(definition.name)
          ? normalizeMcpExecutionMode(executionModes.get(definition.name), definition.annotations as Record<string, unknown> | undefined)
          : inferMcpExecutionMode(definition.annotations as Record<string, unknown> | undefined),
        now,
        now
      );
    }
    db.prepare(`
      UPDATE mcp_server SET status = 'connected', status_message = ?, last_checked_at = ?, updated_at = ? WHERE id = ?
    `).run(`已发现 ${definitions.length} 个工具`, now, now, serverId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getMcpServer(serverId)!.tools;
}

export function markMcpFailure(serverId: string, message: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE mcp_server SET status = 'error', status_message = ?, last_checked_at = ?, updated_at = ? WHERE id = ?
  `).run(message.slice(0, 1000), now, now, serverId);
}

export function setMcpToolEnabled(serverId: string, toolId: string, enabled: boolean): MCPToolDefinition {
  return updateMcpToolAccess(serverId, toolId, { enabled });
}

export function updateMcpToolAccess(
  serverId: string,
  toolId: string,
  input: { enabled?: boolean; executionMode?: McpExecutionMode }
): MCPToolDefinition {
  const current = getMcpServer(serverId)?.tools.find(item => item.id === toolId);
  if (!current) throw new Error("未找到 MCP 工具");
  const executionMode = input.executionMode === undefined
    ? current.executionMode
    : normalizeMcpExecutionMode(input.executionMode, current.annotations);
  if (input.executionMode && input.executionMode !== "manual" && executionMode === "manual") {
    throw new Error("写操作或破坏性工具只能设为仅手动");
  }
  db.prepare(`
    UPDATE mcp_tool SET enabled = ?, execution_mode = ?, updated_at = ? WHERE id = ? AND server_id = ?
  `).run(
    (input.enabled ?? current.enabled) ? 1 : 0,
    executionMode,
    new Date().toISOString(),
    toolId,
    serverId
  );
  const tool = getMcpServer(serverId)?.tools.find(item => item.id === toolId);
  if (!tool) throw new Error("未找到 MCP 工具");
  return tool;
}

export function insertMcpApproval(
  input: Omit<McpApprovalRequest, "id" | "status" | "errorMessage" | "createdAt" | "decidedAt">
): McpApprovalRequest {
  const approval: McpApprovalRequest = {
    ...input,
    id: makeId("mcpapproval"),
    status: "pending",
    errorMessage: null,
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
  db.prepare(`
    INSERT INTO mcp_approval_request (
      id, run_id, account_id, server_id, server_name, tool_id, tool_name, tool_title,
      arguments_json, reason, status, error_message, created_at, expires_at, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    approval.id,
    approval.runId,
    approval.accountId,
    approval.serverId,
    approval.serverName,
    approval.toolId,
    approval.toolName,
    approval.toolTitle,
    JSON.stringify(approval.arguments),
    approval.reason,
    approval.status,
    approval.errorMessage,
    approval.createdAt,
    approval.expiresAt,
    approval.decidedAt
  );
  return approval;
}

export function getMcpApproval(approvalId: string): McpApprovalRequest | null {
  const row = db.prepare("SELECT * FROM mcp_approval_request WHERE id = ?").get(approvalId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapMcpApproval(row) : null;
}

export function transitionMcpApproval(
  approvalId: string,
  from: McpApprovalStatus,
  to: McpApprovalStatus,
  errorMessage: string | null = null
): McpApprovalRequest | null {
  const decidedAt = to === "pending" ? null : new Date().toISOString();
  const result = db.prepare(`
    UPDATE mcp_approval_request
    SET status = ?, error_message = ?, decided_at = ?
    WHERE id = ? AND status = ?
  `).run(to, errorMessage?.slice(0, 1000) ?? null, decidedAt, approvalId, from);
  if (Number(result.changes) === 0) return null;
  return getMcpApproval(approvalId);
}

export function insertMcpCall(input: Omit<MCPCallLog, "id" | "createdAt">): MCPCallLog {
  const call: MCPCallLog = {
    ...input,
    id: makeId("mcpcall"),
    createdAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO mcp_call_log (
      id, server_id, tool_name, run_id, status, latency_ms, input_summary, output_summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    call.id,
    call.serverId,
    call.toolName,
    call.runId,
    call.status,
    call.latencyMs,
    call.inputSummary.slice(0, 1000),
    call.outputSummary.slice(0, 2000),
    call.createdAt
  );
  return call;
}

export function listMcpCalls(accountId: string, limit = 30): MCPCallLog[] {
  const rows = db.prepare(`
    SELECT l.* FROM mcp_call_log l
    JOIN mcp_server s ON s.id = l.server_id
    WHERE s.account_id = ?
    ORDER BY l.created_at DESC
    LIMIT ?
  `).all(accountId, Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    id: String(row.id),
    serverId: String(row.server_id),
    toolName: String(row.tool_name),
    runId: row.run_id ? String(row.run_id) : null,
    status: row.status === "error" ? "error" : "success",
    latencyMs: Number(row.latency_ms),
    inputSummary: String(row.input_summary),
    outputSummary: String(row.output_summary),
    createdAt: String(row.created_at)
  }));
}

export function listKnowledgeBases(accountId: string): KnowledgeBaseSummary[] {
  const rows = db.prepare("SELECT * FROM knowledge_base WHERE account_id = ? ORDER BY updated_at DESC").all(accountId) as
    Array<Record<string, unknown>>;
  return rows.map(mapKnowledgeBase);
}

export function getKnowledgeBase(knowledgeBaseId: string): KnowledgeBaseSummary | null {
  const row = db.prepare("SELECT * FROM knowledge_base WHERE id = ?").get(knowledgeBaseId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapKnowledgeBase(row) : null;
}

export function createKnowledgeBase(accountId: string, input: Record<string, unknown>): KnowledgeBaseSummary {
  const scope = normalizeScope(input.scopeType, input.scopeId, accountId);
  const now = new Date().toISOString();
  const id = makeId("kb");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO knowledge_base (
        id, account_id, name, description, scope_type, scope_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      accountId,
      cleanText(input.name, "未命名知识库", 80),
      cleanText(input.description, "", 500),
      scope.type,
      scope.id,
      now,
      now
    );
    upsertBinding("knowledge", id, scope.type, scope.id, true);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getKnowledgeBase(id)!;
}

export function updateKnowledgeBase(knowledgeBaseId: string, input: Record<string, unknown>): KnowledgeBaseSummary {
  const current = getKnowledgeBase(knowledgeBaseId);
  if (!current) throw new Error("未找到知识库");
  const scope = input.scopeType === undefined
    ? { type: current.scopeType, id: current.scopeId }
    : normalizeScope(input.scopeType, input.scopeId, current.accountId);
  db.prepare(`
    UPDATE knowledge_base SET name = ?, description = ?, scope_type = ?, scope_id = ?, updated_at = ? WHERE id = ?
  `).run(
    cleanText(input.name, current.name, 80),
    cleanText(input.description, current.description, 500),
    scope.type,
    scope.id,
    new Date().toISOString(),
    knowledgeBaseId
  );
  if (input.scopeType !== undefined) {
    db.prepare("DELETE FROM capability_binding WHERE capability_type = 'knowledge' AND capability_id = ?").run(knowledgeBaseId);
    upsertBinding("knowledge", knowledgeBaseId, scope.type, scope.id, true);
  }
  return getKnowledgeBase(knowledgeBaseId)!;
}

export function deleteKnowledgeBase(knowledgeBaseId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM knowledge_chunk WHERE knowledge_base_id = ?").run(knowledgeBaseId);
    db.prepare("UPDATE knowledge_document SET status = 'error', error_message = '知识库已删除' WHERE knowledge_base_id = ?")
      .run(knowledgeBaseId);
    db.prepare("DELETE FROM knowledge_document WHERE knowledge_base_id = ?").run(knowledgeBaseId);
    db.prepare("DELETE FROM capability_binding WHERE capability_type = 'knowledge' AND capability_id = ?").run(knowledgeBaseId);
    db.prepare("DELETE FROM knowledge_base WHERE id = ?").run(knowledgeBaseId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function insertKnowledgeDocument(input: {
  knowledgeBaseId: string;
  title: string;
  sourceName: string;
  publisher?: string | null;
  publishedAt?: string | null;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  mimeType: string;
  content: string;
}): KnowledgeDocumentSummary {
  const now = new Date().toISOString();
  const id = makeId("doc");
  db.prepare(`
    INSERT INTO knowledge_document (
      id, knowledge_base_id, title, source_name, publisher, published_at,
      source_url, retrieved_at, mime_type, content, status, error_message,
      chunk_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, 0, ?, ?)
  `).run(
    id,
    input.knowledgeBaseId,
    input.title,
    input.sourceName,
    input.publisher ?? null,
    input.publishedAt ?? null,
    input.sourceUrl ?? null,
    input.retrievedAt ?? null,
    input.mimeType,
    input.content,
    now,
    now
  );
  db.prepare("UPDATE knowledge_base SET updated_at = ? WHERE id = ?").run(now, input.knowledgeBaseId);
  return getKnowledgeDocument(id)!;
}

export function getKnowledgeDocument(documentId: string): KnowledgeDocumentSummary | null {
  const row = db.prepare("SELECT * FROM knowledge_document WHERE id = ?").get(documentId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapKnowledgeDocument(row) : null;
}

export function listKnowledgeDocuments(knowledgeBaseId: string): KnowledgeDocumentSummary[] {
  const rows = db.prepare(`
    SELECT * FROM knowledge_document WHERE knowledge_base_id = ? ORDER BY created_at DESC
  `).all(knowledgeBaseId) as Array<Record<string, unknown>>;
  return rows.map(mapKnowledgeDocument);
}

export function deleteKnowledgeDocument(documentId: string): void {
  const document = getKnowledgeDocument(documentId);
  if (!document) return;
  db.prepare("DELETE FROM knowledge_chunk WHERE document_id = ?").run(documentId);
  db.prepare("DELETE FROM knowledge_document WHERE id = ?").run(documentId);
  db.prepare("UPDATE knowledge_base SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), document.knowledgeBaseId);
}

export function updateKnowledgeDocumentReady(documentId: string, chunkCount: number): void {
  db.prepare(`
    UPDATE knowledge_document SET status = 'ready', error_message = NULL, chunk_count = ?, updated_at = ? WHERE id = ?
  `).run(chunkCount, new Date().toISOString(), documentId);
}

export function updateKnowledgeDocumentError(documentId: string, message: string): void {
  db.prepare(`
    UPDATE knowledge_document SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?
  `).run(message.slice(0, 1000), new Date().toISOString(), documentId);
}

export function insertKnowledgeChunk(input: {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  metadata?: unknown;
}): void {
  db.prepare(`
    INSERT INTO knowledge_chunk (
      id, document_id, knowledge_base_id, chunk_index, content, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.documentId,
    input.knowledgeBaseId,
    input.chunkIndex,
    input.content,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString()
  );
}

export function upsertBinding(
  capabilityType: CapabilityBinding["capabilityType"],
  capabilityId: string,
  scopeType: CapabilityBinding["scopeType"],
  scopeId: string,
  enabled: boolean,
  priority = 100
): CapabilityBinding {
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT * FROM capability_binding
    WHERE capability_type = ? AND capability_id = ? AND scope_type = ? AND scope_id = ?
  `).get(capabilityType, capabilityId, scopeType, scopeId) as Record<string, unknown> | undefined;
  if (existing) {
    db.prepare(`
      UPDATE capability_binding SET enabled = ?, priority = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, priority, now, String(existing.id));
    return mapBinding({
      ...existing,
      enabled: enabled ? 1 : 0,
      priority,
      updated_at: now
    });
  }
  const id = makeId("bind");
  db.prepare(`
    INSERT INTO capability_binding (
      id, capability_type, capability_id, scope_type, scope_id, enabled, priority, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, capabilityType, capabilityId, scopeType, scopeId, enabled ? 1 : 0, priority, now, now);
  return {
    id,
    capabilityType,
    capabilityId,
    scopeType,
    scopeId,
    enabled,
    priority
  };
}

export function setCapabilityBinding(input: {
  capabilityType: CapabilityBinding["capabilityType"];
  capabilityId: string;
  scopeType: CapabilityBinding["scopeType"];
  scopeId: string;
  enabled: boolean;
}): CapabilityBinding {
  validateBindingScope(input.capabilityType, input.capabilityId, input.scopeType, input.scopeId);
  return upsertBinding(input.capabilityType, input.capabilityId, input.scopeType, input.scopeId, input.enabled);
}

export function isCapabilityEnabled(
  capabilityType: CapabilityBinding["capabilityType"],
  capabilityId: string,
  scopes: CapabilityScopeRef[]
): boolean {
  const rows = db.prepare(`
    SELECT * FROM capability_binding WHERE capability_type = ? AND capability_id = ?
  `).all(capabilityType, capabilityId) as Array<Record<string, unknown>>;
  if (!rows.length) return capabilityType === "knowledge";
  const scopeMap = new Map(scopes.map((scope, index) => [`${scope.type}:${scope.id}`, index]));
  const candidates = rows
    .map(mapBinding)
    .filter(binding => scopeMap.has(`${binding.scopeType}:${binding.scopeId}`))
    .sort((left, right) => scopeDepth[right.scopeType] - scopeDepth[left.scopeType] || right.priority - left.priority);
  return candidates[0]?.enabled ?? (capabilityType === "knowledge");
}

export function validateRuntimeCapabilityOverrides(
  accountId: string,
  scopes: CapabilityScopeRef[],
  overrides: RuntimeCapabilityOverride[]
): RuntimeCapabilityOverride[] {
  if (overrides.length > 32) throw new Error("单次运行最多允许 32 条临时能力授权");
  const unique = new Map<string, RuntimeCapabilityOverride>();
  for (const override of overrides) {
    const capabilityId = override.capabilityId.trim();
    if (!capabilityId) throw new Error("临时授权缺少能力 ID");
    if (override.capabilityType === "skill") {
      const skill = getSkill(capabilityId);
      if (!skill) throw new Error("临时授权的技能不存在");
      if (skill.kind === "system") throw new Error("系统技能始终启用，不能作为临时授权");
      if (skill.accountId !== accountId) throw new Error("临时授权的技能不属于当前账号");
    } else if (override.capabilityType === "mcp") {
      const server = getMcpServer(capabilityId);
      if (!server) throw new Error("临时授权的 MCP 服务不存在");
      if (server.accountId !== accountId) throw new Error("临时授权的 MCP 服务不属于当前账号");
    } else {
      const base = getKnowledgeBase(capabilityId);
      if (!base) throw new Error("临时授权的知识库不存在");
      if (base.accountId !== accountId) throw new Error("临时授权的知识库不属于当前账号");
    }
    if (!hasCapabilityBindingInScope(override.capabilityType, capabilityId, scopes)) {
      throw new Error("临时授权不能越过账号、基地或地块的既有作用域");
    }
    unique.set(`${override.capabilityType}:${capabilityId}`, {
      capabilityType: override.capabilityType,
      capabilityId,
      enabled: Boolean(override.enabled)
    });
  }
  return [...unique.values()];
}

export function resolveActiveSkills(
  accountId: string,
  scopes: CapabilityScopeRef[],
  overrides: RuntimeCapabilityOverride[] = []
): CapabilitySkill[] {
  const runtime = runtimeOverrideMap(overrides);
  return listSkills(accountId).filter(skill => {
    if (skill.kind === "system") return true;
    const runtimeEnabled = runtime.get(`skill:${skill.id}`);
    return runtimeEnabled === undefined
      ? isCapabilityEnabled("skill", skill.id, scopes)
      : runtimeEnabled;
  });
}

export function resolveActiveMcpServers(
  accountId: string,
  scopes: CapabilityScopeRef[],
  overrides: RuntimeCapabilityOverride[] = []
): MCPServerSummary[] {
  const runtime = runtimeOverrideMap(overrides);
  return listMcpServers(accountId).filter(server => {
    const runtimeEnabled = runtime.get(`mcp:${server.id}`);
    return runtimeEnabled === undefined
      ? isCapabilityEnabled("mcp", server.id, scopes)
      : runtimeEnabled;
  });
}

export function resolveActiveKnowledgeBases(
  accountId: string,
  scopes: CapabilityScopeRef[],
  overrides: RuntimeCapabilityOverride[] = []
): KnowledgeBaseSummary[] {
  const scopeMap = new Map(scopes.map(scope => [`${scope.type}:${scope.id}`, scope]));
  const runtime = runtimeOverrideMap(overrides);
  return listKnowledgeBases(accountId).filter(base => {
    if (!scopeMap.has(`${base.scopeType}:${base.scopeId}`)) return false;
    const runtimeEnabled = runtime.get(`knowledge:${base.id}`);
    return runtimeEnabled === undefined
      ? isCapabilityEnabled("knowledge", base.id, scopes)
      : runtimeEnabled;
  });
}

function runtimeOverrideMap(overrides: RuntimeCapabilityOverride[]): Map<string, boolean> {
  return new Map(
    overrides.map(override => [
      `${override.capabilityType}:${override.capabilityId}`,
      Boolean(override.enabled)
    ])
  );
}

function hasCapabilityBindingInScope(
  capabilityType: CapabilityBinding["capabilityType"],
  capabilityId: string,
  scopes: CapabilityScopeRef[]
): boolean {
  const scopeKeys = new Set(scopes.map(scope => `${scope.type}:${scope.id}`));
  const rows = db.prepare(`
    SELECT scope_type, scope_id FROM capability_binding
    WHERE capability_type = ? AND capability_id = ?
  `).all(capabilityType, capabilityId) as Array<{ scope_type: string; scope_id: string }>;
  return rows.some(row => scopeKeys.has(`${row.scope_type}:${row.scope_id}`));
}

export function saveCapabilitySnapshot(snapshot: CapabilitySnapshot): CapabilitySnapshot {
  db.prepare(`
    INSERT INTO capability_snapshot (id, run_id, account_id, plot_id, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      id = excluded.id,
      snapshot_json = excluded.snapshot_json,
      created_at = excluded.created_at
  `).run(
    snapshot.id,
    snapshot.runId,
    snapshot.accountId,
    snapshot.plotId,
    JSON.stringify(snapshot),
    snapshot.createdAt
  );
  return snapshot;
}

export function getCapabilitySnapshot(runId: string): CapabilitySnapshot | null {
  const row = db.prepare("SELECT snapshot_json FROM capability_snapshot WHERE run_id = ?").get(runId) as
    | { snapshot_json: string }
    | undefined;
  return row ? JSON.parse(row.snapshot_json) as CapabilitySnapshot : null;
}

export function getDefaultAccountId(): string {
  const row = db.prepare("SELECT id FROM account ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!row) throw new Error("账号尚未初始化");
  return row.id;
}

function seedSystemSkills(): void {
  const now = new Date().toISOString();
  for (const skill of SKILLS) {
    const id = `skill-system-${skill.id}`;
    const existing = db.prepare("SELECT id FROM skill WHERE id = ?").get(id) as { id: string } | undefined;
    if (existing) continue;
    const versionId = `skillv-system-${skill.id}-${skill.version}`;
    const guidance = skill.guidance;
    const instruction = guidance
      ? [
          `适用：${guidance.appliesTo}`,
          `所需证据：${guidance.requiredEvidence.join("；")}`,
          `执行步骤：${guidance.steps.join("；")}`,
          `关键追问：${guidance.clarification}`,
          `限制：${guidance.limits.join("；")}`,
          `输出：${guidance.output}`
        ].join("\n")
      : skill.description;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO skill (
          id, account_id, slug, name, kind, status, description, applies_to,
          tools_json, current_version_id, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, 'system', 'active', ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        skill.id,
        skill.name,
        skill.description,
        guidance?.appliesTo ?? skill.description,
        JSON.stringify(skill.tools),
        versionId,
        now,
        now
      );
      db.prepare(`
        INSERT INTO skill_version (
          id, skill_id, version, status, instruction, guidance_json, created_at, published_at
        ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?)
      `).run(
        versionId,
        id,
        skill.version,
        instruction,
        guidance ? JSON.stringify(guidance) : null,
        now,
        now
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapSkill(row: Record<string, unknown>): CapabilitySkill {
  const versions = (db.prepare("SELECT * FROM skill_version WHERE skill_id = ? ORDER BY created_at DESC").all(String(row.id)) as
    Array<Record<string, unknown>>).map(mapSkillVersion);
  const currentVersion = versions.find(version => version.id === String(row.current_version_id ?? "")) ?? null;
  const draftVersion = versions.find(version => version.status === "draft") ?? null;
  return {
    id: String(row.id),
    accountId: row.account_id ? String(row.account_id) : null,
    slug: String(row.slug),
    name: String(row.name),
    kind: row.kind === "personal" ? "personal" : "system",
    status: row.status === "archived" ? "archived" : "active",
    description: String(row.description),
    appliesTo: String(row.applies_to),
    tools: parseStringArray(row.tools_json),
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    currentVersion,
    draftVersion,
    bindings: listBindings("skill", String(row.id)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSkillVersion(row: Record<string, unknown>): SkillVersionSummary {
  return {
    id: String(row.id),
    version: String(row.version),
    status: String(row.status) as SkillVersionSummary["status"],
    instruction: String(row.instruction),
    guidance: row.guidance_json ? JSON.parse(String(row.guidance_json)) : undefined,
    createdAt: String(row.created_at),
    publishedAt: row.published_at ? String(row.published_at) : null
  };
}

function mapMcpServer(row: Record<string, unknown>): MCPServerSummary {
  const toolRows = db.prepare("SELECT * FROM mcp_tool WHERE server_id = ? ORDER BY name").all(String(row.id)) as
    Array<Record<string, unknown>>;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    transport: row.transport === "stdio" ? "stdio" : "http",
    endpoint: row.endpoint ? String(row.endpoint) : null,
    command: row.command ? String(row.command) : null,
    args: parseStringArray(row.args_json),
    envKeys: Object.keys(parseStringRecord(row.env_json)),
    headerNames: Object.keys(parseStringRecord(row.request_headers_json)),
    status: row.status === "connected" ? "connected" : row.status === "error" ? "error" : "unconfigured",
    statusMessage: String(row.status_message ?? ""),
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    tools: toolRows.map(mapMcpTool),
    bindings: listBindings("mcp", String(row.id)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMcpTool(row: Record<string, unknown>): MCPToolDefinition {
  const annotations = row.annotations_json ? JSON.parse(String(row.annotations_json)) as Record<string, unknown> : undefined;
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    name: String(row.name),
    title: String(row.title),
    description: String(row.description),
    inputSchema: JSON.parse(String(row.input_schema_json)),
    outputSchema: row.output_schema_json ? JSON.parse(String(row.output_schema_json)) : undefined,
    annotations,
    enabled: Boolean(row.enabled),
    executionMode: normalizeMcpExecutionMode(row.execution_mode, annotations),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMcpApproval(row: Record<string, unknown>): McpApprovalRequest {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    accountId: String(row.account_id),
    serverId: String(row.server_id),
    serverName: String(row.server_name),
    toolId: String(row.tool_id),
    toolName: String(row.tool_name),
    toolTitle: String(row.tool_title),
    arguments: JSON.parse(String(row.arguments_json)) as Record<string, unknown>,
    reason: String(row.reason ?? ""),
    status: normalizeMcpApprovalStatus(row.status),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    decidedAt: row.decided_at ? String(row.decided_at) : null
  };
}

function normalizeMcpApprovalStatus(value: unknown): McpApprovalStatus {
  return value === "approved" || value === "denied" || value === "expired" ? value : "pending";
}

function mapKnowledgeBase(row: Record<string, unknown>): KnowledgeBaseSummary {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    description: String(row.description),
    scopeType: String(row.scope_type) as KnowledgeBaseSummary["scopeType"],
    scopeId: String(row.scope_id),
    documents: listKnowledgeDocuments(String(row.id)),
    bindings: listBindings("knowledge", String(row.id)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapKnowledgeDocument(row: Record<string, unknown>): KnowledgeDocumentSummary {
  return {
    id: String(row.id),
    knowledgeBaseId: String(row.knowledge_base_id),
    title: String(row.title),
    sourceName: String(row.source_name),
    publisher: row.publisher ? String(row.publisher) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : null,
    mimeType: String(row.mime_type),
    status: row.status === "error" ? "error" : "ready",
    errorMessage: row.error_message ? String(row.error_message) : null,
    chunkCount: Number(row.chunk_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function listBindings(capabilityType: CapabilityBinding["capabilityType"], capabilityId: string): CapabilityBinding[] {
  const rows = db.prepare(`
    SELECT * FROM capability_binding WHERE capability_type = ? AND capability_id = ? ORDER BY scope_type, created_at
  `).all(capabilityType, capabilityId) as Array<Record<string, unknown>>;
  return rows.map(mapBinding);
}

function mapBinding(row: Record<string, unknown>): CapabilityBinding {
  return {
    id: String(row.id),
    capabilityType: String(row.capability_type) as CapabilityBinding["capabilityType"],
    capabilityId: String(row.capability_id),
    scopeType: String(row.scope_type) as CapabilityBinding["scopeType"],
    scopeId: String(row.scope_id),
    enabled: Boolean(row.enabled),
    priority: Number(row.priority)
  };
}

function normalizeScope(scopeType: unknown, scopeId: unknown, accountId: string): CapabilityScopeRef {
  const type = scopeType === "farm" || scopeType === "plot" ? scopeType : "account";
  const id = type === "account" ? accountId : String(scopeId ?? "");
  if (!id) throw new Error("请选择能力作用域");
  if (type === "farm") {
    const row = db.prepare("SELECT id FROM farm WHERE id = ? AND account_id = ? AND deleted_at IS NULL").get(id, accountId);
    if (!row) throw new Error("基地不存在或不属于当前账号");
  }
  if (type === "plot") {
    const row = db.prepare(`
      SELECT p.id FROM plot p JOIN farm f ON f.id = p.farm_id
      WHERE p.id = ? AND f.account_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL
    `).get(id, accountId);
    if (!row) throw new Error("地块不存在或不属于当前账号");
  }
  return { type, id };
}

function validateBindingScope(
  capabilityType: CapabilityBinding["capabilityType"],
  capabilityId: string,
  scopeType: CapabilityBinding["scopeType"],
  scopeId: string
): void {
  let ownerAccountId: string;
  if (capabilityType === "skill") {
    const skill = getSkill(capabilityId);
    if (!skill) throw new Error("未找到技能");
    if (skill.kind === "system") throw new Error("系统技能始终启用，无需绑定");
    ownerAccountId = skill.accountId!;
  } else if (capabilityType === "mcp") {
    const server = getMcpServer(capabilityId);
    if (!server) throw new Error("未找到 MCP 服务");
    ownerAccountId = server.accountId;
  } else {
    const base = getKnowledgeBase(capabilityId);
    if (!base) throw new Error("未找到知识库");
    ownerAccountId = base.accountId;
  }
  if (!scopeId.trim()) throw new Error("作用域 ID 无效");
  if (scopeType === "account" && scopeId !== ownerAccountId) throw new Error("账号作用域不属于能力所有者");
  if (scopeType === "farm" && !db.prepare("SELECT id FROM farm WHERE id = ? AND account_id = ? AND deleted_at IS NULL").get(scopeId, ownerAccountId)) throw new Error("基地不存在");
  if (scopeType === "plot") {
    const plot = db.prepare(`
      SELECT p.id FROM plot p JOIN farm f ON f.id = p.farm_id
      WHERE p.id = ? AND f.account_id = ? AND p.deleted_at IS NULL AND f.deleted_at IS NULL
    `).get(scopeId, ownerAccountId);
    if (!plot) throw new Error("地块不存在");
  }
}

function requireMutableSkill(skillId: string, accountId: string): CapabilitySkill {
  const skill = getSkill(skillId);
  if (!skill) throw new Error("未找到技能");
  if (skill.kind === "system") throw new Error("系统内置技能不可直接修改，请先复制为个人技能");
  if (skill.accountId !== accountId) throw new Error("无权修改该技能");
  return skill;
}

function nextSkillVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return "1.0.1";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function validateMcpInput(
  transport: "http" | "stdio",
  input: Record<string, unknown>,
  current?: { server: MCPServerSummary }
): void {
  if (transport === "http") {
    const endpoint = input.endpoint === undefined ? current?.server.endpoint : stringOrNull(input.endpoint);
    if (!endpoint) throw new Error("HTTP MCP 服务需要填写地址");
    const parsed = new URL(endpoint);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("MCP 地址仅支持 HTTP 或 HTTPS");
  } else {
    const command = input.command === undefined ? current?.server.command : stringOrNull(input.command);
    if (!command) throw new Error("stdio MCP 服务需要填写启动命令");
    if (!["node", "npx", "pnpm", "python", "python3", "uvx"].includes(command)) {
      throw new Error("为安全起见，stdio 仅允许 node、npx、pnpm、python、python3 或 uvx");
    }
  }
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  return String(value ?? fallback).trim().slice(0, maxLength) || fallback;
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 2000) : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item)).filter(Boolean).slice(0, 50);
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, item]) => [String(key).slice(0, 120), String(item).slice(0, 4000)])
  );
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseStringRecord(value: unknown): Record<string, string> {
  try {
    return toStringRecord(JSON.parse(String(value ?? "{}")));
  } catch {
    return {};
  }
}
