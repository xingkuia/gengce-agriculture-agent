import { resolve } from "node:path";

async function main(): Promise<void> {
  const databaseArgument = process.argv[2];
  if (databaseArgument) process.env.DATABASE_PATH = resolve(databaseArgument);

  const { db, migrateDatabase, seedDatabase } = await import("../server/db.js");
  const { migrateFarmManagement } = await import("../server/farms.js");
  const { migrateCapabilityPlane } = await import("../server/capabilities-store.js");
  const { migrateKnowledgeIndex } = await import("../server/knowledge.js");
  const { seedPublicGuidance } = await import("../server/public-guidance-seed.js");

  try {
    migrateDatabase();
    seedDatabase();
    migrateFarmManagement();
    migrateCapabilityPlane();
    migrateKnowledgeIndex();
    const result = seedPublicGuidance();
    console.log(JSON.stringify(result));
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
