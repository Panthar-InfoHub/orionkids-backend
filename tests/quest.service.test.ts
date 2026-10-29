import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getOrCreateActiveSession,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  generateOrGetReport,
  getSessionById,
} from "../src/services/quest.service.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/utils/errors.js";

describe("Quest Lifecycle, Progression & Concurrency Service", () => {
  const testUserId = `test_qa_user_${Date.now()}`;
  const otherUserId = `test_qa_other_${Date.now()}`;
  let sessionId = "";

  before(async () => {
    // Create isolated test user fixtures
    await prisma.user.create({
      data: {
        id: testUserId,
        name: "QA Test User",
        email: `${testUserId}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    await prisma.user.create({
      data: {
        id: otherUserId,
        name: "Other QA User",
        email: `${otherUserId}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    await prisma.childProfile.create({
      data: {
        userId: testUserId,
        childName: "QA Explorer",
        age: 7,
        language: "English",
        selectedClass: "Class 1",
        parentEmail: `${testUserId}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
  });

  after(async () => {
    // Clean up only our isolated test user fixtures
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [testUserId, otherUserId] } },
      });
    } catch {
      // Ignore cleanup error if already removed
    }
  });

  it("creates a new in-progress quest session at WARM_UP stage", async () => {
    const session = await getOrCreateActiveSession(testUserId);
    assert.ok(session.id);
    assert.equal(session.userId, testUserId);
    assert.equal(session.currentStage, "WARM_UP");
    assert.equal(session.currentGame, 1);
    assert.equal(session.currentLevel, 1);
    assert.equal(session.isWarmUpCompleted, false);
    sessionId = session.id;
  });

  it("prevents starting a level before completing warm-up", async () => {
    await assert.rejects(
      async () => startLevelAttempt(testUserId, sessionId, "stroop", 1),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /warm-up/i);
        return true;
      }
    );
  });

  it("completes warm-up and unlocks Game 1 Level 1", async () => {
    const res = await saveWarmUpSubmission(testUserId, sessionId, {
      "1": "happy",
      "2": "retry",
      "3": "both",
      "4": "numbers",
      "5": "morning",
      "6": "excited",
    });

    assert.equal(res.success, true);
    assert.equal(res.currentStage, "GAME_1_LEVEL_1");

    const session = await getSessionById(testUserId, sessionId);
    assert.equal(session.currentStage, "GAME_1_LEVEL_1");
    assert.equal(session.isWarmUpCompleted, true);
  });

  it("rejects level start or completion from a different user (ownership check)", async () => {
    await assert.rejects(
      async () => startLevelAttempt(otherUserId, sessionId, "stroop", 1),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );

    await assert.rejects(
      async () =>
        completeLevelAttempt(otherUserId, sessionId, {
          gameKey: "stroop",
          levelNumber: 1,
          totalTrials: 8,
          correctTrials: 8,
          accuracy: 100,
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );
  });

  it("rejects starting a locked level ahead of current progression", async () => {
    await assert.rejects(
      async () => startLevelAttempt(testUserId, sessionId, "stroop", 2),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /locked|violation/i);
        return true;
      }
    );

    await assert.rejects(
      async () => startLevelAttempt(testUserId, sessionId, "card-flip", 1),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );
  });

  it("starts and completes Game 1 Level 1, advancing to Level 2", async () => {
    const startRes = await startLevelAttempt(
      testUserId,
      sessionId,
      "stroop",
      1
    );
    assert.equal(startRes.status, "IN_PROGRESS");
    assert.equal(startRes.levelNumber, 1);

    const compRes = await completeLevelAttempt(testUserId, sessionId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
      durationMs: 12000,
      averageReactionTimeMs: 1200,
    });

    assert.equal(compRes.success, true);
    assert.equal(compRes.nextStage, "GAME_1_LEVEL_2");
    assert.equal(compRes.currentLevel, 2);
  });

  it("is idempotent: submitting completed level again does not double-advance", async () => {
    const repeatRes = await completeLevelAttempt(testUserId, sessionId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
      durationMs: 12000,
    });

    assert.equal(repeatRes.success, true);
    // Should still be at Game 1 Level 2
    assert.equal(repeatRes.currentLevel, 2);
    assert.equal(repeatRes.currentGame, 1);
  });

  it("prevents generating a report for an IN_PROGRESS session", async () => {
    await assert.rejects(
      async () => generateOrGetReport(testUserId, sessionId),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete/i);
        return true;
      }
    );
  });
});
