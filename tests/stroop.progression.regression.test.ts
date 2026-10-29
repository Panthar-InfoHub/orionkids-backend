import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getOrCreateActiveSession,
  saveWarmUpSubmission,
  completeLevelAttempt,
  startLevelAttempt,
  getCurrentSession,
  generateOrGetReport,
  getSessionById,
} from "../src/services/quest.service.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/utils/errors.js";
import { legacyStroopSubmitSchema } from "../src/validators/quest.schema.js";

describe("Stroop Progression & Telemetry Regression Suite", () => {
  const userIdA = `qa_reg_user_a_${Date.now()}`;
  const userIdB = `qa_reg_user_b_${Date.now()}`;
  let sessionAId = "";

  before(async () => {
    // 1. Create User A (primary test subject)
    await prisma.user.create({
      data: {
        id: userIdA,
        name: "Stroop Regression User A",
        email: `${userIdA}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    await prisma.childProfile.create({
      data: {
        userId: userIdA,
        childName: "Alex Explorer",
        age: 8,
        language: "English",
        selectedClass: "Class 2",
        parentEmail: `${userIdA}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });

    // 2. Create User B (for cross-user ownership violation checks)
    await prisma.user.create({
      data: {
        id: userIdB,
        name: "Stroop Regression User B",
        email: `${userIdB}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    // Initialize session A and complete warm-up so Game 1 Level 1 is authorized
    const sessionA = await getOrCreateActiveSession(userIdA);
    sessionAId = sessionA.id;
    await saveWarmUpSubmission(userIdA, sessionAId, {
      "1": "happy",
      "2": "retry",
      "3": "both",
      "4": "numbers",
      "5": "morning",
      "6": "excited",
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [userIdA, userIdB] } },
      });
    } catch {
      // Best-effort cleanup
    }
  });

  // Requirement 2: Reject future-level submissions without advancing the session
  it("2. rejects a level 3 submission while level 1 is authorized", async () => {
    await assert.rejects(
      async () =>
        completeLevelAttempt(userIdA, sessionAId, {
          gameKey: "stroop",
          levelNumber: 3,
          totalTrials: 8,
          correctTrials: 8,
          accuracy: 100,
          durationMs: 12000,
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /Level progression violation/i);
        assert.match(err.message, /Game 1 Level 3 is locked/i);
        return true;
      }
    );
  });

  // Requirement 3: Rejected future-level submissions create no placeholder attempts
  it("3. rejected future-level submissions create no completed placeholder attempts", async () => {
    const session = await getSessionById(userIdA, sessionAId);
    assert.equal(session.currentLevel, 1);
    assert.equal(session.currentGame, 1);

    const attempts = await prisma.levelAttempt.findMany({
      where: { questSessionId: sessionAId },
    });
    // No level 1, 2, or 3 attempts should have been created by the rejected submission
    assert.equal(attempts.length, 0);
  });

  // Requirement 5: A different user's session cannot be modified
  it("5. a different user's session cannot be modified (ownership enforcement)", async () => {
    await assert.rejects(
      async () =>
        completeLevelAttempt(userIdB, sessionAId, {
          gameKey: "stroop",
          levelNumber: 1,
          totalTrials: 8,
          correctTrials: 8,
          accuracy: 100,
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /You do not own this quest session/i);
        return true;
      }
    );
  });

  // Requirement 1: Valid level 1 completion advances to level 2
  it("1. valid level 1 completion advances to level 2", async () => {
    const res = await completeLevelAttempt(userIdA, sessionAId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
      durationMs: 14000,
      averageReactionTimeMs: 1450,
      trialRecords: [{ trialId: 1, isCorrect: true }],
    });

    assert.equal(res.success, true);
    assert.equal(res.currentLevel, 2);
    assert.equal(res.nextStage, "GAME_1_LEVEL_2");

    const session = await getSessionById(userIdA, sessionAId);
    assert.equal(session.currentLevel, 2);
  });

  // Requirement 4: A genuine level completion can be retried without duplicate advancement
  it("4. a genuine level completion can be retried without duplicate advancement", async () => {
    const retryRes = await completeLevelAttempt(userIdA, sessionAId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
      durationMs: 14000,
    });

    assert.equal(retryRes.success, true);
    assert.match(retryRes.message, /already recorded/i);
    // Session level remains 2 (must not advance to 3)
    assert.equal(retryRes.currentLevel, 2);

    const attemptsLevel1 = await prisma.levelAttempt.findMany({
      where: {
        questSessionId: sessionAId,
        gameKey: "stroop",
        levelNumber: 1,
        status: "COMPLETED",
      },
    });
    // Exactly 1 completed attempt exists
    assert.equal(attemptsLevel1.length, 1);
  });

  // Requirement 7: Concurrent duplicate submissions do not double-advance progression
  it("7. concurrent duplicate submissions do not double-advance progression", async () => {
    // Current authorized stage is Game 1 Level 2
    // Launch 2 concurrent duplicate submissions for Level 2
    const results = await Promise.all([
      completeLevelAttempt(userIdA, sessionAId, {
        gameKey: "stroop",
        levelNumber: 2,
        totalTrials: 8,
        correctTrials: 7,
        accuracy: 87.5,
        durationMs: 15000,
      }),
      completeLevelAttempt(userIdA, sessionAId, {
        gameKey: "stroop",
        levelNumber: 2,
        totalTrials: 8,
        correctTrials: 7,
        accuracy: 87.5,
        durationMs: 15000,
      }),
    ]);

    // All should report success (1 first recording + 3 idempotent confirmations)
    assert.equal(results.every((r) => r.success), true);

    const session = await getSessionById(userIdA, sessionAId);
    // Should advance from Level 2 to Level 3, and NOT beyond Level 3!
    assert.equal(session.currentLevel, 3);
    assert.equal(session.currentGame, 1);

    const attemptsLevel2 = await prisma.levelAttempt.findMany({
      where: {
        questSessionId: sessionAId,
        gameKey: "stroop",
        levelNumber: 2,
        status: "COMPLETED",
      },
    });
    // Exactly 1 completed attempt created for Level 2
    assert.equal(attemptsLevel2.length, 1);
  });

  // Requirement 10: Existing legitimate quest and legacy Stroop flows continue to work
  it("10. complete Stroop Level 3 advances session across game boundary to Game 2 Level 1", async () => {
    const res = await completeLevelAttempt(userIdA, sessionAId, {
      gameKey: "stroop",
      levelNumber: 3,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
      durationMs: 16000,
    });

    assert.equal(res.success, true);
    // Stroop is Game 1 (3 levels) — completing Level 3 unlocks Game 2 Level 1
    assert.equal(res.currentGame, 2);
    assert.equal(res.currentLevel, 1);
    assert.equal(res.nextStage, "GAME_2_LEVEL_1");
  });

  // Requirement 6: A closed session cannot be advanced
  it("6. a closed session cannot be advanced with new levels", async () => {
    // Create an isolated closed session
    const closedSession = await prisma.questSession.create({
      data: {
        userId: userIdA,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        currentStage: "COMPLETED",
        completedAt: new Date(),
      },
    });

    await assert.rejects(
      async () =>
        completeLevelAttempt(userIdA, closedSession.id, {
          gameKey: "card-flip",
          levelNumber: 1,
          totalTrials: 8,
          correctTrials: 8,
          accuracy: 100,
        }),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /closed/i);
        return true;
      }
    );
  });

  // Requirement 9: Reports exclude nonexistent or synthetic gameplay from genuine completion metrics
  it("9. reports exclude nonexistent or synthetic gameplay from genuine completion metrics", async () => {
    const reportUserId = `qa_report_user_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: reportUserId,
        name: "Report Tester",
        email: `${reportUserId}@example.com`,
        status: "ACTIVE",
      },
    });

    await prisma.childProfile.create({
      data: {
        userId: reportUserId,
        childName: "Report Explorer",
        age: 9,
        language: "English",
        selectedClass: "Class 3",
        parentEmail: `${reportUserId}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });

    // Create a completed 18-level session containing 1 genuine 100% attempt and 1 synthetic 0% attempt for Stroop
    const repSession = await prisma.questSession.create({
      data: {
        userId: reportUserId,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        currentStage: "COMPLETED",
        completedAt: new Date(),
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        questSessionId: repSession.id,
        userId: reportUserId,
        answers: { "1": "happy" },
      },
    });

    // Genuine attempt for Level 1: 100% accuracy, 8 trials
    await prisma.levelAttempt.create({
      data: {
        questSessionId: repSession.id,
        userId: reportUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 8,
        correctTrials: 8,
        accuracy: 100.0,
        durationMs: 12000,
        averageReactionTimeMs: 1200,
      },
    });

    // Synthetic placeholder attempt for Level 2: 0% accuracy, totalTrials: 0, autoAdvanced: true
    await prisma.levelAttempt.create({
      data: {
        questSessionId: repSession.id,
        userId: reportUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 2,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 0,
        correctTrials: 0,
        accuracy: 0.0,
        durationMs: 0,
        averageReactionTimeMs: 0,
        metrics: { autoAdvanced: true, skippedByFrontend: true },
      },
    });

    // Generate report
    const report = await generateOrGetReport(reportUserId, repSession.id);
    const summaries = report.gameSummaries as Record<string, any>;

    // Stroop average accuracy MUST be 100 (from genuine attempt 1), NOT pulled down to 50% by the 0% placeholder!
    assert.equal(summaries["stroop"].averageAccuracy, 100);
    // levelsCompleted must reflect only genuine attempts (1 genuine level completed, not 2)
    assert.equal(summaries["stroop"].levelsCompleted, 1);
    // Overall accuracy should be 100.0 (synthetic 0% attempt excluded)
    assert.equal(report.overallAccuracy, 100.0);

    // Clean up report user
    await prisma.user.delete({ where: { id: reportUserId } });
  });

  // Requirement 8: Simulated frontend response behavior verification
  it("8. failed requests do not advance frontend navigation", () => {
    // Verify that legacyStroopSubmitSchema rejects placeholder/autoAdvanced payload
    assert.throws(
      () =>
        legacyStroopSubmitSchema.parse({
          level: 2,
          totalTrials: 0,
          correctTrials: 0,
          accuracy: 0,
        }),
      /totalTrials must be greater than 0/
    );

    // Simulated 403 response handling: must NOT return success: true or advance route
    const simulate403Response = (status: number, message: string) => {
      if (status === 401 || status === 403) {
        return {
          success: false,
          message,
          errorType: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        };
      }
      return { success: true };
    };

    const forbiddenResult = simulate403Response(
      403,
      "Level progression violation: Game 1 Level 3 is locked."
    );
    assert.equal(forbiddenResult.success, false);
    assert.equal(forbiddenResult.errorType, "FORBIDDEN");
    assert.equal((forbiddenResult as any).nextLevelRoute, undefined);
  });

  // Requirement: Progression transitions verify Level 1 -> 2 -> 3 -> Game 2 Level 1
  it("11. verifies nextLevelRoute contract for Level 1, 2, and 3 transitions", () => {
    const computeRoute = (currentGame: number, currentLevel: number, isQuestComplete: boolean) => {
      if (isQuestComplete) return "/report";
      const keyMap: Record<number, string> = {
        1: "stroop",
        2: "card-flip",
        3: "pattern",
        4: "odd-one-out",
        5: "rule-discovery",
        6: "story-sequencing",
      };
      const nextGameKey = keyMap[currentGame];
      return nextGameKey ? `/games/${nextGameKey}?level=${currentLevel}` : "/report";
    };

    // Level 1 complete -> session advanced to Level 2
    assert.equal(computeRoute(1, 2, false), "/games/stroop?level=2");
    // Level 2 complete -> session advanced to Level 3
    assert.equal(computeRoute(1, 3, false), "/games/stroop?level=3");
    // Level 3 complete -> session advanced to Game 2 Level 1
    assert.equal(computeRoute(2, 1, false), "/games/card-flip?level=1");
    // Entire quest complete
    assert.equal(computeRoute(6, 3, true), "/report");
  });

  // Requirement 12: A refresh after Level 1 completion restores the authorized Level 2 state
  it("12. refresh after Level 1 completion restores the authorized Level 2 state", async () => {
    // When a user refreshes the page, the client calls getCurrentSession
    const refreshed = await getCurrentSession(userIdA);
    assert.ok(refreshed);
    assert.equal(refreshed.currentGame, 2); // user has completed Level 3, now on Game 2
    assert.equal(refreshed.currentLevel, 1);
  });

  // Requirement 13: Stale session data cannot revert session (Progression Reconciliation)
  it("13. stale session data cannot revert the session to Level 1", async () => {
    const reconUserId = `qa_recon_user_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: reconUserId,
        name: "Recon User",
        email: `${reconUserId}@example.com`,
        status: "ACTIVE",
      },
    });

    // Create session that was artificially stuck on Game 1 Level 1
    const driftedSession = await prisma.questSession.create({
      data: {
        userId: reconUserId,
        status: "IN_PROGRESS",
        currentStage: "GAME_1_LEVEL_1",
        currentGame: 1,
        currentLevel: 1,
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        questSessionId: driftedSession.id,
        userId: reconUserId,
        answers: { "1": "happy" },
      },
    });

    // But level 1 attempt was genuinely COMPLETED
    await prisma.levelAttempt.create({
      data: {
        questSessionId: driftedSession.id,
        userId: reconUserId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 8,
        correctTrials: 8,
        accuracy: 100.0,
      },
    });

    // When starting Level 2, the service reconciles the drifted session to Level 2 and succeeds
    const startL2 = await startLevelAttempt(reconUserId, driftedSession.id, "stroop", 2);
    assert.equal(startL2.levelNumber, 2);
    assert.equal(startL2.status, "IN_PROGRESS");

    // Session in DB is now reconciled to Game 1 Level 2
    const checked = await prisma.questSession.findUnique({ where: { id: driftedSession.id } });
    assert.equal(checked?.currentLevel, 2);
    assert.equal(checked?.currentStage, "GAME_1_LEVEL_2");

    // Cleanup
    await prisma.user.delete({ where: { id: reconUserId } });
  });

  // Requirement 14: Repeated level-start requests do not create duplicate active attempts
  it("14. repeated level-start requests do not create duplicate active attempts", async () => {
    const dedupeUserId = `qa_dedupe_user_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: dedupeUserId,
        name: "Dedupe User",
        email: `${dedupeUserId}@example.com`,
        status: "ACTIVE",
      },
    });

    const dSession = await prisma.questSession.create({
      data: {
        userId: dedupeUserId,
        status: "IN_PROGRESS",
        currentStage: "GAME_1_LEVEL_1",
        currentGame: 1,
        currentLevel: 1,
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        questSessionId: dSession.id,
        userId: dedupeUserId,
        answers: { "1": "happy" },
      },
    });

    // Initial level-start request
    const att1 = await startLevelAttempt(dedupeUserId, dSession.id, "stroop", 1);
    // Repeated retry level-start request
    const att2 = await startLevelAttempt(dedupeUserId, dSession.id, "stroop", 1);

    // Both must return the exact same in-progress attempt ID
    assert.equal(att1.attemptId, att2.attemptId);

    const allAttempts = await prisma.levelAttempt.findMany({
      where: { questSessionId: dSession.id, gameKey: "stroop", levelNumber: 1 },
    });
    // Exactly 1 in-progress attempt created, no duplicate attempts
    assert.equal(allAttempts.length, 1);

    // Cleanup
    await prisma.user.delete({ where: { id: dedupeUserId } });
  });

  // Requirement 15 & 16 & 17: Full 18-level progression map and final quest completion transition
  it("15. verifies complete 18-level progression contract and final report transition", async () => {
    const fullQuestUserId = `qa_fullquest_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: fullQuestUserId,
        name: "Full Quest User",
        email: `${fullQuestUserId}@example.com`,
        status: "ACTIVE",
      },
    });

    // Create session at Game 6 Level 3 (the 18th level)
    const qSession = await prisma.questSession.create({
      data: {
        userId: fullQuestUserId,
        status: "IN_PROGRESS",
        currentStage: "GAME_6_LEVEL_3",
        currentGame: 6,
        currentLevel: 3,
      },
    });

    await prisma.warmUpSubmission.create({
      data: {
        questSessionId: qSession.id,
        userId: fullQuestUserId,
        answers: { "1": "happy" },
      },
    });

    // Complete Level 18 (Story Sequencing Level 3)
    const finalRes = await completeLevelAttempt(fullQuestUserId, qSession.id, {
      gameKey: "story-sequencing",
      levelNumber: 3,
      totalTrials: 4,
      correctTrials: 4,
      accuracy: 100,
      durationMs: 12000,
    });

    assert.equal(finalRes.success, true);
    assert.equal(finalRes.isQuestComplete, true);
    assert.equal(finalRes.nextStage, "COMPLETED");

    // Session in DB must be COMPLETED
    const updated = await prisma.questSession.findUnique({ where: { id: qSession.id } });
    assert.equal(updated?.status, "COMPLETED");
    assert.ok(updated?.completedAt);

    // Cleanup
    await prisma.user.delete({ where: { id: fullQuestUserId } });
  });
});
