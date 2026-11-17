import type { McpExecutionMode } from "./types.js";

export function isReadonlyMcpTool(annotations?: Record<string, unknown>): boolean {
  return annotations?.readOnlyHint === true && annotations?.destructiveHint !== true;
}

export function inferMcpExecutionMode(annotations?: Record<string, unknown>): McpExecutionMode {
  if (!isReadonlyMcpTool(annotations)) return "manual";
  const costHint = String(annotations?.costHint ?? annotations?.["gengce/cost"] ?? "").toLowerCase();
  return costHint === "high" ? "confirm" : "auto";
}

export function normalizeMcpExecutionMode(
  value: unknown,
  annotations?: Record<string, unknown>
): McpExecutionMode {
  if (!isReadonlyMcpTool(annotations)) return "manual";
  if (value === "auto" || value === "confirm" || value === "manual") return value;
  return inferMcpExecutionMode(annotations);
}
