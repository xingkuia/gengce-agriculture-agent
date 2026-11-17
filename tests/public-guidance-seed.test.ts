import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("official Hubei guidance is seeded once and remains searchable", async () => {
  const folder = await mkdtemp(join(tmpdir(), "gengce-public-guidance-"));
  process.env.DATABASE_PATH = join(folder, "test.db");

  const { db, migrateDatabase, seedDatabase } = await import("../server/db.js");
  const { migrateKnowledgeIndex, searchKnowledge } = await import("../server/knowledge.js");
  const { deleteKnowledgeBase, resolveScopes } = await import("../server/capabilities-store.js");
  const { migrateFarmManagement } = await import("../server/farms.js");
  const { seedPublicGuidance } = await import("../server/public-guidance-seed.js");

  migrateDatabase();
  seedDatabase();
  migrateFarmManagement();
  migrateKnowledgeIndex();

  const first = seedPublicGuidance();
  assert.equal(first.accounts, 1);
  assert.equal(first.seededAccounts, 1);
  assert.equal(first.documents, 7);
  assert.ok(first.chunks >= 14);

  const second = seedPublicGuidance();
  assert.equal(second.seededAccounts, 0);
  assert.equal(second.documents, 0);
  assert.equal(second.chunks, 0);

  const document = db.prepare(`
    SELECT title, publisher, published_at, source_url
    FROM knowledge_document
    WHERE knowledge_base_id = 'kb-public-hubei-guidance-acct-demo'
    ORDER BY title
    LIMIT 1
  `).get() as {
    title: string;
    publisher: string;
    published_at: string;
    source_url: string;
  };
  assert.ok(document.title.includes("湖北") || document.title.includes("小麦"));
  assert.match(document.publisher, /湖北省/);
  assert.match(document.published_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(document.source_url, /^https:\/\/nyt\.hubei\.gov\.cn\//);

  const scopes = resolveScopes("acct-demo", null, null);
  const retrieval = searchKnowledge({
    accountId: "acct-demo",
    scopes: scopes.scopes,
    query: "冬小麦 氮肥 配方",
    limit: 5
  });
  assert.ok(retrieval.matches.length > 0);
  assert.ok(retrieval.matches.some(match => match.sourceUrl?.includes("nyt.hubei.gov.cn")));
  assert.ok(retrieval.matches.some(match => match.publisher?.includes("湖北省")));

  deleteKnowledgeBase("kb-public-hubei-guidance-acct-demo");
  const afterDelete = seedPublicGuidance();
  assert.equal(afterDelete.seededAccounts, 0);
  const baseCount = db.prepare(
    "SELECT COUNT(*) AS count FROM knowledge_base WHERE id = 'kb-public-hubei-guidance-acct-demo'"
  ).get() as { count: number };
  assert.equal(baseCount.count, 0);

  db.close();
});
