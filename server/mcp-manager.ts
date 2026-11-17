import { MCPClient } from "@mastra/mcp";
import {
  getMcpServer,
  getMcpServerConfig,
  insertMcpCall,
  markMcpFailure,
  replaceMcpTools
} from "./capabilities-store.js";
import type { MCPServerSummary } from "./types.js";

interface McpConnection {
  client: MCPClient;
  key: string;
}

export async function discoverMcpServer(serverId: string): Promise<MCPServerSummary> {
  const config = getMcpServerConfig(serverId);
  const connection = createConnection(serverId);
  try {
    const discovery = await connection.client.listToolDefinitionsWithErrors();
    const error = discovery.errors[connection.key];
    if (error) throw new Error(error);
    const definitions = discovery.definitions[connection.key] ?? {};
    const tools = Object.values(definitions).map(definition => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations
    }));
    replaceMcpTools(serverId, tools);
    return getMcpServer(serverId)!;
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP 服务连接失败";
    markMcpFailure(serverId, message);
    throw new Error(message);
  } finally {
    await connection.client.disconnect().catch(() => {});
  }
}

export async function invokeMcpTool(input: {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  runId?: string | null;
}): Promise<{ result: unknown; latencyMs: number }> {
  const server = getMcpServerConfig(input.serverId).server;
  const definition = server.tools.find(tool => tool.name === input.toolName);
  if (!definition) throw new Error("未找到 MCP 工具，请先发现工具");
  if (!definition.enabled) throw new Error("该 MCP 工具尚未启用");
  const connection = createConnection(input.serverId);
  const startedAt = Date.now();
  try {
    const toolsets = await connection.client.listToolsets();
    const tool = toolsets[connection.key]?.[input.toolName];
    if (!tool?.execute) throw new Error("MCP 工具不可执行");
    const result = await tool.execute(input.arguments);
    const latencyMs = Date.now() - startedAt;
    insertMcpCall({
      serverId: input.serverId,
      toolName: input.toolName,
      runId: input.runId ?? null,
      status: "success",
      latencyMs,
      inputSummary: safeSummary(input.arguments),
      outputSummary: safeSummary(result)
    });
    return { result, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    insertMcpCall({
      serverId: input.serverId,
      toolName: input.toolName,
      runId: input.runId ?? null,
      status: "error",
      latencyMs,
      inputSummary: safeSummary(input.arguments),
      outputSummary: error instanceof Error ? error.message : "MCP tool error"
    });
    throw error;
  } finally {
    await connection.client.disconnect().catch(() => {});
  }
}

function createConnection(serverId: string): McpConnection {
  const config = getMcpServerConfig(serverId);
  const key = `gengce_${serverId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const server = config.server.transport === "http"
    ? {
        url: new URL(config.server.endpoint!),
        requestInit: Object.keys(config.headers).length
          ? { headers: config.headers }
          : undefined,
        timeout: 15_000
      }
    : {
        command: config.server.command!,
        args: config.server.args,
        env: config.env,
        timeout: 20_000,
        inheritDefaultEnv: true,
        stderr: "pipe" as const
      };
  return {
    key,
    client: new MCPClient({
      servers: { [key]: server },
      registerProcessHooks: false
    })
  };
}

function safeSummary(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").slice(0, 2000);
}
