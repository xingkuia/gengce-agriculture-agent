import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const source = process.argv[2];
const target = process.argv[3];

if (!source || !target) {
  console.error("Usage: node scripts/sqlite-backup.mjs <source-db> <target-db>");
  process.exit(1);
}

const sourcePath = resolve(source);
const targetPath = resolve(target);
const db = new DatabaseSync(sourcePath);
try {
  db.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

console.log(JSON.stringify({ source: sourcePath, target: targetPath }));
