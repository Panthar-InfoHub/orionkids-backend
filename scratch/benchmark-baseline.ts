import { performance } from "node:perf_hooks";
import { prisma } from "../src/lib/prisma.js";
import { getCurrentUserProfile } from "../src/services/me.service.js";
import {
  listChildren,
  getChildProfile,
  getChildProgress,
  getChildQuestSessions,
  getChildReports,
} from "../src/services/child.service.js";
import {
  getAdminOverview,
  listUsers,
  getUserDetail,
  getUserChildren,
  getUserQuestSessions,
  getUserQuestSessionDetail,
  getUserSessionAttempts,
  getUserSessionReport,
} from "../src/services/admin.service.js";
import {
  generateOrGetReport,
  getCurrentSession,
  getResumeState,
} from "../src/services/quest.service.js";

async function measure<T>(name: string, fn: () => Promise<T>, runs = 3): Promise<{ name: string; avgMs: number; minMs: number; maxMs: number; payloadBytes: number }> {
  // Warmup run
  const firstRes = await fn();
  const payloadBytes = Buffer.byteLength(JSON.stringify(firstRes ?? {}));

  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const avgMs = Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
  const minMs = Math.round(times[0] * 10) / 10;
  const maxMs = Math.round(times[times.length - 1] * 10) / 10;

  return { name, avgMs, minMs, maxMs, payloadBytes };
}

async function runBenchmark() {
  console.log("=== ORIONKIDS BACKEND PERFORMANCE BENCHMARK ===");

  // Find sample test entities
  const sampleUser = await prisma.user.findFirst({
    where: {
      childProfiles: { some: {} },
      questSessions: { some: {} },
    },
    include: {
      childProfiles: true,
      questSessions: {
        include: {
          levelAttempts: true,
          questReport: true,
        },
      },
    },
  });

  if (!sampleUser) {
    console.error("No sample user with child profiles and quest sessions found.");
    return;
  }

  const userId = sampleUser.id;
  const childId = sampleUser.childProfiles[0]?.id;
  const completedSession = sampleUser.questSessions.find((s) => s.status === "COMPLETED") || sampleUser.questSessions[0];
  const sessionId = completedSession?.id;

  console.log(`Using sample user: ${userId}`);
  console.log(`Using sample child: ${childId}`);
  console.log(`Using sample session: ${sessionId} (status: ${completedSession?.status})`);
  console.log(`Total sessions for user: ${sampleUser.questSessions.length}`);

  const results: any[] = [];

  // 1. Parent Overview / Me
  results.push(await measure("Parent Profile (getCurrentUserProfile)", () => getCurrentUserProfile(userId)));

  // 2. Child Profiles List
  results.push(await measure("Child Profiles List (listChildren)", () => listChildren(userId)));

  // 3. Child Profile Single
  if (childId) {
    results.push(await measure("Child Profile Single (getChildProfile)", () => getChildProfile(userId, childId)));
    results.push(await measure("Child Progress Matrix (getChildProgress)", () => getChildProgress(userId, childId)));
    results.push(await measure("Child Quest Sessions (getChildQuestSessions)", () => getChildQuestSessions(userId, childId)));
    results.push(await measure("Child Reports (getChildReports)", () => getChildReports(userId, childId)));
  }

  // 4. Admin Overview & Dashboard
  results.push(await measure("Admin Overview (getAdminOverview)", () => getAdminOverview()));
  results.push(await measure("Admin Users List (listUsers)", () => listUsers({ page: 1, limit: 10 })));
  results.push(await measure("Admin User Detail 360 (getUserDetail)", () => getUserDetail(userId)));
  results.push(await measure("Admin User Children (getUserChildren)", () => getUserChildren(userId)));

  // 5. Quest Sessions & Details
  results.push(await measure("Admin Quest Sessions List (getUserQuestSessions)", () => getUserQuestSessions(userId, { page: 1, limit: 10 })));
  if (sessionId) {
    results.push(await measure("Quest Session Detail (getUserQuestSessionDetail)", () => getUserQuestSessionDetail(userId, sessionId)));
    results.push(await measure("Quest Session Telemetry (getUserSessionAttempts)", () => getUserSessionAttempts(userId, sessionId, { page: 1, limit: 20 })));
    results.push(await measure("Quest Session Report (getUserSessionReport)", () => getUserSessionReport(userId, sessionId)));
    if (completedSession.status === "COMPLETED") {
      results.push(await measure("Quest Report Generate/Fetch (generateOrGetReport)", () => generateOrGetReport(userId, sessionId)));
    }
  }

  // 6. Resume State
  results.push(await measure("Quest Resume State (getResumeState)", () => getResumeState(userId, childId)));

  console.log("\n--- BENCHMARK RESULTS ---");
  console.table(results);

  await prisma.$disconnect();
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

