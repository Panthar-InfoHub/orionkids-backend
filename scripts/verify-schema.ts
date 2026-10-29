import { prisma } from "../src/lib/prisma.js";

async function main() {
  const sessionCount = await prisma.questSession.count();
  const attemptCount = await prisma.levelAttempt.count();
  const reportCount = await prisma.questReport.count();
  const warmUpCount = await prisma.warmUpSubmission.count();
  console.log("✅ Tables verified successfully in PostgreSQL:");
  console.log({ sessionCount, attemptCount, reportCount, warmUpCount });
}

main()
  .catch((err) => {
    console.error("Verification error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
