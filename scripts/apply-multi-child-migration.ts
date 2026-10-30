import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const migrationName = "20261029143000_multi_child_support";
  const migrationDir = path.resolve(
    process.cwd(),
    `prisma/migrations/${migrationName}`
  );
  const sqlFile = path.join(migrationDir, "migration.sql");

  if (!fs.existsSync(sqlFile)) {
    throw new Error(`Migration SQL file not found at: ${sqlFile}`);
  }

  const sql = fs.readFileSync(sqlFile, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");

  // Check if already applied
  const existing = await prisma.$queryRaw<any[]>`
    SELECT id FROM _prisma_migrations WHERE migration_name = ${migrationName}
  `;

  if (existing.length > 0) {
    console.log(`ℹ️ Migration "${migrationName}" is already applied.`);
    return;
  }

  console.log(`🚀 Applying migration "${migrationName}" to PostgreSQL...`);

  const startTime = new Date();
  const migrationId = crypto.randomUUID();

  // Execute migration SQL
  await prisma.$executeRawUnsafe(sql);

  await prisma.$executeRaw`
    INSERT INTO _prisma_migrations (
      id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
    ) VALUES (
      ${migrationId},
      ${checksum},
      NOW(),
      ${migrationName},
      NULL,
      NULL,
      ${startTime},
      1
    )
  `;

  console.log(`✅ Successfully applied migration "${migrationName}"!`);
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
