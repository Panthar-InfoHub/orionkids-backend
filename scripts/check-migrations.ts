import { prisma } from "../src/lib/prisma.js";

async function main() {
  const rows = await prisma.$queryRaw<
    any[]
  >`SELECT id, migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`;
  console.log("Current applied migrations in _prisma_migrations:", rows);
}

main()
  .catch((err) => {
    console.error("Query failed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
