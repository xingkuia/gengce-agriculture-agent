import {
  getCapabilitySnapshot,
  getMcpApproval,
  getMcpServer,
  insertMcpApproval,
  transitionMcpApproval
} from "./capabilities-store.js";
import { isReadonlyMcpTool } from "./mcp-policy.js";
import { validateToolArguments } from "./mcp-validation.js";
import type { McpApprovalRequest, McpApprovalStatus } from "./types.js";

const DEFAULT_APPROVAL_TTL_MS = 5 * 60_000;
const APPROVAL_POLL_MS = 180;

export function createMcpApproval(input: {
  runId: string;
  accountId: string;
  serverId: string;
  serverName: string;
  toolId: string;
  toolName: string;
  toolTitle: string;
  arguments: Record<string, unknown>;
  reason: string;
}): McpApprovalRequest {
  return insertMcpApproval({
    ...input,
    expiresAt: new Date(Date.now() + approvalTtlMs()).toISOString()
  });
}

export async function waitForMcpApproval(
  approvalId: string
): Promise<McpApprovalRequest> {
  while (true) {
    const approval = getMcpApproval(approvalId);
    if (!approval) throw new Error("MCP 工具确认请求不存在");
    if (approval.status !== "pending") return approval;
    if (Date.now() >= Date.parse(approval.expiresAt)) {
      return transitionMcpApproval(
        approval.id,
        "pending",
        "expired",
        "确认请求已过期，未执行该工具。"
      ) ?? approval;
    }
    await delay(APPROVAL_POLL_MS);
  }
}

export function decideMcpApproval(input: {
  approvalId: string;
  accountId: string;
  decision: "approve" | "deny";
}): McpApprovalRequest {
  const approval = getMcpApproval(input.approvalId);
  if (!approval) throw new Error("未找到 MCP 工具确认请求");
  if (approval.accountId !== input.accountId) throw new Error("无权处理该 MCP 工具确认请求");
  if (approval.status !== "pending") throw new Error("该 MCP 工具确认请求已处理");
  if (Date.now() >= Date.parse(approval.expiresAt)) {
    transitionMcpApproval(approval.id, "pending", "expired", "确认请求已过期，未执行该工具。");
    throw new Error("确认请求已过期");
  }

  if (input.decision === "deny") {
    const denied = transitionMcpApproval(approval.id, "pending", "denied", "用户取消本次工具调用。");
    if (!denied) throw new Error("该 MCP 工具确认请求已处理");
    return denied;
  }

  const validationError = validateApprovalTarget(approval);
  if (validationError) {
    transitionMcpApproval(approval.id, "pending", "denied", validationError);
    throw new Error(validationError);
  }
  const approved = transitionMcpApproval(approval.id, "pending", "approved");
  if (!approved) throw new Error("该 MCP 工具确认请求已处理");
  return approved;
}

export function assertMcpApprovalExecutable(approval: McpApprovalRequest): void {
  const validationError = validateApprovalTarget(approval);
  if (validationError) {
    transitionMcpApproval(approval.id, "approved", "denied", validationError);
    throw new Error(validationError);
  }
}

function validateApprovalTarget(approval: McpApprovalRequest): string | null {
  const snapshot = getCapabilitySnapshot(approval.runId);
  if (!snapshot) return "本轮能力快照不存在，不能执行该工具";
  if (snapshot.accountId !== approval.accountId) return "确认请求与账号能力快照不一致";
  const snapshotServer = snapshot.mcp.find(server => server.serverId === approval.serverId);
  const snapshotTool = snapshotServer?.tools.find(tool =>
    tool.id === approval.toolId || tool.name === approval.toolName
  );
  if (!snapshotServer || !snapshotTool) return "该工具不在本轮冻结的能力快照中";
  if (!isReadonlyMcpTool(snapshotTool.annotations)) return "该工具不是只读工具，不能通过此确认执行";

  const server = getMcpServer(approval.serverId);
  if (!server) return "MCP 服务已被删除";
  if (server.accountId !== approval.accountId) return "无权使用该 MCP 服务";
  const tool = server.tools.find(item => item.name === approval.toolName);
  if (!tool) return "MCP 工具已被删除或重新发现";
  if (!tool.enabled) return "MCP 工具已停用";
  if (tool.executionMode !== "confirm") return "MCP 工具执行策略已改变，请重新发起本轮任务";
  if (!isReadonlyMcpTool(tool.annotations)) return "MCP 工具不再是只读工具";
  return validateToolArguments(tool.inputSchema, approval.arguments);
}

function approvalTtlMs(): number {
  const configured = Number(process.env.MCP_APPROVAL_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_APPROVAL_TTL_MS;
  return Math.max(1_000, Math.min(configured, 15 * 60_000));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isTerminalApprovalStatus(status: McpApprovalStatus): boolean {
  return status !== "pending";
}
