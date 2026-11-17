import type { SkillGuidance } from "./skill-guidance.js";

export type SkillImportFormat = "json" | "markdown";

export interface SkillDefinitionInput {
  name: string;
  description: string;
  appliesTo: string;
  instruction: string;
  tools?: string[];
  guidance?: unknown;
}

export interface ParsedSkillImport extends SkillDefinitionInput {
  format: SkillImportFormat;
}

const LIMITS = {
  fileCharacters: 100_000,
  name: 80,
  description: 500,
  appliesTo: 500,
  instruction: 20_000,
  toolCount: 30,
  toolName: 120,
  guidanceText: 2_000,
  guidanceList: 20,
  guidanceListItem: 500
} as const;

export function parseSkillImport(input: {
  fileName?: unknown;
  mimeType?: unknown;
  content?: unknown;
}): ParsedSkillImport {
  const fileName = String(input.fileName ?? "").trim();
  const content = stripBom(String(input.content ?? "")).replace(/\r\n?/g, "\n");
  if (!fileName) throw new Error("导入文件缺少文件名");
  if (!content.trim()) throw new Error("导入文件内容不能为空");
  if (content.length > LIMITS.fileCharacters) {
    throw new Error(`导入文件不能超过 ${LIMITS.fileCharacters.toLocaleString("en-US")} 个字符`);
  }

  const lowerName = fileName.toLowerCase();
  const mimeType = String(input.mimeType ?? "").toLowerCase();
  const looksLikeJson = content.trimStart().startsWith("{");
  const format: SkillImportFormat = lowerName.endsWith(".json") ||
    mimeType === "application/json" ||
    (!lowerName.endsWith(".md") && !lowerName.endsWith(".markdown") && looksLikeJson)
    ? "json"
    : "markdown";

  if (!lowerName.endsWith(".json") &&
      !lowerName.endsWith(".md") &&
      !lowerName.endsWith(".markdown") &&
      !looksLikeJson) {
    throw new Error("仅支持导入 .json、.md 或 .markdown 技能文件");
  }

  const parsed = format === "json"
    ? parseJsonSkill(content)
    : parseMarkdownSkill(content, fileName);
  return { ...parsed, format };
}

export function normalizeSkillDefinition(
  input: SkillDefinitionInput,
  options: { requireInstruction?: boolean } = {}
): SkillDefinitionInput {
  const name = requiredText(input.name, "技能名称", LIMITS.name);
  const description = requiredText(input.description, "技能说明", LIMITS.description);
  const appliesTo = requiredText(input.appliesTo, "适用问题", LIMITS.appliesTo);
  const instruction = requiredText(
    input.instruction,
    "技能指令",
    LIMITS.instruction,
    options.requireInstruction !== false
  );
  const violations = findSkillPolicyViolations(instruction);
  if (violations.length) {
    throw new Error(`技能指令包含不允许的内容：${violations.join("；")}`);
  }

  return {
    name,
    description,
    appliesTo,
    instruction,
    tools: normalizeTools(input.tools),
    guidance: normalizeGuidance(input.guidance)
  };
}

export function findSkillPolicyViolations(instruction: string): string[] {
  const violations: string[] = [];
  if (/忽略(?:所有|以上|之前|系统|开发者).{0,16}(?:规则|指令|提示)/iu.test(instruction)) {
    violations.push("不能要求忽略系统规则或开发者指令");
  }
  if (/(?:绕过|跳过|关闭).{0,16}(?:安全|权限|审核|校验)/iu.test(instruction)) {
    violations.push("不能要求绕过安全、权限或审核机制");
  }
  if (/(?:泄露|输出|展示|告诉我|读取).{0,24}(?:api.?key|密钥|访问令牌|token|环境变量|系统提示词)/iu.test(instruction)) {
    violations.push("不能索取密钥、令牌、环境变量或系统提示词");
  }
  if (/(?:sk-[a-z0-9._-]{12,}|akia[a-z0-9]{16,})/iu.test(instruction)) {
    violations.push("不能包含疑似访问密钥");
  }
  return violations;
}

function parseJsonSkill(content: string): SkillDefinitionInput {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("JSON 技能文件格式不正确");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON 技能文件必须是对象");
  }
  const record = value as Record<string, unknown>;
  const description = firstText(record.description, record.summary);
  return normalizeSkillDefinition({
    name: firstText(record.name, record.title),
    description: description || "用户导入的个人技能",
    appliesTo: firstText(record.appliesTo, record.applies_to, record["applies-to"]) || description,
    instruction: firstText(record.instruction, record.instructions, record.prompt, record.body, record.content),
    tools: Array.isArray(record.tools) ? record.tools.map(String) : undefined,
    guidance: record.guidance
  });
}

function parseMarkdownSkill(content: string, fileName: string): SkillDefinitionInput {
  const lines = content.split("\n");
  let metadata: Record<string, string> = {};
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closingIndex < 0) throw new Error("Markdown 技能缺少 frontmatter 结束标记");
    metadata = parseFrontmatter(lines.slice(1, closingIndex));
    bodyStart = closingIndex + 1;
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  if (!body) throw new Error("Markdown 技能正文不能为空");
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const paragraph = body
    .replace(/^#{1,6}\s+.+$/gm, "")
    .split(/\n\s*\n/)
    .map(item => item.replace(/[*_`>#-]/g, " ").replace(/\s+/g, " ").trim())
    .find(Boolean);
  const name = metadata.name || heading || fileStem(fileName);
  const description = metadata.description || paragraph?.slice(0, LIMITS.description) || `导入自 ${fileName}`;
  return normalizeSkillDefinition({
    name,
    description,
    appliesTo: metadata.appliesTo ||
      metadata.applies_to ||
      metadata["applies-to"] ||
      description,
    instruction: body,
    tools: splitMetadataList(metadata.tools)
  });
}

function parseFrontmatter(lines: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) throw new Error("frontmatter 字段格式不正确");
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("frontmatter 字段格式不正确");
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue === "|" || rawValue === ">") {
      const block: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() && !/^\s/.test(next)) break;
        block.push(next);
        index += 1;
      }
      const indentation = Math.min(
        ...block.filter(item => item.trim()).map(item => item.match(/^\s*/)?.[0].length ?? 0)
      );
      values[key] = block
        .map(item => item.slice(Number.isFinite(indentation) ? indentation : 0))
        .join(rawValue === "|" ? "\n" : " ")
        .trim();
      continue;
    }
    values[key] = parseScalar(rawValue);
  }
  return values;
}

function parseScalar(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function normalizeTools(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("关联工具必须是字符串数组");
  const unique = new Set<string>();
  for (const item of value) {
    const name = String(item ?? "").trim();
    if (!name) continue;
    if (name.length > LIMITS.toolName) {
      throw new Error(`单个工具名称不能超过 ${LIMITS.toolName} 个字符`);
    }
    if (!/^[a-zA-Z0-9._:/-]+$/.test(name)) {
      throw new Error(`工具名称格式无效：${name}`);
    }
    unique.add(name);
    if (unique.size > LIMITS.toolCount) throw new Error(`关联工具不能超过 ${LIMITS.toolCount} 个`);
  }
  return [...unique];
}

function normalizeGuidance(value: unknown): SkillGuidance | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("结构化指导必须是对象");
  }
  const record = value as Record<string, unknown>;
  return {
    appliesTo: requiredText(record.appliesTo, "结构化指导.appliesTo", LIMITS.guidanceText),
    requiredEvidence: stringList(record.requiredEvidence, "结构化指导.requiredEvidence"),
    steps: stringList(record.steps, "结构化指导.steps"),
    clarification: requiredText(record.clarification, "结构化指导.clarification", LIMITS.guidanceText),
    limits: stringList(record.limits, "结构化指导.limits"),
    output: requiredText(record.output, "结构化指导.output", LIMITS.guidanceText)
  };
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是字符串数组`);
  if (value.length > LIMITS.guidanceList) {
    throw new Error(`${label} 不能超过 ${LIMITS.guidanceList} 项`);
  }
  return value.map(item => requiredText(item, label, LIMITS.guidanceListItem));
}

function splitMetadataList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(item => parseScalar(item.trim()))
    .filter(Boolean);
}

function requiredText(value: unknown, label: string, maxLength: number, required = true): string {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return text;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, LIMITS.name) || "导入的个人技能";
}
