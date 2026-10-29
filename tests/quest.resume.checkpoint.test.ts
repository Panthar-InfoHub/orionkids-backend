import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getResumeState,
  saveAttemptCheckpoint,
  getOrCreateActiveSession,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
} from "../src/services/quest.service.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/utils/errors.js";

describe("Quest Resume State & Checkpoint Persistence Service", () => {
  const userIdA = `qa_resume_user_a_${Date.now()}`;
  const userIdB = `qa_resume_user_b_${Date.now()}`;
  let sessionAId = "";

  before(async () => {
    await prisma.user.create({
      data: {
        id: userIdA,
        name: "Resume Tester A",
        email: `${userIdA}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    await prisma.user.create({
      data: {
        id: userIdB,
        name: "Resume Tester B",
        email: `${userIdB}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [userIdA, userIdB] } },
      });
    } catch {
      // Best effort cleanup
    }
  });

  it("1. returns hasResumableQuest: false and destination: '/' when no quest exists without creating records", async () => {
    const resumeState = await getResumeState(userIdA);
    assert.equal(resumeState.hasResumableQuest, false);
    assert.equal(resumeState.destination, "/");

    // Verify no session was created as a side effect
    const sessions = await prisma.questSession.findMany({
      where: { userId: userIdA },
    });
    assert.equal(sessions.length, 0);
  });

  it("2. resumes at '/warm-up' when an in-progress session has no warm-up submission", async () => {
    const session = await getOrCreateActiveSession(userIdA);
    sessionAId = session.id;

    const resumeState = await getResumeState(userIdA);
    assert.equal(resumeState.hasResumableQuest, true);
    assert.equal(resumeState.destination, "/warm-up");
    assert.equal(resumeState.currentStage, "WARM_UP");
    assert.equal(resumeState.sessionId, sessionAId);
  });

  it("3. resumes at '/games/stroop?level=1' after warm-up is submitted", async () => {
    await saveWarmUpSubmission(userIdA, sessionAId, {
      "1": "happy",
      "2": "both",
      "3": "numbers",
    });

    const resumeState = await getResumeState(userIdA);
    assert.equal(resumeState.hasResumableQuest, true);
    assert.equal(resumeState.destination, "/games/stroop?level=1");
    assert.equal(resumeState.currentGame, 1);
    assert.equal(resumeState.currentLevel, 1);
  });

  it("4. saves and restores an in-game checkpoint on an in-progress level attempt", async () => {
    const startRes = await startLevelAttempt(userIdA, sessionAId, "stroop", 1);
    const attemptId = startRes.attemptId;

    const checkpointData = {
      currentTrialIdx: 4,
      records: [
        { trialId: 1, isCorrect: true },
        { trialId: 2, isCorrect: true },
        { trialId: 3, isCorrect: false },
        { trialId: 4, isCorrect: true },
      ],
      timestamp: new Date().toISOString(),
    };

    const saveRes = await saveAttemptCheckpoint(
      userIdA,
      sessionAId,
      attemptId,
      checkpointData
    );
    assert.equal(saveRes.success, true);
    assert.equal(saveRes.attemptId, attemptId);

    // Retrieve resume state and verify checkpoint is included
    const resumeState = await getResumeState(userIdA);
    assert.equal(resumeState.hasResumableQuest, true);
    assert.equal(resumeState.attemptId, attemptId);
    assert.deepEqual(resumeState.checkpoint, checkpointData);
  });

  it("5. rejects checkpoint saves from a different user (ownership check)", async () => {
    const attempt = await prisma.levelAttempt.findFirst({
      where: { questSessionId: sessionAId },
    });
    assert.ok(attempt);

    await assert.rejects(
      async () =>
        saveAttemptCheckpoint(userIdB, sessionAId, attempt.id, {
          currentTrialIdx: 5,
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /do not own/i);
        return true;
      }
    );
  });

  it("6. rejects checkpoint saves on a completed attempt", async () => {
    // Complete level 1
    await completeLevelAttempt(userIdA, sessionAId, {
      gameKey: "stroop",
      levelNumber: 1,
      totalTrials: 8,
      correctTrials: 8,
      accuracy: 100,
    });

    const completedAttempt = await prisma.levelAttempt.findFirst({
      where: { questSessionId: sessionAId, levelNumber: 1, status: "COMPLETED" },
    });
    assert.ok(completedAttempt);

    await assert.rejects(
      async () =>
        saveAttemptCheckpoint(userIdA, sessionAId, completedAttempt.id, {
          currentTrialIdx: 7,
        }),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /completed or abandoned/i);
        return true;
      }
    );
  });

  it("7. advances resume destination to Level 2 after Level 1 completion", async () => {
    const resumeState = await getResumeState(userIdA);
    assert.equal(resumeState.hasResumableQuest, true);
    assert.equal(resumeState.destination, "/games/stroop?level=2");
    assert.equal(resumeState.currentLevel, 2);
  });

  it("8. handles multiple in-progress sessions deterministically and archives stale duplicates", async () => {
    // Create an older duplicate in-progress session
    const staleSession = await prisma.questSession.create({
      data: {
        userId: userIdA,
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
        startedAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });

    const resumeState = await getResumeState(userIdA);
    // Should select the newer primary session (at Level 2)
    assert.equal(resumeState.sessionId, sessionAId);
    assert.equal(resumeState.currentLevel, 2);

    // Verify stale session was marked as ABANDONED
    const archived = await prisma.questSession.findUnique({
      where: { id: staleSession.id },
    });
    assert.equal(archived?.status, "ABANDONED");
  });

  it("9. completed quest session does not resume as in-progress", async () => {
    const completedUserId = `qa_completed_user_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: completedUserId,
        name: "Completed Tester",
        email: `${completedUserId}@example.com`,
        status: "ACTIVE",
      },
    });

    await prisma.questSession.create({
      data: {
        userId: completedUserId,
        status: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        currentStage: "COMPLETED",
        completedAt: new Date(),
      },
    });

    const resumeState = await getResumeState(completedUserId);
    assert.equal(resumeState.hasResumableQuest, false);
    assert.equal(resumeState.destination, "/");

    await prisma.user.delete({ where: { id: completedUserId } });
  });
});
