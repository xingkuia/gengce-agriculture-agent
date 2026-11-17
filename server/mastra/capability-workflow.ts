import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { makeId } from "../db.js";
import {
  CAPABILITY_RUNTIME,
  getCapabilitySnapshot,
  resolveActiveMcpServers,
  resolveActiveSkills,
  resolveScopes,
  saveCapabilitySnapshot,
  validateRuntimeCapabilityOverrides
} from "../capabilities-store.js";
import { searchKnowledge } from "../knowledge.js";
import type { CapabilitySnapshot, RuntimeCapabilityOverride } from "../types.js";

export interface PrepareCapabilitiesInput {
  runId: string;
  accountId: string;
  farmId?: string | null;
  plotId: string;
  mode: "recommend" | "question";
  question: string;
  capabilityOverrides?: RuntimeCapabilityOverride[];
}

const inputSchema = z.object({
  runId: z.string().min(1),
  accountId: z.string().min(1),
  farmId: z.string().nullable().optional(),
  plotId: z.string().min(1),
  mode: z.enum(["recommend", "question"]),
  question: z.string(),
  capabilityOverrides: z.array(z.object({
    capabilityType: z.enum(["skill", "mcp", "knowledge"]),
    capabilityId: z.string().min(1).max(200),
    enabled: z.boolean()
  })).max(32).optional()
});

const resolveCapabilitiesStep = createStep({
  id: "resolve-capability-bindings",
  inputSchema,
  outputSchema: z.any(),
  execute: async ({ inputData }) => {
    const scope = resolveScopes(inputData.accountId, inputData.farmId, inputData.plotId);
    const capabilityOverrides = validateRuntimeCapabilityOverrides(
      inputData.accountId,
      scope.scopes,
      inputData.capabilityOverrides ?? []
    );
    return {
      ...inputData,
      scopes: scope.scopes,
      capabilityOverrides,
      skills: resolveActiveSkills(inputData.accountId, scope.scopes, capabilityOverrides),
      mcpServers: resolveActiveMcpServers(inputData.accountId, scope.scopes, capabilityOverrides),
      knowledgeBases: []
    };
  }
});

const retrieveKnowledgeStep = createStep({
  id: "retrieve-scoped-knowledge",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async ({ inputData }) => {
    const query = inputData.question.trim() || "种植 天气 土壤 施肥 轮作";
    const retrieval = searchKnowledge({
      accountId: inputData.accountId,
      scopes: inputData.scopes,
      query,
      limit: 6,
      capabilityOverrides: inputData.capabilityOverrides
    });
    return {
      ...inputData,
      knowledgeBases: retrieval.bases,
      knowledgeMatches: retrieval.matches,
      retrievalMode: retrieval.mode
    };
  }
});

const createSnapshotStep = createStep({
  id: "freeze-capability-snapshot",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async ({ inputData }) => {
    const degraded: string[] = [];
    const skills = inputData.skills
      .filter((skill: { currentVersion: unknown }) => Boolean(skill.currentVersion))
      .slice(0, 32)
      .map((skill: {
        id: string;
        slug: string;
        name: string;
        kind: "system" | "personal";
        currentVersion: { version: string; instruction: string };
      }) => ({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        version: skill.currentVersion.version,
        source: skill.kind,
        instruction: skill.currentVersion.instruction
      }));
    const mcp = inputData.mcpServers
      .filter((server: { status: string }) => server.status === "connected")
      .map((server: {
        id: string;
        name: string;
        transport: "http" | "stdio";
        tools: Array<{
          id: string;
          name: string;
          title: string;
          description: string;
          inputSchema: unknown;
          annotations?: Record<string, unknown>;
          enabled: boolean;
          executionMode: "auto" | "confirm" | "manual";
        }>;
      }) => ({
        serverId: server.id,
        name: server.name,
        transport: server.transport,
        tools: server.tools
          .filter(tool => tool.enabled)
          .map(tool => ({
            id: tool.id,
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            executionMode: tool.executionMode
          }))
      }));
    if (inputData.mcpServers.some((server: { status: string }) => server.status === "error")) {
      degraded.push("部分已授权 MCP 服务当前不可连接，本轮未使用其工具。");
    }
    if (!inputData.knowledgeMatches.length) {
      degraded.push("本轮未从账号、基地或地块知识库检索到匹配片段。");
    }
    const snapshot: CapabilitySnapshot = {
      id: makeId("capsnap"),
      runId: inputData.runId,
      accountId: inputData.accountId,
      plotId: inputData.plotId,
      engine: {
        name: "Mastra Workflow",
        version: CAPABILITY_RUNTIME.version,
        workflowId: CAPABILITY_RUNTIME.workflowId
      },
      skills,
      mcp,
      overrides: inputData.capabilityOverrides,
      knowledge: {
        bases: inputData.knowledgeBases.map((base: {
          id: string;
          name: string;
          scopeType: string;
          scopeId: string;
        }) => ({
          id: base.id,
          name: base.name,
          scopeType: base.scopeType,
          scopeId: base.scopeId
        })),
        matches: inputData.knowledgeMatches
      },
      degraded,
      createdAt: new Date().toISOString()
    };
    saveCapabilitySnapshot(snapshot);
    return snapshot;
  }
});

export const capabilityWorkflow = createWorkflow({
  id: CAPABILITY_RUNTIME.workflowId,
  inputSchema,
  outputSchema: z.any()
})
  .then(resolveCapabilitiesStep)
  .then(retrieveKnowledgeStep)
  .then(createSnapshotStep)
  .commit();

export async function prepareCapabilitySnapshot(input: PrepareCapabilitiesInput): Promise<CapabilitySnapshot> {
  const existing = getCapabilitySnapshot(input.runId);
  if (existing) return existing;
  const workflowRun = await capabilityWorkflow.createRun({ resourceId: input.accountId });
  const result = await workflowRun.start({
    inputData: {
      ...input,
      farmId: input.farmId ?? null
    }
  });
  if (result.status !== "success") {
    const reason = result.status === "failed"
      ? result.error.message
      : `能力编排未完成：${result.status}`;
    throw new Error(reason);
  }
  return result.result as CapabilitySnapshot;
}
