import { prisma } from "../src/lib/prisma.js";

/**
 * Diagnostic and Safe Reconciler for Legacy Stroop Sessions
 *
 * PURPOSE:
 * Audits quest sessions contaminated by the previous catch-up loop
 * (which created placeholder level attempts with totalTrials = 0 and metrics.autoAdvanced = true).
 *
 * SAFETY PRINCIPLES:
 * 1. Read-only audit by default (dry-run mode).
 * 2. Does NOT reset or mutate production data unless explicitly passed --apply.
 * 3. Never deletes legitimate user gameplay data.
 * 4. Reporting services already automatically filter out synthetic attempts at query time,
 *    so live metrics are protected even before running reconciliation.
 */
async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`\n🔍 [OrionKids Legacy Session Audit] Mode: ${isApply ? "MUTATING (--apply)" : "DRY RUN (read-only)"}\n`);

  // 1. Find all synthetic placeholder attempts
  const syntheticAttempts = await prisma.levelAttempt.findMany({
    where: {
      OR: [
        { totalTrials: 0 },
        { totalTrials: null, status: "COMPLETED" },
      ],
    },
    include: {
      questSession: {
        select: {
          id: true,
          userId: true,
          status: true,
          currentGame: true,
          currentLevel: true,
        },
      },
    },
  });

  const flagged = syntheticAttempts.filter((a) => {
    const metrics = (a.metrics as any) || {};
    return metrics.autoAdvanced === true || metrics.skippedByFrontend === true || a.totalTrials === 0;
  });

  console.log(`📊 Found ${flagged.length} synthetic level attempt(s) across database.`);

  if (flagged.length === 0) {
    console.log("✅ No contaminated sessions detected.");
    return;
  }

  const sessionIds = Array.from(new Set(flagged.map((a) => a.questSessionId)));
  console.log(`Found ${sessionIds.length} affected session(s):`);

  for (const sId of sessionIds) {
    const attempts = flagged.filter((a) => a.questSessionId === sId);
    console.log(` - Session ${sId}: ${attempts.length} placeholder attempt(s) for levels [${attempts.map((a) => `Game ${a.gameId} L${a.levelNumber}`).join(", ")}]`);
  }

  if (!isApply) {
    console.log(`\n💡 To archive/reconcile these synthetic attempts safely without deleting genuine records:`);
    console.log(`   run: npm run tsx scripts/reconcile-legacy-sessions.ts --apply\n`);
    return;
  }

  // Under explicit --apply mode:
  // Rather than deleting records, mark synthetic records as ABANDONED with audit metadata
  console.log("\n⚙️ Applying safe reconciliation: marking synthetic attempts as ABANDONED (non-destructive audit)...");

  for (const att of flagged) {
    await prisma.levelAttempt.update({
      where: { id: att.id },
      data: {
        status: "ABANDONED",
        metrics: {
          ...((att.metrics as any) || {}),
          reconciledAt: new Date().toISOString(),
          reconciledReason: "Audited placeholder from legacy catch-up loop",
        },
      },
    });
    console.log(`   Marked attempt ${att.id} as ABANDONED.`);
  }

  console.log("\n✅ Reconciliation complete. All synthetic records marked as ABANDONED.");
}

main()
  .catch((err) => {
    console.error("❌ Reconciliation failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
