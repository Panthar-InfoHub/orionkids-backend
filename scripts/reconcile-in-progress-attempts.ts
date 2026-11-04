import { prisma } from "../src/lib/prisma.js";
import { computeSessionProgression } from "../src/services/quest.service.js";

async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(
    `\n🔍 [OrionKids In-Progress Attempt Reconciliation] Mode: ${isApply ? "MUTATING (--apply)" : "DRY RUN (read-only)"}\n`
  );

  // 1. Find all in-progress attempts across database
  const inProgressAttempts = await prisma.levelAttempt.findMany({
    where: { status: "IN_PROGRESS" },
    include: {
      questSession: {
        select: {
          id: true,
          status: true,
          currentStage: true,
          currentGame: true,
          currentLevel: true,
          userId: true,
          childProfileId: true,
        },
      },
    },
  });

  console.log(
    `📊 Total IN_PROGRESS level attempt rows in DB: ${inProgressAttempts.length}`
  );

  // 2. Fetch all completed attempts in those sessions
  const sessionIds = Array.from(
    new Set(inProgressAttempts.map((a) => a.questSessionId))
  );
  const completedAttempts = await prisma.levelAttempt.findMany({
    where: {
      questSessionId: { in: sessionIds },
      status: "COMPLETED",
    },
    select: {
      questSessionId: true,
      gameKey: true,
      levelNumber: true,
    },
  });

  const completedSet = new Set(
    completedAttempts.map(
      (c) => `${c.questSessionId}:${c.gameKey}:${c.levelNumber}`
    )
  );

  // Filter orphaned attempts:
  // - Session itself is COMPLETED, OR
  // - Level in this session already has a COMPLETED attempt
  const attemptsToAbandon = inProgressAttempts.filter((a) => {
    const isSessionCompleted = a.questSession.status === "COMPLETED";
    const isLevelAlreadyCompleted = completedSet.has(
      `${a.questSessionId}:${a.gameKey}:${a.levelNumber}`
    );
    return isSessionCompleted || isLevelAlreadyCompleted;
  });

  console.log(
    `🧹 Stale/Orphaned IN_PROGRESS attempts that should be ABANDONED: ${attemptsToAbandon.length}`
  );

  // 3. Check for sessions that are IN_PROGRESS but actually completed all 18 levels
  const inProgressSessions = await prisma.questSession.findMany({
    where: { status: "IN_PROGRESS" },
    include: {
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: { gameKey: true, levelNumber: true },
      },
    },
  });

  const sessionsToComplete: string[] = [];
  for (const s of inProgressSessions) {
    const prog = computeSessionProgression(s, s.levelAttempts);
    if (prog.isQuestComplete || prog.highestCompletedIndex >= 18) {
      sessionsToComplete.push(s.id);
    }
  }

  console.log(
    `🎯 IN_PROGRESS sessions with 18 completed levels that should be marked COMPLETED: ${sessionsToComplete.length}`
  );

  if (!isApply) {
    console.log(`\n💡 To apply these changes, run:`);
    console.log(
      `   npx tsx scripts/reconcile-in-progress-attempts.ts --apply\n`
    );
    return;
  }

  // Mutate:
  if (attemptsToAbandon.length > 0) {
    const idsToAbandon = attemptsToAbandon.map((a) => a.id);
    const updateResult = await prisma.levelAttempt.updateMany({
      where: { id: { in: idsToAbandon } },
      data: { status: "ABANDONED" },
    });
    console.log(
      `✅ Marked ${updateResult.count} orphaned level attempt(s) as ABANDONED.`
    );
  }

  if (sessionsToComplete.length > 0) {
    for (const sId of sessionsToComplete) {
      await prisma.questSession.update({
        where: { id: sId },
        data: {
          status: "COMPLETED",
          currentStage: "COMPLETED",
          currentGame: 6,
          currentLevel: 3,
          completedAt: new Date(),
        },
      });
      // Also abandon any remaining in_progress attempts in this session
      await prisma.levelAttempt.updateMany({
        where: { questSessionId: sId, status: "IN_PROGRESS" },
        data: { status: "ABANDONED" },
      });
    }
    console.log(
      `✅ Marked ${sessionsToComplete.length} session(s) as COMPLETED.`
    );
  }

  console.log("\n🎉 Reconciliation completed successfully!");
}

main()
  .catch((err) => {
    console.error("❌ Reconciliation failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
