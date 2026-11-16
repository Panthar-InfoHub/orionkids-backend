import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getOrCreateActiveSession,
  saveWarmUpSubmission,
  startLevelAttempt,
  saveAttemptCheckpoint,
  completeLevelAttempt,
} from "../src/services/quest.service.js";

describe("Level Attempt Concurrency & Deadlock Prevention Suite", () => {
  const userId = `concurrent_user_${Date.now()}`;
  let childProfileId: string;
  let sessionId: string;

  before(async () => {
    // Setup test user
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test.com`,
        name: "Concurrency Test Parent",
        role: "USER",
        status: "ACTIVE",
      },
    });

    const child = await prisma.childProfile.create({
      data: {
        userId,
        childName: "Speedy Gamer",
        age: 7,
        selectedClass: "Class 2",
        language: "English",
        school: "Orion Academy",
        parentEmail: `${userId}@test.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
    childProfileId = child.id;

    // Start session and complete warmup
    const session = await getOrCreateActiveSession(userId, childProfileId);
    sessionId = session.id;

    await saveWarmUpSubmission(
      userId,
      sessionId,
      { emotionalState: "excited", copingStrategy: "focus" },
      new Date().toISOString(),
      childProfileId
    );

    // Advance through Level 1 and Level 2
    await startLevelAttempt(userId, sessionId, "stroop", 1);
    await completeLevelAttempt(userId, sessionId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 10,
      correctTrials: 9,
      accuracy: 90,
      durationMs: 12000,
    });

    await startLevelAttempt(userId, sessionId, "stroop", 2);
    await completeLevelAttempt(userId, sessionId, {
      gameKey: "stroop",
      levelNumber: 2,
      totalTrials: 10,
      correctTrials: 10,
      accuracy: 100,
      durationMs: 11000,
    });
  });

  after(async () => {
    await prisma.levelAttempt.deleteMany({ where: { questSessionId: sessionId } });
    await prisma.warmUpSubmission.deleteMany({ where: { questSessionId: sessionId } });
    await prisma.questSession.deleteMany({ where: { id: sessionId } });
    await prisma.childProfile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("handles concurrent checkpoint save and level completion without deadlock", async () => {
    // Start Stroop Level 3 (the exact level where the user got the write conflict / deadlock)
    const startRes = await startLevelAttempt(userId, sessionId, "stroop", 3);
    assert.ok(startRes.attemptId);
    const attemptId = startRes.attemptId;
    assert.ok(attemptId, "Active attemptId must be returned");

    // Fire checkpoint save (from near-final trial) and completeLevelAttempt (from final trial)
    // concurrently to simulate the exact network/browser race condition.
    const [checkpointRes, completeRes] = await Promise.allSettled([
      saveAttemptCheckpoint(userId, sessionId, attemptId, {
        currentTrialIdx: 9,
        records: [
          { trial: 9, color: "blue", word: "red", isCorrect: true, reactionTimeMs: 450 },
        ],
      }),
      completeLevelAttempt(userId, sessionId, {
        gameKey: "stroop",
        levelNumber: 3,
        totalTrials: 10,
        correctTrials: 10,
        accuracy: 100,
        durationMs: 14000,
        averageReactionTimeMs: 500,
        metrics: { totalTrials: 10, correctTrials: 10 },
      }),
    ]);

    // Verify completion succeeded without deadlock or 500
    assert.equal(completeRes.status, "fulfilled", "completeLevelAttempt must succeed");
    if (completeRes.status === "fulfilled") {
      assert.equal(completeRes.value.success, true);
      assert.equal(completeRes.value.currentGame, 2, "Must advance to Game 2 (Card Flip)");
      assert.equal(completeRes.value.currentLevel, 1, "Must advance to Level 1");
      assert.equal(completeRes.value.nextStage, "GAME_2_LEVEL_1");
    }

    // Verify checkpoint either succeeded or gracefully skipped (no unhandled deadlock)
    if (checkpointRes.status === "rejected") {
      // If rejected, it must NEVER be due to a deadlock or write conflict
      const msg = checkpointRes.reason?.message || "";
      assert.doesNotMatch(msg, /deadlock/i, "Must not fail due to deadlock");
      assert.doesNotMatch(msg, /write conflict/i, "Must not fail due to write conflict");
    }

    // Verify DB state in PostgreSQL
    const finalAttempt = await prisma.levelAttempt.findUnique({
      where: { id: attemptId },
    });
    assert.ok(finalAttempt);
    assert.equal(finalAttempt.status, "COMPLETED");
    assert.equal(finalAttempt.accuracy, 100);

    const finalSession = await prisma.questSession.findUnique({
      where: { id: sessionId },
    });
    assert.ok(finalSession);
    assert.equal(finalSession.currentGame, 2);
    assert.equal(finalSession.currentLevel, 1);
    assert.equal(finalSession.currentStage, "GAME_2_LEVEL_1");
  });
});
