import { makeId } from "./db.js";
import {
  getKnowledgeBase,
  getKnowledgeDocument,
  insertKnowledgeChunk,
  resolveActiveKnowledgeBases,
  updateKnowledgeDocumentError,
  updateKnowledgeDocumentReady
} from "./capabilities-store.js";
import { db } from "./db.js";
import type { CapabilityScopeRef, KnowledgeChunkSummary, RuntimeCapabilityOverride } from "./types.js";
import { MDocument } from "@mastra/rag";

let ftsReady: boolean | null = null;

export function migrateKnowledgeIndex(): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts
      USING fts5(chunk_id UNINDEXED, content, tokenize='trigram')
    `);
    ftsReady = true;
  } catch {
    // Older SQLite builds may not ship the optional trigram tokenizer.
    // Retrieval still works through a bounded LIKE fallback.
    ftsReady = false;
  }
}

export async function indexKnowledgeDocument(input: {
  documentId: string;
  knowledgeBaseId: string;
  title: string;
  mimeType: string;
  content: string;
}): Promise<number> {
  try {
    removeDocumentIndex(input.documentId);
    const document = input.mimeType === "text/markdown"
      ? MDocument.fromMarkdown(input.content, { title: input.title })
      : MDocument.fromText(input.content, { title: input.title });
    const chunks = await document.chunk({
      strategy: input.mimeType === "text/markdown" ? "markdown" : "recursive",
      maxSize: 800,
      overlap: 80
    });
    const normalized = chunks
      .map((chunk, index) => ({
        index,
        text: String((chunk as unknown as { text?: unknown }).text ?? "").trim()
      }))
      .filter(chunk => chunk.text);
    if (!normalized.length) throw new Error("文档没有可索引的文本内容");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const chunk of normalized) {
        const id = makeId("chunk");
        insertKnowledgeChunk({
          id,
          documentId: input.documentId,
          knowledgeBaseId: input.knowledgeBaseId,
          chunkIndex: chunk.index,
          content: chunk.text,
          metadata: { title: input.title }
        });
        if (ensureFts()) {
          db.prepare("INSERT INTO knowledge_chunk_fts (chunk_id, content) VALUES (?, ?)")
            .run(id, `${input.title}\n${chunk.text}`);
        }
      }
      updateKnowledgeDocumentReady(input.documentId, normalized.length);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return normalized.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : "文档索引失败";
    updateKnowledgeDocumentError(input.documentId, message);
    throw error;
  }
}

export function searchKnowledge(input: {
  accountId: string;
  scopes: CapabilityScopeRef[];
  query: string;
  limit?: number;
  capabilityOverrides?: RuntimeCapabilityOverride[];
}): {
  bases: ReturnType<typeof resolveActiveKnowledgeBases>;
  matches: KnowledgeChunkSummary[];
  mode: "fts" | "like" | "none";
} {
  const bases = resolveActiveKnowledgeBases(
    input.accountId,
    input.scopes,
    input.capabilityOverrides ?? []
  ).filter(base =>
    base.documents.some(document => document.status === "ready" && document.chunkCount > 0)
  );
  if (!bases.length || !input.query.trim()) {
    return { bases, matches: [], mode: "none" };
  }
  const baseIds = bases.map(base => base.id);
  const limit = Math.max(1, Math.min(20, input.limit ?? 6));
  const ftsTerms = buildFtsTerms(input.query);
  if (ensureFts() && ftsTerms.length) {
    const placeholders = baseIds.map(() => "?").join(", ");
    try {
      const rows = db.prepare(`
        SELECT
          c.id,
          c.document_id,
          d.title,
          d.publisher,
          d.published_at,
          d.source_url,
          d.retrieved_at,
          c.knowledge_base_id,
          b.name AS knowledge_base_name,
          b.scope_type,
          b.scope_id,
          c.chunk_index,
          c.content,
          bm25(knowledge_chunk_fts) AS rank
        FROM knowledge_chunk_fts
        JOIN knowledge_chunk c ON c.id = knowledge_chunk_fts.chunk_id
        JOIN knowledge_document d ON d.id = c.document_id
        JOIN knowledge_base b ON b.id = c.knowledge_base_id
        WHERE knowledge_chunk_fts MATCH ?
          AND c.knowledge_base_id IN (${placeholders})
          AND d.status = 'ready'
        ORDER BY rank, c.chunk_index
        LIMIT ?
      `).all(ftsTerms.join(" OR "), ...baseIds, limit) as Array<Record<string, unknown>>;
      if (rows.length) {
        return { bases, matches: rows.map(mapKnowledgeMatch), mode: "fts" };
      }
    } catch {
      // Fall through to LIKE search when a tokenizer or MATCH expression fails.
    }
  }
  const fallbackTerms = buildFallbackTerms(input.query);
  if (!fallbackTerms.length) return { bases, matches: [], mode: "none" };
  const placeholders = baseIds.map(() => "?").join(", ");
  const likeClause = fallbackTerms.map(() => "(c.content LIKE ? OR d.title LIKE ?)").join(" OR ");
  const likeValues = fallbackTerms.flatMap(term => [`%${term}%`, `%${term}%`]);
  const rows = db.prepare(`
    SELECT
      c.id,
      c.document_id,
      d.title,
      d.publisher,
      d.published_at,
      d.source_url,
      d.retrieved_at,
      c.knowledge_base_id,
      b.name AS knowledge_base_name,
      b.scope_type,
      b.scope_id,
      c.chunk_index,
      c.content
    FROM knowledge_chunk c
    JOIN knowledge_document d ON d.id = c.document_id
    JOIN knowledge_base b ON b.id = c.knowledge_base_id
    WHERE c.knowledge_base_id IN (${placeholders})
      AND d.status = 'ready'
      AND (${likeClause})
    ORDER BY b.updated_at DESC, c.chunk_index
    LIMIT ?
  `).all(...baseIds, ...likeValues, limit) as Array<Record<string, unknown>>;
  return { bases, matches: rows.map(mapKnowledgeMatch), mode: rows.length ? "like" : "none" };
}

export function removeDocumentIndex(documentId: string): void {
  if (ensureFts()) {
    db.prepare(`
      DELETE FROM knowledge_chunk_fts
      WHERE chunk_id IN (SELECT id FROM knowledge_chunk WHERE document_id = ?)
    `).run(documentId);
  }
  db.prepare("DELETE FROM knowledge_chunk WHERE document_id = ?").run(documentId);
}

export function validateKnowledgeBase(knowledgeBaseId: string): void {
  if (!getKnowledgeBase(knowledgeBaseId)) throw new Error("未找到知识库");
}

export function validateKnowledgeDocument(documentId: string): {
  documentId: string;
  knowledgeBaseId: string;
  title: string;
  mimeType: string;
  content: string;
} {
  const summary = getKnowledgeDocument(documentId);
  if (!summary) throw new Error("未找到知识文档");
  const row = db.prepare("SELECT content FROM knowledge_document WHERE id = ?").get(documentId) as
    | { content: string }
    | undefined;
  if (!row) throw new Error("未找到知识文档内容");
  return {
    documentId,
    knowledgeBaseId: summary.knowledgeBaseId,
    title: summary.title,
    mimeType: summary.mimeType,
    content: row.content
  };
}

function ensureFts(): boolean {
  if (ftsReady === null) migrateKnowledgeIndex();
  return Boolean(ftsReady);
}

function buildFtsTerms(query: string): string[] {
  const terms = new Set<string>();
  const runs = query
    .normalize("NFKC")
    .match(/[\p{Script=Han}]{2,}|[A-Za-z0-9][A-Za-z0-9_-]{1,}/gu) ?? [];
  for (const run of runs) {
    if (/^[\p{Script=Han}]+$/u.test(run)) {
      if (run.length <= 8) {
        for (let index = 0; index <= run.length - 3; index += 1) terms.add(`"${run.slice(index, index + 3)}"`);
      } else {
        for (let index = 0; index <= run.length - 3; index += 2) terms.add(`"${run.slice(index, index + 3)}"`);
      }
    } else {
      terms.add(`"${run.replaceAll('"', '""')}"`);
    }
    if (terms.size >= 18) break;
  }
  return [...terms].slice(0, 18);
}

function buildFallbackTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const terms = new Set<string>();
  for (const part of normalized.split(/[^\p{L}\p{N}_-]+/u)) {
    const text = part.trim();
    if (text.length < 2) continue;
    terms.add(text.slice(0, 24));
    if (/^[\p{Script=Han}]+$/u.test(text) && text.length > 6) {
      for (let index = 0; index < Math.min(text.length - 3, 12); index += 3) {
        terms.add(text.slice(index, index + 4));
      }
    }
  }
  return [...terms].slice(0, 6);
}

function mapKnowledgeMatch(row: Record<string, unknown>): KnowledgeChunkSummary {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    documentTitle: String(row.title),
    publisher: row.publisher ? String(row.publisher) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    retrievedAt: row.retrieved_at ? String(row.retrieved_at) : null,
    knowledgeBaseId: String(row.knowledge_base_id),
    knowledgeBaseName: String(row.knowledge_base_name),
    scopeType: String(row.scope_type) as KnowledgeChunkSummary["scopeType"],
    scopeId: String(row.scope_id),
    chunkIndex: Number(row.chunk_index),
    content: String(row.content)
  };
}
