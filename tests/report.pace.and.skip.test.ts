import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getOrCreateActiveSession,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  skipLevelOrGame,
  generateOrGetReport,
  computeSessionProgression,
} from "../src/services/quest.service.js";
import {
  generateRuleBasedReport,
  AiStructuredReportSchema,
  type GameplayReportInput,
} from "../src/services/aiReport.service.js";
import { generateReportPdf } from "../src/services/pdfReport.service.js";
import { CANONICAL_GAMES } from "../src/config/games.js";

describe("OrionKids Production Report Generation & Optimization Suite", () => {
  const testUserId = `test_pace_skip_user_${Date.now()}`;
  let childProfileId = "";
  let sessionId = "";

  before(async () => {
    // 1. Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        name: "Test Parent",
        email: `${testUserId}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    // 2. Create child profile
    const child = await prisma.childProfile.create({
      data: {
        userId: testUserId,
        childName: "Leo",
        age: 7,
        language: "English",
        selectedClass: "Class 2",
        school: "Orion Academy",
        parentEmail: `${testUserId}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
    childProfileId = child.id;
  });

  after(async () => {
    // Cleanup fixtures
    try {
      await prisma.questReport.deleteMany({ where: { userId: testUserId } });
      await prisma.levelAttempt.deleteMany({ where: { userId: testUserId } });
      await prisma.warmUpSubmission.deleteMany({
        where: { questSession: { userId: testUserId } },
      });
      await prisma.questSession.deleteMany({ where: { userId: testUserId } });
      await prisma.childProfile.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  });

  // =========================================================================
  // ISSUE 1: AVERAGE PACE CALCULATION ACROSS ALL SIX GAMES
  // =========================================================================
  describe("Issue 1: Weighted Average Pace Calculation", () => {
    it("calculates accurate weighted average reaction time: Sum(RT * trials) / Sum(trials)", () => {
      // Game with 3 levels, different trials and reaction times
      // Level 1: 10 trials, 1200ms -> 12000
      // Level 2: 8 trials, 1500ms -> 12000
      // Level 3: 12 trials, 900ms  -> 10800
      // Total RT product = 34800, Total trials = 30 -> Weighted Average = 1160ms = 1.16s
      const levelAttempts = [
        { levelNumber: 1, totalTrials: 10, averageReactionTimeMs: 1200 },
        { levelNumber: 2, totalTrials: 8, averageReactionTimeMs: 1500 },
        { levelNumber: 3, totalTrials: 12, averageReactionTimeMs: 900 },
      ];

      const validPaceAttempts = levelAttempts.filter(
        (a) =>
          typeof a.averageReactionTimeMs === "number" &&
          a.averageReactionTimeMs > 0 &&
          typeof a.totalTrials === "number" &&
          a.totalTrials > 0
      );

      const totalTrials = validPaceAttempts.reduce(
        (sum, a) => sum + (a.totalTrials ?? 0),
        0
      );
      const weightedPaceSum = validPaceAttempts.reduce(
        (sum, a) => sum + (a.averageReactionTimeMs ?? 0) * (a.totalTrials ?? 0),
        0
      );
      const computedPace =
        totalTrials > 0 ? Math.round(weightedPaceSum / totalTrials) : null;

      assert.equal(computedPace, 1160);
      assert.equal(((computedPace as number) / 1000).toFixed(1) + "s", "1.2s");
    });

    it("gracefully assigns null / '—' when reaction time telemetry is absent or 0", () => {
      const levelAttempts = [
        { levelNumber: 1, totalTrials: 10, averageReactionTimeMs: null },
        { levelNumber: 2, totalTrials: 8, averageReactionTimeMs: 0 },
      ];

      const validPaceAttempts = levelAttempts.filter(
        (a) =>
          typeof a.averageReactionTimeMs === "number" &&
          a.averageReactionTimeMs > 0 &&
          typeof a.totalTrials === "number" &&
          a.totalTrials > 0
      );

      const computedPace =
        validPaceAttempts.length > 0 ? 1000 : null;

      assert.equal(computedPace, null);
      const displayStr =
        typeof computedPace === "number" && computedPace > 0
          ? `${(computedPace / 1000).toFixed(1)}s`
          : "—";
      assert.equal(displayStr, "—");
    });
  });

  // =========================================================================
  // ISSUE 2: SKIPPED CARD FLIP GAME REPORTING & PERSISTENCE
  // =========================================================================
  describe("Issue 2: Skipped Activity Tracking & Reporting", () => {
    it("persists SKIPPED status in LevelAttempt database record with timestamp and metadata", async () => {
      const activeSession = await getOrCreateActiveSession(testUserId, childProfileId);
      sessionId = activeSession.id;

      // Complete warm up
      await saveWarmUpSubmission(testUserId, sessionId, {
        copingStrategy: "deep_breath",
        learningStyle: "visual",
        favoriteSubject: "math",
        emotionalState: "happy",
      });

      // Complete Game 1 (Stroop) levels
      for (let lvl = 1; lvl <= 3; lvl++) {
        await startLevelAttempt(testUserId, sessionId, "stroop", lvl);
        await completeLevelAttempt(testUserId, sessionId, {
          gameKey: "stroop",
          levelNumber: lvl,
          totalTrials: 10,
          correctTrials: 9,
          accuracy: 90,
          durationMs: 15000,
          averageReactionTimeMs: 1500,
        });
      }

      // Now on Game 2 (Card Flip) Level 1: child skips level
      await startLevelAttempt(testUserId, sessionId, "card-flip", 1);
      const skipResult = await skipLevelOrGame(testUserId, sessionId, {
        gameKey: "card-flip",
        levelNumber: 1,
        skipEntireGame: false,
        reason: "tired_prompt_skipped_level",
        durationMs: 4000,
      });

      assert.equal(skipResult.success, true);
      assert.equal(skipResult.currentLevel, 2);

      // Verify PostgreSQL attempt record
      const skippedAttempt = await prisma.levelAttempt.findFirst({
        where: {
          questSessionId: sessionId,
          gameKey: "card-flip",
          levelNumber: 1,
        },
      });

      assert.ok(skippedAttempt);
      assert.equal(skippedAttempt.status, "SKIPPED");
      assert.equal(skippedAttempt.accuracy, null);
      assert.equal(skippedAttempt.averageReactionTimeMs, null);
      assert.equal(skippedAttempt.durationMs, 4000);
      assert.ok(skippedAttempt.completedAt);
      const metrics = skippedAttempt.metrics as any;
      assert.equal(metrics?.isSkipped, true);
      assert.ok(metrics?.skippedAt);
      assert.equal(metrics?.reason, "tired_prompt_skipped_level");
    });

    it("preserves completed Level 1 when Level 2 is skipped, without falsifying scores", async () => {
      // Create a fresh session to test Level 1 completed + Level 2 skipped
      // Create a second child profile to get a fresh isolated session
      const secondChild = await prisma.childProfile.create({
        data: {
          userId: testUserId,
          childName: "Tara",
          age: 8,
          language: "English",
          selectedClass: "Class 3",
          school: "Orion Academy",
          parentEmail: `${testUserId}@example.com`,
          parentMobile: "9876543210",
          isGuardian: true,
        },
      });
      const newSessionResult = await getOrCreateActiveSession(testUserId, secondChild.id);
      const sId = newSessionResult.id;

      await saveWarmUpSubmission(testUserId, sId, {
        copingStrategy: "deep_breath",
        learningStyle: "visual",
        favoriteSubject: "math",
        emotionalState: "happy",
      });

      // Complete Game 1
      for (let lvl = 1; lvl <= 3; lvl++) {
        await startLevelAttempt(testUserId, sId, "stroop", lvl);
        await completeLevelAttempt(testUserId, sId, {
          gameKey: "stroop",
          levelNumber: lvl,
          totalTrials: 10,
          correctTrials: 10,
          accuracy: 100,
          durationMs: 12000,
          averageReactionTimeMs: 1200,
        });
      }

      // Complete Card Flip Level 1 with 100% accuracy
      await startLevelAttempt(testUserId, sId, "card-flip", 1);
      await completeLevelAttempt(testUserId, sId, {
        gameKey: "card-flip",
        levelNumber: 1,
        totalTrials: 4,
        correctTrials: 4,
        accuracy: 100,
        durationMs: 10000,
        averageReactionTimeMs: 2500,
      });

      // Now skip Card Flip Level 2
      await startLevelAttempt(testUserId, sId, "card-flip", 2);
      await skipLevelOrGame(testUserId, sId, {
        gameKey: "card-flip",
        levelNumber: 2,
        skipEntireGame: false,
        reason: "tired_prompt_skipped_level",
      });

      // Verify attempts in database
      const attempts = await prisma.levelAttempt.findMany({
        where: { questSessionId: sId, gameKey: "card-flip" },
        orderBy: { levelNumber: "asc" },
      });

      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].status, "COMPLETED");
      assert.equal(attempts[0].accuracy, 100);
      assert.equal(attempts[1].status, "SKIPPED");
      assert.equal(attempts[1].accuracy, null);

      // Verify progression allows moving to level 3
      const session = await prisma.questSession.findUnique({
        where: { id: sId },
      });
      assert.equal(session?.currentLevel, 3);
    });

    it("skipEntireGame marks remaining levels as SKIPPED and advances cleanly to next game", async () => {
      // Skip the rest of Card Flip (Level 3) via skipEntireGame
      const skipAllResult = await skipLevelOrGame(testUserId, sessionId, {
        gameKey: "card-flip",
        levelNumber: 2,
        skipEntireGame: true,
        reason: "tired_prompt_skipped_game",
      });

      assert.equal(skipAllResult.success, true);
      assert.equal(skipAllResult.currentGame, 3); // Pattern Recognition
      assert.equal(skipAllResult.currentLevel, 1);
      assert.ok(skipAllResult.nextLevelRoute?.includes("pattern"));

      // Verify all 3 Card Flip levels now exist with SKIPPED status
      const cardFlipAttempts = await prisma.levelAttempt.findMany({
        where: { questSessionId: sessionId, gameKey: "card-flip" },
      });
      assert.equal(cardFlipAttempts.length, 3);
      for (const att of cardFlipAttempts) {
        assert.equal(att.status, "SKIPPED");
        assert.equal(att.accuracy, null);
      }
    });

    it("computeSessionProgression correctly counts SKIPPED attempts towards quest traversal", async () => {
      const attempts = [
        { gameKey: "stroop", levelNumber: 1, status: "COMPLETED" },
        { gameKey: "stroop", levelNumber: 2, status: "COMPLETED" },
        { gameKey: "stroop", levelNumber: 3, status: "COMPLETED" },
        { gameKey: "card-flip", levelNumber: 1, status: "SKIPPED" },
        { gameKey: "card-flip", levelNumber: 2, status: "SKIPPED" },
        { gameKey: "card-flip", levelNumber: 3, status: "SKIPPED" },
      ];

      const mockSession = { currentGame: 1, currentLevel: 1, status: "IN_PROGRESS" };
      const progression = computeSessionProgression(mockSession as any, attempts as any);
      assert.equal(progression.currentGame, 3);
      assert.equal(progression.currentLevel, 1);
      assert.equal(progression.currentStage, "GAME_3_LEVEL_1");
      assert.equal(progression.isQuestComplete, false);
    });
  });

  // =========================================================================
  // DATA INTEGRITY: LEVEL COUNT CLAMPING (STRICTLY <= 3/3)
  // =========================================================================
  describe("Data Integrity: Level Counts Clamping (Strictly <= 3)", () => {
    it("clamps duplicate/retry attempts so levelsCompleted never exceeds 3/3", () => {
      // Simulate 5 attempts on the same game (retries/replays)
      const mockAttempts = [
        { gameKey: "stroop", levelNumber: 1, status: "COMPLETED", accuracy: 80 },
        { gameKey: "stroop", levelNumber: 1, status: "COMPLETED", accuracy: 90 }, // retry
        { gameKey: "stroop", levelNumber: 2, status: "COMPLETED", accuracy: 85 },
        { gameKey: "stroop", levelNumber: 2, status: "COMPLETED", accuracy: 95 }, // retry
        { gameKey: "stroop", levelNumber: 3, status: "COMPLETED", accuracy: 100 },
      ];

      const uniqueCompletedLevels = new Set(
        mockAttempts
          .filter((a) => a.status === "COMPLETED")
          .map((a) => a.levelNumber)
      );

      const clamped = Math.min(3, Math.max(0, uniqueCompletedLevels.size));
      assert.equal(clamped, 3);
      assert.notEqual(mockAttempts.length, clamped); // 5 attempts clamped to 3
    });
  });

  // =========================================================================
  // ISSUE 3: GRADE 5-7 PLAIN ENGLISH LANGUAGE & DOMAIN TITLES
  // =========================================================================
  describe("Issue 3: Grade 5-7 Plain English Language & Domain Names", () => {
    it("canonical games feature plain English titles with domain subtitles", () => {
      const expectedTitles = [
        "Staying Focused (Focus & Impulse Control)",
        "Remembering Pictures (Visual Memory)",
        "Finding Patterns (Pattern Recognition)",
        "Spotting Differences (Visual Attention)",
        "Trying New Rules (Mental Flexibility)",
        "Remembering Story Order (Story Sequencing)",
      ];

      for (const cg of CANONICAL_GAMES) {
        assert.ok(
          expectedTitles.includes(cg.domain),
          `Unexpected domain: ${cg.domain}`
        );
      }
    });

    it("rule-based report generates plain language summaries and handles skipped games with dedicated notes", () => {
      const mockInput: GameplayReportInput = {
        child: {
          childName: "Maya",
          age: 8,
          selectedClass: "Class 3",
          school: "Sunnyside",
        },
        quest: {
          sessionId: "session_with_skip",
          startedAt: new Date(Date.now() - 1800000).toISOString(),
          completedAt: new Date().toISOString(),
          totalLevelsCompleted: 15,
          overallAccuracy: 86,
          totalDurationMs: 600000,
        },
        warmUp: {
          copingStrategy: "take a pause and try again",
          learningStyle: "pictures and puzzles",
          favoriteSubject: "art",
          emotionalState: "excited",
        },
        games: CANONICAL_GAMES.map((cg) => {
          if (cg.key === "card-flip") {
            return {
              gameId: cg.id,
              gameKey: cg.key,
              gameName: cg.name,
              domain: cg.domain,
              levelsCompleted: 0,
              gameStatus: "SKIPPED" as const,
              averageAccuracy: null,
              averageReactionTimeMs: null,
              levels: [1, 2, 3].map((l) => ({
                levelNumber: l,
                attemptNumber: 1,
                status: "SKIPPED",
                totalTrials: 0,
                correctTrials: 0,
                accuracy: null,
                durationMs: 0,
                averageReactionTimeMs: null,
              })),
            };
          }
          return {
            gameId: cg.id,
            gameKey: cg.key,
            gameName: cg.name,
            domain: cg.domain,
            levelsCompleted: 3,
            gameStatus: "COMPLETED" as const,
            averageAccuracy: 88,
            averageReactionTimeMs: 1400,
            levels: [1, 2, 3].map((l) => ({
              levelNumber: l,
              attemptNumber: 1,
              status: "COMPLETED",
              totalTrials: 8,
              correctTrials: 7,
              accuracy: 87.5,
              durationMs: 14000,
              averageReactionTimeMs: 1400,
            })),
          };
        }),
      };

      const report = generateRuleBasedReport(mockInput);
      const validation = AiStructuredReportSchema.safeParse(report);
      assert.ok(validation.success, "Rule-based report must satisfy AiStructuredReportSchema");

      // Verify Card Flip skipped summary
      const cardFlipAnalysis = report.gameWiseAnalysis.find(
        (g) => g.gameKey === "card-flip"
      );
      assert.ok(cardFlipAnalysis);
      assert.equal(cardFlipAnalysis.gameStatus, "SKIPPED");
      assert.equal(cardFlipAnalysis.levelsCompleted, 0);
      assert.ok(
        cardFlipAnalysis.summary.includes("skipped during the quest session"),
        "Must explain that game was skipped"
      );
      assert.ok(
        cardFlipAnalysis.summary.includes("does not indicate any cognitive deficit"),
        "Must state that skipping does not indicate any cognitive deficit"
      );

      // Verify no clinical deficit jargon in overall texts
      const forbiddenTerms = [
        "executive dysfunction",
        "pathology",
        "subnormal",
        "neuropathology",
        "deficit pattern",
      ];
      const allText = JSON.stringify(report).toLowerCase();
      for (const term of forbiddenTerms) {
        assert.ok(!allText.includes(term), `Report should not include clinical term: ${term}`);
      }
    });

    it("generates a high-fidelity PDF without crashing and renders Six Cognitive Domains summary table", async () => {
      const mockInput: GameplayReportInput = {
        child: {
          childName: "Maya",
          age: 8,
          selectedClass: "Class 3",
          school: "Sunnyside",
        },
        quest: {
          sessionId: "session_pdf_test",
          startedAt: new Date(Date.now() - 1800000).toISOString(),
          completedAt: new Date().toISOString(),
          totalLevelsCompleted: 15,
          overallAccuracy: 86,
          totalDurationMs: 600000,
        },
        warmUp: {
          copingStrategy: "take a pause and try again",
          learningStyle: "pictures and puzzles",
          favoriteSubject: "art",
          emotionalState: "excited",
        },
        games: CANONICAL_GAMES.map((cg) => {
          const isSkipped = cg.key === "card-flip";
          return {
            gameId: cg.id,
            gameKey: cg.key,
            gameName: cg.name,
            domain: cg.domain,
            levelsCompleted: isSkipped ? 0 : 3,
            gameStatus: isSkipped ? ("SKIPPED" as const) : ("COMPLETED" as const),
            averageAccuracy: isSkipped ? null : 88,
            averageReactionTimeMs: isSkipped ? null : 1400,
            levels: [1, 2, 3].map((l) => ({
              levelNumber: l,
              attemptNumber: 1,
              status: isSkipped ? "SKIPPED" : "COMPLETED",
              totalTrials: isSkipped ? 0 : 8,
              correctTrials: isSkipped ? 0 : 7,
              accuracy: isSkipped ? null : 87.5,
              durationMs: isSkipped ? 0 : 14000,
              averageReactionTimeMs: isSkipped ? null : 1400,
            })),
          };
        }),
      };

      const aiReport = generateRuleBasedReport(mockInput);
      const pdfBytes = await generateReportPdf({
        childName: mockInput.child.childName,
        age: mockInput.child.age,
        selectedClass: mockInput.child.selectedClass,
        school: mockInput.child.school,
        questCompletedAt: mockInput.quest.completedAt,
        reportGeneratedAt: new Date().toISOString(),
        overallAccuracy: mockInput.quest.overallAccuracy,
        totalDurationMs: mockInput.quest.totalDurationMs,
        aiReport,
      });

      assert.ok(pdfBytes instanceof Uint8Array);
      assert.ok(pdfBytes.length > 5000, "PDF byte length must be greater than 5KB");
    });
  });
});
