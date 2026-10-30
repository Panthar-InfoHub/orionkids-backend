import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  createChildProfile,
  listChildren,
  getChildProfile,
  updateChildProfile,
  getChildProgress,
  getChildQuestSessions,
  getChildReports,
} from "../src/services/child.service.js";
import {
  getOrCreateActiveSession,
  getCurrentSession,
  getResumeState,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  generateOrGetReport,
} from "../src/services/quest.service.js";
import { ForbiddenError, NotFoundError } from "../src/utils/errors.js";

describe("Multi-Child Parent Accounts, Isolated Quests & Reports Test Suite", () => {
  const timestamp = Date.now();
  const parentAId = `qa_parent_a_${timestamp}`;
  const parentBId = `qa_parent_b_${timestamp}`;

  let childA1Id = "";
  let childA2Id = "";
  let childB1Id = "";

  let sessionChildA1Id = "";
  let sessionChildA2Id = "";

  before(async () => {
    // Parent A: Active Parent Account
    await prisma.user.create({
      data: {
        id: parentAId,
        name: "Priya Sharma (Parent A)",
        email: `parent_a_${timestamp}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });

    // Parent B: Different Active Parent Account
    await prisma.user.create({
      data: {
        id: parentBId,
        name: "Rohan Patel (Parent B)",
        email: `parent_b_${timestamp}@example.com`,
        status: "ACTIVE",
        role: "USER",
      },
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [parentAId, parentBId] } },
      });
    } catch {
      // Best effort cleanup
    }
  });

  it("1. newly registered parent can onboard their first child", async () => {
    const child1 = await createChildProfile(parentAId, {
      childName: "Aarav Sharma",
      age: 6,
      language: "English",
      school: "Orion International",
      selectedClass: "Classes 1",
      studentId: "STU-001",
      parentEmail: `parent_a_${timestamp}@example.com`,
      parentMobile: "+91 9876543210",
      isGuardian: true,
    });

    assert.ok(child1.id);
    assert.equal(child1.childName, "Aarav Sharma");
    assert.equal(child1.userId, parentAId);
    childA1Id = child1.id;

    // Verify parent has onboardingSubmittedAt recorded
    const parentUser = await prisma.user.findUnique({
      where: { id: parentAId },
      select: { onboardingSubmittedAt: true, email: true },
    });
    assert.ok(parentUser?.onboardingSubmittedAt);
    assert.equal(parentUser?.email, `parent_a_${timestamp}@example.com`);
  });

  it("2. the same parent can onboard a second child using the same account", async () => {
    const child2 = await createChildProfile(parentAId, {
      childName: "Diya Sharma",
      age: 8,
      language: "English",
      school: "St. Jude Academy",
      selectedClass: "Classes 2",
      studentId: "STU-002",
      parentEmail: `parent_a_${timestamp}@example.com`,
      parentMobile: "+91 9876543210",
      isGuardian: true,
    });

    assert.ok(child2.id);
    assert.equal(child2.childName, "Diya Sharma");
    assert.equal(child2.userId, parentAId);
    assert.notEqual(child2.id, childA1Id, "Child IDs must be distinct");
    childA2Id = child2.id;
  });

  it("3. adding a second child does not overwrite the first child or change parent account", async () => {
    const children = await listChildren(parentAId);
    assert.equal(children.length, 2, "Parent A must have exactly 2 registered children");

    const names = children.map((c) => c.childName);
    assert.ok(names.includes("Aarav Sharma"));
    assert.ok(names.includes("Diya Sharma"));

    // Parent account details remain intact
    const parent = await prisma.user.findUnique({
      where: { id: parentAId },
    });
    assert.equal(parent?.id, parentAId);
    assert.equal(parent?.email, `parent_a_${timestamp}@example.com`);
    assert.equal(parent?.name, "Priya Sharma (Parent A)");
  });

  it("4. Parent B onboards their own child", async () => {
    const childB = await createChildProfile(parentBId, {
      childName: "Kabir Patel",
      age: 7,
      language: "Hindi",
      school: "Delhi Public School",
      selectedClass: "Classes 2",
      studentId: "STU-B01",
      parentEmail: `parent_b_${timestamp}@example.com`,
      parentMobile: "+91 9811223344",
      isGuardian: true,
    });

    assert.ok(childB.id);
    assert.equal(childB.userId, parentBId);
    childB1Id = childB.id;
  });

  it("5. Parent A cannot access Parent B's child profile (strict isolation)", async () => {
    await assert.rejects(
      async () => {
        await getChildProfile(parentAId, childB1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("6. Parent B cannot access Parent A's child profile (strict isolation)", async () => {
    await assert.rejects(
      async () => {
        await getChildProfile(parentBId, childA1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("7. Starting a quest for Child A1 associates session strictly with Child A1", async () => {
    const session = await getOrCreateActiveSession(parentAId, childA1Id);
    assert.ok(session.id);
    assert.equal(session.userId, parentAId);
    assert.equal(session.childProfileId, childA1Id);
    assert.equal(session.currentStage, "WARM_UP");
    sessionChildA1Id = session.id;

    // Verify in database
    const dbSession = await prisma.questSession.findUnique({
      where: { id: session.id },
    });
    assert.equal(dbSession?.childProfileId, childA1Id);
  });

  it("8. Starting a quest for Child A2 creates an independent session for Child A2 (does not reuse Child A1)", async () => {
    const session2 = await getOrCreateActiveSession(parentAId, childA2Id);
    assert.ok(session2.id);
    assert.equal(session2.userId, parentAId);
    assert.equal(session2.childProfileId, childA2Id);
    assert.notEqual(session2.id, sessionChildA1Id, "Sessions between children must never collide");
    sessionChildA2Id = session2.id;
  });

  it("9. Both children can have independent in-progress sessions simultaneously under the same parent", async () => {
    const resumeA1 = await getResumeState(parentAId, childA1Id);
    const resumeA2 = await getResumeState(parentAId, childA2Id);

    assert.equal(resumeA1.hasResumableQuest, true);
    assert.equal(resumeA1.sessionId, sessionChildA1Id);
    assert.equal(resumeA1.childProfileId, childA1Id);

    assert.equal(resumeA2.hasResumableQuest, true);
    assert.equal(resumeA2.sessionId, sessionChildA2Id);
    assert.equal(resumeA2.childProfileId, childA2Id);
  });

  it("10. Child A1 level progression does NOT affect Child A2 progression", async () => {
    // 1. Complete warm-up for Child A1
    await saveWarmUpSubmission(parentAId, sessionChildA1Id, { "1": "answer" });

    // 2. Start and complete Stroop Level 1 for Child A1
    await startLevelAttempt(parentAId, sessionChildA1Id, "stroop", 1);
    const completedResult = await completeLevelAttempt(parentAId, sessionChildA1Id, {
      gameKey: "stroop",
      levelNumber: 1,
      attemptNumber: 1,
      totalTrials: 10,
      correctTrials: 10,
      accuracy: 100,
      durationMs: 5000,
    });

    assert.equal(completedResult.currentGame, 1);
    assert.equal(completedResult.currentLevel, 2);

    // 3. Verify Child A1 is on Level 2
    const resumeA1 = await getResumeState(parentAId, childA1Id);
    assert.equal(resumeA1.currentLevel, 2);
    assert.equal(resumeA1.destination, "/games/stroop?level=2");

    // 4. Verify Child A2 is STILL on WARM_UP (completely isolated!)
    const resumeA2 = await getResumeState(parentAId, childA2Id);
    assert.equal(resumeA2.currentStage, "WARM_UP");
    assert.equal(resumeA2.destination, "/warm-up");
  });

  it("11. Parent B cannot access Parent A's quest sessions", async () => {
    await assert.rejects(
      async () => {
        await startLevelAttempt(parentBId, sessionChildA1Id, "stroop", 2);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("12. getChildProgress returns authoritative 6-game matrix for selected child", async () => {
    const progressA1 = await getChildProgress(parentAId, childA1Id);
    assert.equal(progressA1.hasSession, true);
    assert.equal(progressA1.completedLevelsCount, 1);
    assert.equal(progressA1.child.childName, "Aarav Sharma");

    // Check Stroop game levels
    const stroopGame = progressA1.matrix.find((g) => g.key === "stroop");
    assert.ok(stroopGame);
    assert.equal(stroopGame.levels[0].status, "COMPLETED");
    assert.equal(stroopGame.levels[1].status, "IN_PROGRESS");
    assert.equal(stroopGame.levels[2].status, "LOCKED");

    // Child A2 progress is 0
    const progressA2 = await getChildProgress(parentAId, childA2Id);
    assert.equal(progressA2.completedLevelsCount, 0);
    assert.equal(progressA2.child.childName, "Diya Sharma");
  });

  it("13. getChildQuestSessions lists only sessions belonging to that child", async () => {
    const sessionsA1 = await getChildQuestSessions(parentAId, childA1Id);
    assert.equal(sessionsA1.length, 1);
    assert.equal(sessionsA1[0].id, sessionChildA1Id);

    const sessionsA2 = await getChildQuestSessions(parentAId, childA2Id);
    assert.equal(sessionsA2.length, 1);
    assert.equal(sessionsA2[0].id, sessionChildA2Id);
  });

  it("14. Updating Child A1 profile does not affect Child A2", async () => {
    const updated = await updateChildProfile(parentAId, childA1Id, {
      school: "Orion Advanced Academy",
    });
    assert.equal(updated.school, "Orion Advanced Academy");

    const childA2 = await getChildProfile(parentAId, childA2Id);
    assert.equal(childA2.school, "St. Jude Academy");
  });

  it("15. Tampering with childId in getChildProgress or getChildReports is rejected", async () => {
    await assert.rejects(
      async () => {
        await getChildProgress(parentAId, childB1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );

    await assert.rejects(
      async () => {
        await getChildReports(parentAId, childB1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("16. List children endpoint reflects updated stats dynamically", async () => {
    const children = await listChildren(parentAId);
    assert.equal(children.length, 2);

    const aarav = children.find((c) => c.childName === "Aarav Sharma");
    assert.ok(aarav);
    assert.equal(aarav.stats.completedLevelsCount, 1);
    assert.equal(aarav.stats.currentGame, 1);
    assert.equal(aarav.stats.currentLevel, 2);

    const diya = children.find((c) => c.childName === "Diya Sharma");
    assert.ok(diya);
    assert.equal(diya.stats.completedLevelsCount, 0);
  });
});
