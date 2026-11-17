import {
  Check,
  ChevronDown,
  CircleSlash2,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { decideMcpApproval } from "../lib/api";
import type { AgentEvent, McpApprovalRequestView } from "../types";

interface ApprovalResult {
  approvalId: string;
  server: string;
  tool: string;
  status: "approved" | "denied" | "expired";
  error: string | null;
}

export function McpApprovalStack({
  events,
  accountId
}: {
  events: AgentEvent[];
  accountId: string;
}) {
  const requests = events.flatMap(event => {
    const payload = event.payload as { artifact?: string; approval?: McpApprovalRequestView } | undefined;
    return payload?.artifact === "McpApprovalRequest" && payload.approval ? [payload.approval] : [];
  });
  const results = new Map(
    events.flatMap(event => {
      const payload = event.payload as { artifact?: string } & Partial<ApprovalResult> | undefined;
      if (payload?.artifact !== "McpApprovalResult" || !payload.approvalId || !payload.status) return [];
      return [[payload.approvalId, payload as ApprovalResult] as const];
    })
  );

  if (!requests.length) return null;
  return (
    <div className="mcp-approval-stack">
      {requests.map(request => {
        const result = results.get(request.id);
        return result
          ? <McpApprovalOutcome key={request.id} request={request} result={result} />
          : <McpApprovalCard key={request.id} request={request} accountId={accountId} />;
      })}
    </div>
  );
}

function McpApprovalCard({
  request,
  accountId
}: {
  request: McpApprovalRequestView;
  accountId: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [request.id]);

  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision);
    setError("");
    try {
      await decideMcpApproval(request.id, accountId, decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认请求处理失败");
      setBusy(null);
    }
  };

  return (
    <section
      ref={ref}
      className="mcp-approval-card"
      aria-label="MCP 工具调用确认"
      aria-busy={Boolean(busy)}
      tabIndex={-1}
    >
      <div className="mcp-approval-heading">
        <span className="mcp-approval-icon" aria-hidden="true"><ShieldCheck size={16} /></span>
        <div>
          <strong>需要你的确认</strong>
          <p>{request.serverName} / {request.toolTitle}</p>
        </div>
        <span className="mcp-approval-chip">只读外部工具</span>
      </div>

      <p className="mcp-approval-reason">{request.reason}</p>
      <details className="mcp-approval-details">
        <summary>
          查看调用参数
          <ChevronDown size={13} />
        </summary>
        <pre>{JSON.stringify(request.arguments, null, 2)}</pre>
      </details>

      <div className="mcp-approval-meta">
        <span><PlugZap size={12} />{request.toolName}</span>
        <span>请求有效至 {formatTime(request.expiresAt)}</span>
      </div>
      {error && <p className="mcp-approval-error" role="alert">{error}</p>}
      <div className="mcp-approval-actions">
        <button type="button" disabled={Boolean(busy)} onClick={() => void decide("deny")}>
          {busy === "deny" ? <LoaderCircle className="is-spinning" size={14} /> : <X size={14} />}
          {busy === "deny" ? "正在取消…" : "取消本次调用"}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void decide("approve")}>
          {busy === "approve" ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />}
          {busy === "approve" ? "正在继续…" : "允许调用"}
        </button>
      </div>
    </section>
  );
}

function McpApprovalOutcome({
  request,
  result
}: {
  request: McpApprovalRequestView;
  result: ApprovalResult;
}) {
  const approved = result.status === "approved";
  const label = approved
    ? `你已允许调用 ${request.serverName} / ${request.toolTitle}`
    : result.status === "denied"
      ? `你已取消 ${request.serverName} / ${request.toolTitle}`
      : `调用确认已过期：${request.toolTitle}`;
  return (
    <div className={`mcp-approval-outcome is-${result.status}`}>
      {approved ? <ShieldCheck size={14} /> : <CircleSlash2 size={14} />}
      <span>{label}</span>
      {result.error && <small>{result.error}</small>}
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
