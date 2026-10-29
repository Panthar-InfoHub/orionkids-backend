import { prisma } from "../src/lib/prisma.js";

async function main() {
  const result = await prisma.$queryRaw<
    any[]
  >`SELECT 1 as num, current_database()::text as db, current_user::text as user`;
  console.log("✅ Neon DB connection via prisma successful:", result[0]);
}

main()
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
