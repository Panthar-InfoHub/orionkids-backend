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
import { generateReportPdf } from "../src/services/pdfReport.service.js";
import { CANONICAL_GAMES } from "../src/config/games.js";

function createMockInput(overrides: Partial<GameplayReportInput> = {}): GameplayReportInput {
  return {
    child: {
      childName: "Tara Verma",
      age: 8,
      selectedClass: "Class 3",
      school: "Delhi Public School",
      ...overrides.child,
    },
    quest: {
      sessionId: `test_integrity_session_${Date.now()}`,
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt: new Date().toISOString(),
      totalLevelsCompleted: 18,
      overallAccuracy: 88.5,
      totalDurationMs: 900000,
      ...overrides.quest,
    },
    warmUp: {
      copingStrategy: "retry with focus",
      learningStyle: "visual exploration",
      favoriteSubject: "science",
      emotionalState: "confident",
      ...overrides.warmUp,
    },
    games:
      overrides.games ||
      CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 90,
        averageReactionTimeMs: 1200,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: 7,
          accuracy: 87.5,
          durationMs: 15000,
          averageReactionTimeMs: 1200,
        })),
      })),
  };
}

describe("Phase 1 & 1.1: Assessment Data Integrity & Partial Assessment Test Suite", () => {
  const testUserId = `test_integrity_user_${Date.now()}`;
  let childProfileId = "";

  before(async () => {
    await prisma.user.create({
      data: {
        id: testUserId,
        name: "Test Parent Data Integrity",
        email: `${testUserId}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    const child = await prisma.childProfile.create({
      data: {
        userId: testUserId,
        childName: "Tara",
        age: 8,
        language: "English",
        selectedClass: "Class 3",
        school: "Delhi Public School",
        parentEmail: `${testUserId}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
    childProfileId = child.id;
  });

  after(async () => {
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
    } finally {
      await disconnectPrisma();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. ALL 3 LEVELS COMPLETED (ASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 1: All 3 levels completed -> marks ASSESSED with genuine scores and facets", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    for (let g = 1; g <= 6; g++) {
      const cg = CANONICAL_GAMES[g - 1]!;
      for (let lvl = 1; lvl <= 3; lvl++) {
        await prisma.levelAttempt.create({
          data: {
            questSessionId: session.id,
            userId: testUserId,
            gameId: g,
            gameKey: cg.key,
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 10,
            correctTrials: 9,
            accuracy: 90.0,
            durationMs: 14000,
            averageReactionTimeMs: 1100,
            completedAt: new Date(),
          },
        });
      }
    }

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    assert.equal(report.status, "GENERATED");

    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    for (const cg of CANONICAL_GAMES) {
      const gs = summaries[cg.key];
      assert.ok(gs, `Game summary must exist for ${cg.key}`);
      assert.equal(gs.assessmentStatus, "ASSESSED");
      assert.equal(gs.gameStatus, "COMPLETED");
      assert.equal(gs.levelsCompleted, 3);
      assert.equal(typeof gs.averageAccuracy, "number");
      assert.equal(gs.averageAccuracy, 90);
    }

    assert.equal(typeof facets.focusInhibition.score, "number");
    assert.equal(facets.focusInhibition.assessmentStatus, "ASSESSED");
    assert.equal(typeof facets.workingMemory.score, "number");
    assert.equal(facets.workingMemory.assessmentStatus, "ASSESSED");
  });

  // ---------------------------------------------------------------------------
  // 2. 2 COMPLETED, 1 SKIPPED (PARTIALLY_ASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 2: 2 completed, 1 skipped -> marks PARTIALLY_ASSESSED and preserves genuine scores", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 1,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    // Stroop Level 1 (90%) and Level 2 (80%) completed; Level 3 SKIPPED
    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 9,
        accuracy: 90.0,
        durationMs: 14000,
        averageReactionTimeMs: 1100,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 2,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 8,
        accuracy: 80.0,
        durationMs: 16000,
        averageReactionTimeMs: 1200,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 3,
        attemptNumber: 1,
        status: "SKIPPED",
        metrics: { isSkipped: true, skippedViaTiredPrompt: true },
        completedAt: new Date(),
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const stroop = summaries["stroop"];
    assert.equal(stroop.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroop.levelsCompleted, 2);
    // Weighted accuracy: (9 + 8) / (10 + 10) = 85.0%
    assert.equal(stroop.averageAccuracy, 85);
    assert.equal(typeof stroop.averageReactionTimeMs, "number");

    // Cognitive facet preserves score and partial status
    assert.equal(facets.focusInhibition.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(facets.focusInhibition.score, 85);

    // AI summary handles partial assessment neutrally
    const aiReport = report.aiReport as any;
    const stroopAnalysis = aiReport.gameWiseAnalysis.find((g: any) => g.gameKey === "stroop");
    assert.ok(stroopAnalysis);
    assert.equal(stroopAnalysis.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroopAnalysis.levelsCompleted, 2);
    assert.equal(stroopAnalysis.averageAccuracy, 85);
    assert.ok(stroopAnalysis.summary.includes("partially assessed"));
    assert.ok(stroopAnalysis.summary.includes("Level 3 (skipped)") || stroopAnalysis.summary.includes("skipped"));

    // Excluded from superpower rankings
    const strengths = aiReport.observedStrengths || [];
    for (const str of strengths) {
      const heading = typeof str === "string" ? str : str.heading;
      assert.ok(!heading.includes("Focus Proficiency"), "Partially assessed game must not be top superpower");
    }
  });

  // ---------------------------------------------------------------------------
  // 3. 1 COMPLETED, 2 SKIPPED (PARTIALLY_ASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 3: 1 completed, 2 skipped -> marks PARTIALLY_ASSESSED with 1 level completed", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 1,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    // Level 1 completed (90%), Levels 2 & 3 skipped
    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 9,
        accuracy: 90.0,
        durationMs: 14000,
        averageReactionTimeMs: 1100,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 2,
        attemptNumber: 1,
        status: "SKIPPED",
        metrics: { isSkipped: true },
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 3,
        attemptNumber: 1,
        status: "SKIPPED",
        metrics: { isSkipped: true },
        completedAt: new Date(),
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const stroop = summaries["stroop"];
    assert.equal(stroop.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroop.levelsCompleted, 1);
    assert.equal(stroop.averageAccuracy, 90);
    assert.equal(facets.focusInhibition.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(facets.focusInhibition.score, 90);
  });

  // ---------------------------------------------------------------------------
  // 4. 2 COMPLETED, 1 ABANDONED (PARTIALLY_ASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 4: 2 completed, 1 abandoned -> marks PARTIALLY_ASSESSED and preserves completed metrics", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 1,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    // Level 1 and 2 completed; Level 3 abandoned
    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 10,
        accuracy: 100.0,
        durationMs: 12000,
        averageReactionTimeMs: 1000,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 2,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 8,
        accuracy: 80.0,
        durationMs: 14000,
        averageReactionTimeMs: 1100,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 3,
        attemptNumber: 1,
        status: "ABANDONED",
        durationMs: 3000,
        completedAt: new Date(),
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const stroop = summaries["stroop"];
    assert.equal(stroop.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroop.levelsCompleted, 2);
    // (10 + 8) / 20 = 90%
    assert.equal(stroop.averageAccuracy, 90);
    assert.equal(facets.focusInhibition.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(facets.focusInhibition.score, 90);
  });

  // ---------------------------------------------------------------------------
  // 5. 1 COMPLETED, 2 ABANDONED (PARTIALLY_ASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 5: 1 completed, 2 abandoned -> marks PARTIALLY_ASSESSED", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 1,
        currentLevel: 2,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 8,
        accuracy: 80.0,
        durationMs: 14000,
        averageReactionTimeMs: 1100,
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 2,
        attemptNumber: 1,
        status: "ABANDONED",
        durationMs: 2000,
        completedAt: new Date(),
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const stroop = summaries["stroop"];
    assert.equal(stroop.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroop.levelsCompleted, 1);
    assert.equal(stroop.averageAccuracy, 80);
    assert.equal(facets.focusInhibition.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(facets.focusInhibition.score, 80);
  });

  // ---------------------------------------------------------------------------
  // 6. ALL 3 SKIPPED (SKIPPED)
  // ---------------------------------------------------------------------------
  it("Scenario 6: All levels skipped with 0 completed -> marks SKIPPED with null score", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 2,
        currentLevel: 1,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 2,
        gameKey: "card-flip",
        levelNumber: 1,
        attemptNumber: 1,
        status: "SKIPPED",
        metrics: { isSkipped: true },
        completedAt: new Date(),
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const cardFlip = summaries["card-flip"];
    assert.equal(cardFlip.assessmentStatus, "SKIPPED");
    assert.equal(cardFlip.levelsCompleted, 0);
    assert.equal(cardFlip.averageAccuracy, null);
    assert.equal(facets.workingMemory.score, null);
    assert.equal(facets.workingMemory.assessmentStatus, "SKIPPED");
  });

  // ---------------------------------------------------------------------------
  // 7. STARTED BUT NO LEVELS COMPLETED (INCOMPLETE / ABANDONED)
  // ---------------------------------------------------------------------------
  it("Scenario 7: Started but no levels completed -> marks INCOMPLETE or ABANDONED with null score", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 3,
        currentLevel: 1,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    // In-progress attempt with 0 completed levels
    await prisma.levelAttempt.create({
      data: {
        questSessionId: session.id,
        userId: testUserId,
        gameId: 3,
        gameKey: "pattern",
        levelNumber: 1,
        attemptNumber: 1,
        status: "IN_PROGRESS",
      },
    });

    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const pattern = summaries["pattern"];
    assert.equal(pattern.assessmentStatus, "INCOMPLETE");
    assert.equal(pattern.levelsCompleted, 0);
    assert.equal(pattern.averageAccuracy, null);
    assert.equal(facets.patternReasoning.score, null);
    assert.equal(facets.patternReasoning.assessmentStatus, "INCOMPLETE");
  });

  // ---------------------------------------------------------------------------
  // 8. UNSTARTED GAME (UNASSESSED)
  // ---------------------------------------------------------------------------
  it("Scenario 8: Unstarted game -> marks UNASSESSED with null score and zero levels", async () => {
    const session = await prisma.questSession.create({
      data: {
        userId: testUserId,
        childProfileId,
        status: "COMPLETED",
        currentGame: 1,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        userId: testUserId,
        questSessionId: session.id,
        answers: { "2": "deep breath", "3": "hands-on", "4": "math", "6": "happy" },
        completedAt: new Date(),
      },
    });

    // No attempts created for Game 4 (odd-one-out)
    const report = await generateOrGetReport(testUserId, session.id, true, true);
    const summaries = report.gameSummaries as Record<string, any>;
    const facets = report.cognitiveFacets as Record<string, any>;

    const oddOne = summaries["odd-one-out"];
    assert.equal(oddOne.assessmentStatus, "UNASSESSED");
    assert.equal(oddOne.levelsCompleted, 0);
    assert.equal(oddOne.averageAccuracy, null);
    assert.equal(facets.visualDiscrimination.score, null);
    assert.equal(facets.visualDiscrimination.assessmentStatus, "UNASSESSED");
  });

  // ---------------------------------------------------------------------------
  // 9. RULE-BASED FALLBACK PARITY WITH PARTIALLY_ASSESSED
  // ---------------------------------------------------------------------------
  it("Scenario 9: Rule-based fallback generator correctly handles PARTIALLY_ASSESSED, ASSESSED, SKIPPED, and UNASSESSED", () => {
    const input = createMockInput({
      games: [
        {
          gameId: 1,
          gameKey: "stroop",
          gameName: "Stroop Colour-Word",
          domain: "Focus & Impulse Control",
          assessmentStatus: "PARTIALLY_ASSESSED",
          levelsCompleted: 2,
          averageAccuracy: 88,
          averageReactionTimeMs: 1200,
          levels: [
            {
              levelNumber: 1,
              attemptNumber: 1,
              status: "COMPLETED",
              totalTrials: 8,
              correctTrials: 7,
              accuracy: 87.5,
              durationMs: 12000,
              averageReactionTimeMs: 1200,
            },
            {
              levelNumber: 2,
              attemptNumber: 1,
              status: "COMPLETED",
              totalTrials: 8,
              correctTrials: 7,
              accuracy: 88.5,
              durationMs: 14000,
              averageReactionTimeMs: 1200,
            },
            {
              levelNumber: 3,
              attemptNumber: 1,
              status: "SKIPPED",
              totalTrials: null,
              correctTrials: null,
              accuracy: null,
              durationMs: null,
              averageReactionTimeMs: null,
            },
          ],
        },
        {
          gameId: 2,
          gameKey: "card-flip",
          gameName: "Cosmic Card Flip",
          domain: "Visual Memory",
          assessmentStatus: "UNASSESSED",
          levelsCompleted: 0,
          averageAccuracy: null,
          averageReactionTimeMs: null,
          levels: [1, 2, 3].map((l) => ({
            levelNumber: l,
            attemptNumber: 1,
            status: "UNASSESSED",
            totalTrials: null,
            correctTrials: null,
            accuracy: null,
            durationMs: null,
            averageReactionTimeMs: null,
          })),
        },
        {
          gameId: 3,
          gameKey: "pattern",
          gameName: "Pattern Recognition",
          domain: "Pattern Recognition",
          assessmentStatus: "ASSESSED",
          levelsCompleted: 3,
          averageAccuracy: 95,
          averageReactionTimeMs: 1100,
          levels: [1, 2, 3].map((l) => ({
            levelNumber: l,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 8,
            correctTrials: 8,
            accuracy: 100,
            durationMs: 10000,
            averageReactionTimeMs: 1100,
          })),
        },
      ],
    });

    const report = generateRuleBasedReport(input);
    const parsed = AiStructuredReportSchema.parse(report);
    assert.ok(parsed);

    // Stroop partial verification
    const stroopAnalysis = report.gameWiseAnalysis.find((g) => g.gameKey === "stroop");
    assert.ok(stroopAnalysis);
    assert.equal(stroopAnalysis.assessmentStatus, "PARTIALLY_ASSESSED");
    assert.equal(stroopAnalysis.averageAccuracy, 88);
    assert.equal(stroopAnalysis.levelsCompleted, 2);
    assert.ok(stroopAnalysis.summary.includes("partially assessed"));
    assert.ok(stroopAnalysis.summary.includes("Level 3 (skipped)"));

    // Card Flip unassessed verification
    const cf = report.gameWiseAnalysis.find((g) => g.gameKey === "card-flip");
    assert.ok(cf);
    assert.equal(cf.gameStatus, "UNASSESSED");
    assert.equal(cf.averageAccuracy, null);

    // Scored games strictly exclude partial Stroop from top superpowers
    const strengths = report.observedStrengths;
    assert.ok(strengths.length >= 1);
    for (const str of strengths) {
      const heading = typeof str === "string" ? str : str.heading;
      assert.ok(!heading.includes("Focus & Impulse Control"), "Partially assessed game must not be selected as top superpower");
    }
  });

  // ---------------------------------------------------------------------------
  // 10. PDF GENERATION WITH PARTIALLY ASSESSED GAME
  // ---------------------------------------------------------------------------
  it("Scenario 10: PDF renders 'Partially Assessed', genuine accuracy, and notes without crashing", async () => {
    const input = createMockInput({
      games: [
        {
          gameId: 1,
          gameKey: "stroop",
          gameName: "Stroop Colour-Word",
          domain: "Focus & Impulse Control",
          assessmentStatus: "PARTIALLY_ASSESSED",
          levelsCompleted: 2,
          averageAccuracy: 88,
          averageReactionTimeMs: 1200,
          levels: [
            {
              levelNumber: 1,
              attemptNumber: 1,
              status: "COMPLETED",
              totalTrials: 8,
              correctTrials: 7,
              accuracy: 87.5,
              durationMs: 12000,
              averageReactionTimeMs: 1200,
            },
            {
              levelNumber: 2,
              attemptNumber: 1,
              status: "COMPLETED",
              totalTrials: 8,
              correctTrials: 7,
              accuracy: 88.5,
              durationMs: 14000,
              averageReactionTimeMs: 1200,
            },
            {
              levelNumber: 3,
              attemptNumber: 1,
              status: "SKIPPED",
              totalTrials: null,
              correctTrials: null,
              accuracy: null,
              durationMs: null,
              averageReactionTimeMs: null,
            },
          ],
        },
        {
          gameId: 2,
          gameKey: "card-flip",
          gameName: "Cosmic Card Flip",
          domain: "Visual Memory",
          assessmentStatus: "UNASSESSED",
          levelsCompleted: 0,
          averageAccuracy: null,
          averageReactionTimeMs: null,
          levels: [1, 2, 3].map((l) => ({
            levelNumber: l,
            attemptNumber: 1,
            status: "UNASSESSED",
            totalTrials: null,
            correctTrials: null,
            accuracy: null,
            durationMs: null,
            averageReactionTimeMs: null,
          })),
        },
      ],
    });

    const report = generateRuleBasedReport(input);

    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      overallAccuracy: 88,
      totalDurationMs: 600000,
      aiReport: report,
    });

    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 5000);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");
    assert.match(header, /^%PDF-/);
  });

  // ---------------------------------------------------------------------------
  // 11. HISTORICAL REPORT COMPATIBILITY
  // ---------------------------------------------------------------------------
  it("Scenario 11: Historical report without assessmentStatus is safely parsed without errors", () => {
    const legacyReport = {
      reportTitle: "Legacy Report",
      childOverview: "A child overview",
      questSummary: "A quest summary",
      overallPerformanceSummary: "A performance summary",
      gameWiseAnalysis: [
        {
          gameKey: "stroop",
          gameName: "Stroop Colour-Word",
          cognitiveDomain: "Focus",
          gameStatus: "COMPLETED",
          levelsCompleted: 3,
          averageAccuracy: 90,
          averageReactionTimeMs: 1200,
          summary: "Legacy summary",
          observedStrengths: ["Fast pace"],
          areasForPractice: [],
        },
        {
          gameKey: "card-flip",
          gameName: "Card Flip",
          cognitiveDomain: "Memory",
          gameStatus: "NOT_ATTEMPTED",
          levelsCompleted: 0,
          averageAccuracy: null,
          averageReactionTimeMs: null,
          summary: "Not attempted",
          observedStrengths: [],
          areasForPractice: [],
        },
      ],
      levelWisePerformance: [],
      observedStrengths: [
        {
          heading: "Attention Focus",
          cognitiveSkill: "Focus",
          observation: "Great focus",
          performanceEvidence: "90%",
          educationalRelevance: "Helpful in school",
        },
      ],
      areasForPractice: [
        {
          heading: "Rule Switching",
          cognitiveSkill: "Flexibility",
          observedPattern: "Varied pattern",
          performanceEvidence: "80%",
          recommendedApproach: "Family games",
        },
      ],
      progressAndConsistency: "Consistent",
      parentRecommendations: [
        {
          title: "Card Game",
          skillsPracticed: ["Memory"],
          materials: ["Cards"],
          instructions: ["Step 1", "Step 2", "Step 3"],
          suggestedDuration: "10 mins",
          learningOpportunity: "Memory practice",
          parentTip: "Have fun",
        },
      ],
      dataLimitations: "Gameplay exploratory observations",
      reportGenerationDate: "2026-11-16",
    };

    const parsed = AiStructuredReportSchema.parse(legacyReport);
    assert.ok(parsed);
    assert.equal(parsed.gameWiseAnalysis?.[0]?.gameStatus, "COMPLETED");
    assert.equal(parsed.gameWiseAnalysis?.[1]?.gameStatus, "NOT_ATTEMPTED");
  });
});
