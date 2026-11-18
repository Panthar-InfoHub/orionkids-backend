import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, disconnectPrisma } from "../src/lib/prisma.js";
import {
  generateOrGetReport,
  type AssessmentStatus,
} from "../src/services/quest.service.js";
import {
  AiStructuredReportSchema,
  generateRuleBasedReport,
  type GameplayReportInput,
} from "../src/services/aiReport.service.js";
import { CANONICAL_GAMES } from "../src/config/games.js";

function createMockInput(overrides: Partial<GameplayReportInput> = {}): GameplayReportInput {
  return {
    child: {
      childName: "Arjun Sharma",
      age: 9,
      selectedClass: "Class 4",
      school: "The Heritage School",
      ...overrides.child,
    },
    quest: {
      sessionId: `test_chrono_session_${Date.now()}`,
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt: new Date().toISOString(),
      totalLevelsCompleted: 18,
      overallAccuracy: 88,
      totalDurationMs: 900000,
      activeGameplayDurationMs: 900000,
      hasBreaks: false,
      sessionDurationMinutes: 15,
      isProlongedSession: false,
      ...overrides.quest,
    },
    warmUp: {
      copingStrategy: "take a deep breath",
      learningStyle: "hands-on exploration",
      favoriteSubject: "science",
      emotionalState: "enthusiastic",
      ...overrides.warmUp,
    },
    games:
      overrides.games ||
      CANONICAL_GAMES.map((cg, idx) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 90,
        averageReactionTimeMs: 1200,
        playOrder: idx + 1,
        isFirstGame: idx === 0,
        isLastGame: idx === CANONICAL_GAMES.length - 1,
        firstAttemptAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
        lastAttemptAt: new Date(Date.now() - (6 - idx) * 120000 + 60000).toISOString(),
        activeDurationMs: 60000,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 9,
          accuracy: 90,
          durationMs: 20000,
          averageReactionTimeMs: 1200,
          startedAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
          completedAt: new Date(Date.now() - (6 - idx) * 120000 + 20000).toISOString(),
        })),
      })),
    chronology: overrides.chronology,
  };
}

describe("Phase 2: Chronological Game Analysis & Fatigue-Aware Interpretation Test Suite", () => {
  const testUserId = `test_chrono_user_${Date.now()}`;
  let childProfileId = "";

  before(async () => {
    await prisma.user.create({
      data: {
        id: testUserId,
        name: "Test Parent Chronology",
        email: `${testUserId}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    const child = await prisma.childProfile.create({
      data: {
        userId: testUserId,
        childName: "Arjun",
        age: 9,
        language: "English",
        selectedClass: "Class 4",
        school: "The Heritage School",
        parentEmail: `${testUserId}@example.com`,
        parentMobile: "9876543211",
        isGuardian: true,
      },
    });
    childProfileId = child.id;
  });

  after(async () => {
    try {
      await prisma.questReport.deleteMany({ where: { userId: testUserId } });
      await prisma.levelAttempt.deleteMany({ where: { userId: testUserId } });
      await prisma.warmUpSubmission.deleteMany({ where: { userId: testUserId } });
      await prisma.questSession.deleteMany({ where: { userId: testUserId } });
      await prisma.childProfile.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    } catch {
      // Ignore cleanup errors
    } finally {
      await disconnectPrisma();
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Short session with stable performance (15 min, 90% throughout)
  // ---------------------------------------------------------------------------
  it("Scenario 1: Short session with stable performance -> no fatigue mentioned, strengths identified", async () => {
    const input = createMockInput({
      quest: {
        sessionId: `test_s1_${Date.now()}`,
        startedAt: new Date(Date.now() - 15 * 60000).toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 90,
        totalDurationMs: 15 * 60000,
        activeGameplayDurationMs: 14 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 15,
        isProlongedSession: false,
      },
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Verify no fatigue diagnosis or fatigue language
    const fullReportText = JSON.stringify(report).toLowerCase();
    assert.ok(!fullReportText.includes("fatigue-related accuracy drops"));
    assert.ok(!fullReportText.includes("fatigue score"));
    assert.ok(!fullReportText.includes("suffers from fatigue"));
    assert.ok(!fullReportText.includes("adhd"));

    // Verify strengths are identified
    assert.ok(report.observedStrengths.length >= 3);
    assert.ok(report.progressAndConsistency.includes("well-paced 15-minute session"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Long session with stable performance (60 min, 90% throughout)
  // ---------------------------------------------------------------------------
  it("Scenario 2: Long session with stable performance -> praises stamina, NO fatigue invented", async () => {
    const input = createMockInput({
      quest: {
        sessionId: `test_s2_${Date.now()}`,
        startedAt: new Date(Date.now() - 60 * 60000).toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 90,
        totalDurationMs: 60 * 60000,
        activeGameplayDurationMs: 50 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 60,
        isProlongedSession: true,
      },
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Verify stamina and focus are praised
    assert.ok(
      report.progressAndConsistency.includes("stamina") ||
      report.progressAndConsistency.includes("task persistence")
    );
    assert.ok(report.overallPerformanceSummary.includes("stamina"));

    // Verify NO fatigue is invented
    const fullReportText = JSON.stringify(report).toLowerCase();
    assert.ok(!fullReportText.includes("fatigue score"));
    assert.ok(!fullReportText.includes("suffers from fatigue"));
    assert.ok(!fullReportText.includes("tiredness after sustained focus"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Long session with lower accuracy in a late game
  // (55 min, Games 1–5 @ 90%, Game 6 @ 55%)
  // ---------------------------------------------------------------------------
  it("Scenario 3: Long session with late game drop -> fatigue-aware framing, NOT labeled a deficit", async () => {
    const games = CANONICAL_GAMES.map((cg, idx) => {
      const isLast = idx === CANONICAL_GAMES.length - 1;
      const acc = isLast ? 55 : 90;
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: acc,
        averageReactionTimeMs: 1200,
        playOrder: idx + 1,
        isFirstGame: idx === 0,
        isLastGame: isLast,
        firstAttemptAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
        lastAttemptAt: new Date(Date.now() - (6 - idx) * 120000 + 60000).toISOString(),
        activeDurationMs: 60000,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: Math.round(10 * (acc / 100)),
          accuracy: acc,
          durationMs: 20000,
          averageReactionTimeMs: 1200,
          startedAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
          completedAt: new Date(Date.now() - (6 - idx) * 120000 + 20000).toISOString(),
        })),
      };
    });

    const input = createMockInput({
      quest: {
        sessionId: `test_s3_${Date.now()}`,
        startedAt: new Date(Date.now() - 55 * 60000).toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 84,
        totalDurationMs: 55 * 60000,
        activeGameplayDurationMs: 45 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 55,
        isProlongedSession: true,
      },
      games,
      chronology: {
        gameplayOrder: games.map((g) => ({
          gameKey: g.gameKey,
          gameName: g.gameName,
          playOrder: g.playOrder,
          assessmentStatus: "ASSESSED",
          averageAccuracy: g.averageAccuracy,
          activeDurationMs: g.activeDurationMs,
          firstAttemptAt: g.firstAttemptAt,
          lastAttemptAt: g.lastAttemptAt,
        })),
        firstGamePlayed: games[0]!.gameName,
        lastGamePlayed: games[games.length - 1]!.gameName,
        wallClockDurationMinutes: 55,
        activeGameplayDurationMinutes: 45,
        isLateGameFatigueContext: true,
        isLateGameExitContext: false,
      },
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Verify concluding game summary includes fatigue-aware contextual observation
    const lastGameAnalysis = report.gameWiseAnalysis.find(
      (g) => g.gameKey === CANONICAL_GAMES[CANONICAL_GAMES.length - 1]!.key
    );
    assert.ok(lastGameAnalysis);
    assert.ok(lastGameAnalysis.summary.includes("extended 55-minute quest session"));
    assert.ok(lastGameAnalysis.summary.includes("natural tiredness"));

    // Verify areas for practice frames it as gentle practice, revisit when fresh
    const practiceArea = report.areasForPractice.find((a) =>
      a.heading.includes("Revisit When Fresh")
    );
    assert.ok(practiceArea, "Must contain a practice area advising revisit when fresh");
    assert.ok(practiceArea.observedPattern.includes("sustained mental effort"));
    assert.ok(!practiceArea.heading.toLowerCase().includes("weakness"));

    // Verify non-clinical
    const fullText = JSON.stringify(report).toLowerCase();
    assert.ok(!fullText.includes("adhd"));
    assert.ok(!fullText.includes("fatigue score"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Long session with a skipped final game (50 min, Game 6 skipped)
  // ---------------------------------------------------------------------------
  it("Scenario 4: Long session with skipped final game -> concludes naturally without diagnosing fatigue", async () => {
    const games = CANONICAL_GAMES.map((cg, idx) => {
      const isLast = idx === CANONICAL_GAMES.length - 1;
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: isLast ? "SKIPPED" : "ASSESSED",
        gameStatus: isLast ? "SKIPPED" : "COMPLETED",
        levelsCompleted: isLast ? 0 : 3,
        averageAccuracy: isLast ? null : 90,
        averageReactionTimeMs: isLast ? null : 1200,
        playOrder: idx + 1,
        isFirstGame: idx === 0,
        isLastGame: isLast,
        firstAttemptAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
        lastAttemptAt: new Date(Date.now() - (6 - idx) * 120000 + 60000).toISOString(),
        activeDurationMs: isLast ? 0 : 60000,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: isLast ? "SKIPPED" : "COMPLETED",
          totalTrials: isLast ? null : 10,
          correctTrials: isLast ? null : 9,
          accuracy: isLast ? null : 90,
          durationMs: isLast ? null : 20000,
          averageReactionTimeMs: isLast ? null : 1200,
          startedAt: isLast ? null : new Date(Date.now() - (6 - idx) * 120000).toISOString(),
          completedAt: isLast ? null : new Date(Date.now() - (6 - idx) * 120000 + 20000).toISOString(),
        })),
      };
    });

    const input = createMockInput({
      quest: {
        sessionId: `test_s4_${Date.now()}`,
        startedAt: new Date(Date.now() - 50 * 60000).toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 15,
        overallAccuracy: 90,
        totalDurationMs: 50 * 60000,
        activeGameplayDurationMs: 40 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 50,
        isProlongedSession: true,
      },
      games,
      chronology: {
        gameplayOrder: games.map((g) => ({
          gameKey: g.gameKey,
          gameName: g.gameName,
          playOrder: g.playOrder,
          assessmentStatus: g.assessmentStatus,
          averageAccuracy: g.averageAccuracy,
          activeDurationMs: g.activeDurationMs,
          firstAttemptAt: g.firstAttemptAt,
          lastAttemptAt: g.lastAttemptAt,
        })),
        firstGamePlayed: games[0]!.gameName,
        lastGamePlayed: games[games.length - 1]!.gameName,
        wallClockDurationMinutes: 50,
        activeGameplayDurationMinutes: 40,
        isLateGameFatigueContext: false,
        isLateGameExitContext: true,
      },
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Concluding game summary notes natural response to sustained mental effort
    const lastGame = report.gameWiseAnalysis.find(
      (g) => g.gameKey === CANONICAL_GAMES[CANONICAL_GAMES.length - 1]!.key
    );
    assert.ok(lastGame);
    assert.equal(lastGame.assessmentStatus, "SKIPPED");
    assert.equal(lastGame.averageAccuracy, null);
    assert.ok(lastGame.summary.includes("extended 50-minute quest session"));
    assert.ok(lastGame.summary.includes("sustained mental effort"));

    // Skipped game must not be in superpowers or practice areas
    for (const str of report.observedStrengths) {
      assert.ok(!str.cognitiveSkill.includes(lastGame.cognitiveDomain));
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Partial assessment near the end of a session
  // (50 min, Game 6 partially assessed: 1/3 levels completed)
  // ---------------------------------------------------------------------------
  it("Scenario 5: Partial assessment near end of session -> describes completed levels and context neutrally", async () => {
    const games = CANONICAL_GAMES.map((cg, idx) => {
      const isLast = idx === CANONICAL_GAMES.length - 1;
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: isLast ? "PARTIALLY_ASSESSED" : "ASSESSED",
        gameStatus: isLast ? "IN_PROGRESS" : "COMPLETED",
        levelsCompleted: isLast ? 1 : 3,
        averageAccuracy: isLast ? 85 : 90,
        averageReactionTimeMs: 1200,
        playOrder: idx + 1,
        isFirstGame: idx === 0,
        isLastGame: isLast,
        firstAttemptAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
        lastAttemptAt: new Date(Date.now() - (6 - idx) * 120000 + 60000).toISOString(),
        activeDurationMs: 60000,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: isLast && lvl > 1 ? "SKIPPED" : "COMPLETED",
          totalTrials: isLast && lvl > 1 ? null : 10,
          correctTrials: isLast && lvl > 1 ? null : (isLast ? 8 : 9),
          accuracy: isLast && lvl > 1 ? null : (isLast ? 85 : 90),
          durationMs: isLast && lvl > 1 ? null : 20000,
          averageReactionTimeMs: isLast && lvl > 1 ? null : 1200,
          startedAt: isLast && lvl > 1 ? null : new Date(Date.now() - (6 - idx) * 120000).toISOString(),
          completedAt: isLast && lvl > 1 ? null : new Date(Date.now() - (6 - idx) * 120000 + 20000).toISOString(),
        })),
      };
    });

    const input = createMockInput({
      quest: {
        sessionId: `test_s5_${Date.now()}`,
        startedAt: new Date(Date.now() - 50 * 60000).toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 16,
        overallAccuracy: 89,
        totalDurationMs: 50 * 60000,
        activeGameplayDurationMs: 42 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 50,
        isProlongedSession: true,
      },
      games,
      chronology: {
        gameplayOrder: games.map((g) => ({
          gameKey: g.gameKey,
          gameName: g.gameName,
          playOrder: g.playOrder,
          assessmentStatus: g.assessmentStatus,
          averageAccuracy: g.averageAccuracy,
          activeDurationMs: g.activeDurationMs,
          firstAttemptAt: g.firstAttemptAt,
          lastAttemptAt: g.lastAttemptAt,
        })),
        firstGamePlayed: games[0]!.gameName,
        lastGamePlayed: games[games.length - 1]!.gameName,
        wallClockDurationMinutes: 50,
        activeGameplayDurationMinutes: 42,
        isLateGameFatigueContext: false,
        isLateGameExitContext: true,
      },
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    const lastGame = report.gameWiseAnalysis.find(
      (g) => g.gameKey === CANONICAL_GAMES[CANONICAL_GAMES.length - 1]!.key
    );
    assert.ok(lastGame);
    assert.equal(lastGame.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(lastGame.averageAccuracy, 85);
    assert.equal(lastGame.levelsCompleted, 1);
    assert.ok(lastGame.summary.includes("partially assessed"));
    assert.ok(lastGame.summary.includes("extended 50-minute quest session"));

    // Excluded from superpowers
    for (const str of report.observedStrengths) {
      assert.ok(!str.cognitiveSkill.includes(lastGame.cognitiveDomain));
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Missing timestamps gracefully handled
  // ---------------------------------------------------------------------------
  it("Scenario 6: Missing timestamps -> gracefully handled without runtime exceptions", () => {
    const input = createMockInput({
      games: CANONICAL_GAMES.map((cg, idx) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 85,
        averageReactionTimeMs: 1200,
        playOrder: null,
        isFirstGame: false,
        isLastGame: false,
        firstAttemptAt: null,
        lastAttemptAt: null,
        activeDurationMs: null,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 8,
          accuracy: 80,
          durationMs: null,
          averageReactionTimeMs: null,
          startedAt: null,
          completedAt: null,
        })),
      })),
    });

    // Must not crash
    assert.doesNotThrow(() => {
      const report = generateRuleBasedReport(input);
      const parsed = AiStructuredReportSchema.parse(report);
      assert.ok(parsed);
      assert.equal(report.gameWiseAnalysis.length, 6);
    });
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Missing game duration gracefully handled
  // ---------------------------------------------------------------------------
  it("Scenario 7: Missing game duration -> durationMs null handled gracefully without NaN", () => {
    const input = createMockInput({
      quest: {
        sessionId: `test_s7_${Date.now()}`,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 88,
        totalDurationMs: 0,
        activeGameplayDurationMs: null,
        hasBreaks: false,
        sessionDurationMinutes: 0,
        isProlongedSession: false,
      },
      games: CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 85,
        averageReactionTimeMs: null,
        playOrder: null,
        isFirstGame: false,
        isLastGame: false,
        firstAttemptAt: null,
        lastAttemptAt: null,
        activeDurationMs: null,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 8,
          accuracy: 80,
          durationMs: null,
          averageReactionTimeMs: null,
        })),
      })),
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Verify no "NaN" in report output
    const jsonStr = JSON.stringify(report);
    assert.ok(!jsonStr.includes("NaN"), "Report must not contain NaN");
    assert.ok(!jsonStr.includes("undefined minutes"), "Report must not contain undefined minutes");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Different game orders with identical scores
  // (Game 1 first vs Game 6 first via Prisma integration)
  // ---------------------------------------------------------------------------
  it("Scenario 8: Different game orders with identical scores -> playOrder derived from timestamps, not game IDs", async () => {
    // Session A: Played Game 1 first, Game 6 last
    const sessionA = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        startedAt: new Date("2026-11-16T10:00:00Z"),
        completedAt: new Date("2026-11-16T10:30:00Z"),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: sessionA.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date("2026-11-16T10:02:00Z"),
      },
    });

    // In Session A: Game 1 (Stroop) attempted at 10:05, Game 6 (Story) at 10:25
    for (let g = 1; g <= 6; g++) {
      const cg = CANONICAL_GAMES[g - 1]!;
      const attemptTime = new Date(Date.parse("2026-11-16T10:05:00Z") + (g - 1) * 4 * 60000);
      for (let lvl = 1; lvl <= 3; lvl++) {
        await prisma.levelAttempt.create({
          data: {
            questSessionId: sessionA.id,
            userId: testUserId,
            gameId: g,
            gameKey: cg.key,
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 10,
            correctTrials: 9,
            accuracy: 90.0,
            durationMs: 15000,
            averageReactionTimeMs: 1100,
            startedAt: attemptTime,
            completedAt: new Date(attemptTime.getTime() + 15000),
          },
        });
      }
    }

    const reportA = await generateOrGetReport(testUserId, sessionA.id, true, true);
    const summariesA = reportA.gameSummaries as Record<string, any>;

    assert.equal(summariesA["stroop"].isFirstGame, true);
    assert.equal(summariesA["stroop"].playOrder, 1);
    assert.equal(summariesA["story-sequencing"].isLastGame, true);
    assert.equal(summariesA["story-sequencing"].playOrder, 6);

    // Session B: Reverse chronological order! Game 6 (Story) attempted at 11:05, Game 1 (Stroop) at 11:25
    const sessionB = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        startedAt: new Date("2026-11-16T11:00:00Z"),
        completedAt: new Date("2026-11-16T11:30:00Z"),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: sessionB.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date("2026-11-16T11:02:00Z"),
      },
    });

    for (let g = 1; g <= 6; g++) {
      const cg = CANONICAL_GAMES[g - 1]!;
      // Reverse time: Game 6 gets earliest time, Game 1 gets latest time
      const reverseIdx = 6 - g;
      const attemptTime = new Date(Date.parse("2026-11-16T11:05:00Z") + reverseIdx * 4 * 60000);
      for (let lvl = 1; lvl <= 3; lvl++) {
        await prisma.levelAttempt.create({
          data: {
            questSessionId: sessionB.id,
            userId: testUserId,
            gameId: g,
            gameKey: cg.key,
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 10,
            correctTrials: 9,
            accuracy: 90.0,
            durationMs: 15000,
            averageReactionTimeMs: 1100,
            startedAt: attemptTime,
            completedAt: new Date(attemptTime.getTime() + 15000),
          },
        });
      }
    }

    const reportB = await generateOrGetReport(testUserId, sessionB.id, true, true);
    const summariesB = reportB.gameSummaries as Record<string, any>;

    // In Session B, Story Sequencing was played first!
    assert.equal(summariesB["story-sequencing"].isFirstGame, true, "Story Sequencing must be first game in Session B");
    assert.equal(summariesB["story-sequencing"].playOrder, 1);
    assert.equal(summariesB["stroop"].isLastGame, true, "Stroop must be last game in Session B");
    assert.equal(summariesB["stroop"].playOrder, 6);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Abandoned session
  // ---------------------------------------------------------------------------
  it("Scenario 9: Abandoned session -> report handles abandoned state gracefully", () => {
    const input = createMockInput({
      quest: {
        sessionId: `test_s9_${Date.now()}`,
        startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
        completedAt: null,
        totalLevelsCompleted: 3,
        overallAccuracy: 85,
        totalDurationMs: 20 * 60000,
        activeGameplayDurationMs: 6 * 60000,
        hasBreaks: false,
        sessionDurationMinutes: 20,
        isProlongedSession: false,
      },
      games: CANONICAL_GAMES.map((cg, idx) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: idx === 0 ? "ASSESSED" : "ABANDONED",
        gameStatus: idx === 0 ? "COMPLETED" : "ABANDONED",
        levelsCompleted: idx === 0 ? 3 : 0,
        averageAccuracy: idx === 0 ? 85 : null,
        averageReactionTimeMs: idx === 0 ? 1200 : null,
        playOrder: idx === 0 ? 1 : null,
        isFirstGame: idx === 0,
        isLastGame: false,
        firstAttemptAt: idx === 0 ? new Date().toISOString() : null,
        lastAttemptAt: idx === 0 ? new Date().toISOString() : null,
        activeDurationMs: idx === 0 ? 60000 : null,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: idx === 0 ? "COMPLETED" : "ABANDONED",
          totalTrials: idx === 0 ? 10 : null,
          correctTrials: idx === 0 ? 8 : null,
          accuracy: idx === 0 ? 85 : null,
          durationMs: idx === 0 ? 20000 : null,
          averageReactionTimeMs: idx === 0 ? 1200 : null,
        })),
      })),
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    const abandonedGame = report.gameWiseAnalysis.find((g) => g.gameKey === "pattern");
    assert.ok(abandonedGame);
    assert.equal(abandonedGame.assessmentStatus, "ABANDONED");
    assert.equal(abandonedGame.averageAccuracy, null);
    assert.ok(abandonedGame.summary.includes("did not complete all levels"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Deterministic fallback generates complete chronological report
  // ---------------------------------------------------------------------------
  it("Scenario 10: Deterministic fallback generator produces complete, schema-valid report", () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    assert.equal(report.gameWiseAnalysis.length, 6);
    assert.equal(report.levelWisePerformance.length, 18);
    assert.ok(report.observedStrengths.length >= 3);
    assert.ok(report.areasForPractice.length >= 2);
    assert.ok(report.parentRecommendations.length >= 4);
    assert.ok(report.overallPerformanceSummary.length > 50);
    assert.ok(report.questSummary.length > 20);
    assert.ok(report.dataLimitations.includes("not a clinical assessment"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Historical report compatibility
  // ---------------------------------------------------------------------------
  it("Scenario 11: Historical report without chronology fields parses without error", () => {
    const legacyReport = {
      reportTitle: "Legacy Report",
      childOverview: "A child overview",
      questSummary: "A quest summary",
      overallPerformanceSummary: "A performance summary",
      gameWiseAnalysis: CANONICAL_GAMES.map((cg) => ({
        gameKey: cg.key,
        gameName: cg.name,
        cognitiveDomain: cg.domain,
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 88,
        averageReactionTimeMs: 1200,
        summary: `Demonstrated good performance in ${cg.name}.`,
        observedStrengths: ["Consistent effort"],
        areasForPractice: [],
      })),
      levelWisePerformance: CANONICAL_GAMES.flatMap((cg) =>
        [1, 2, 3].map((lvl) => ({
          gameKey: cg.key,
          levelNumber: lvl,
          status: "COMPLETED",
          accuracy: 88,
          durationMs: 15000,
          averageReactionTimeMs: 1200,
          insight: `Completed Level ${lvl} successfully.`,
        }))
      ),
      observedStrengths: [
        {
          heading: "Great Focus",
          cognitiveSkill: "Focus & Impulse Control",
          observation: "Observed high focus throughout.",
          performanceEvidence: "88% accuracy across 3 levels.",
          educationalRelevance: "Supports classroom attention.",
        },
      ],
      areasForPractice: [
        {
          heading: "Playful Exploration",
          cognitiveSkill: "Pattern Recognition",
          observedPattern: "Varied on complex patterns.",
          performanceEvidence: "Recorded 80% on Level 3.",
          recommendedApproach: "Practice with blocks at home.",
        },
      ],
      progressAndConsistency: "Maintained steady pacing across activities.",
      parentRecommendations: [
        {
          title: "Block Building",
          skillsPracticed: ["Pattern Recognition"],
          materials: ["Blocks"],
          instructions: ["Step 1", "Step 2", "Step 3"],
          suggestedDuration: "10 minutes",
          learningOpportunity: "Pattern practice",
          parentTip: "Praise curiosity",
        },
      ],
      dataLimitations: "This is an educational summary and not a clinical diagnosis.",
      reportGenerationDate: new Date().toISOString(),
    };

    assert.doesNotThrow(() => {
      const parsed = AiStructuredReportSchema.parse(legacyReport);
      assert.ok(parsed);
    });
  });
});
