import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  createChildProfile,
  listChildren,
  getChildProfile,
  getChildProgress,
  getChildReports,
} from "../src/services/child.service.js";
import { submitUserOnboarding } from "../src/services/onboarding.service.js";
import {
  getOrCreateActiveSession,
  getResumeState,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  generateOrGetReport,
} from "../src/services/quest.service.js";
import {
  getUserDetail,
  getUserChildren,
} from "../src/services/admin.service.js";
import { ForbiddenError } from "../src/utils/errors.js";

describe("Repeatable Child Onboarding, Independent Records & Parent Analytics", () => {
  const timestamp = Date.now();
  let parent1Id: string;
  let parent2Id: string;
  let adminId: string;

  let child1Id: string;
  let child1SessionId: string;
  let child2Id: string;
  let child2SessionId: string;
  let child3Id: string;
  let child3SessionId: string;

  before(async () => {
    // 1. Create Parent 1 (USER_123 equivalent)
    const p1 = await prisma.user.create({
      data: {
        id: `parent_p1_${timestamp}`,
        email: `parent1_${timestamp}@example.com`,
        name: "Vikram Sahu",
        role: "USER",
        status: "ACTIVE",
      },
    });
    parent1Id = p1.id;

    // 2. Create Parent 2
    const p2 = await prisma.user.create({
      data: {
        id: `parent_p2_${timestamp}`,
        email: `parent2_${timestamp}@example.com`,
        name: "Meera Sen",
        role: "USER",
        status: "ACTIVE",
      },
    });
    parent2Id = p2.id;

    // 3. Create Admin
    const adm = await prisma.user.create({
      data: {
        id: `admin_eval_${timestamp}`,
        email: `admin_eval_${timestamp}@example.com`,
        name: "Chief Admin",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    adminId = adm.id;
  });

  after(async () => {
    // Clean up created entities
    await prisma.levelAttempt.deleteMany({
      where: { userId: { in: [parent1Id, parent2Id, adminId] } },
    });
    await prisma.warmUpSubmission.deleteMany({
      where: { questSession: { userId: { in: [parent1Id, parent2Id, adminId] } } },
    });
    await prisma.questReport.deleteMany({
      where: { userId: { in: [parent1Id, parent2Id, adminId] } },
    });
    await prisma.questSession.deleteMany({
      where: { userId: { in: [parent1Id, parent2Id, adminId] } },
    });
    await prisma.childProfile.deleteMany({
      where: { userId: { in: [parent1Id, parent2Id, adminId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [parent1Id, parent2Id, adminId] } },
    });
  });

  it("1. Parent can onboard their first child ('Aanya Sahu')", async () => {
    const res = await submitUserOnboarding(parent1Id, {
      childName: "Aanya Sahu",
      age: 6,
      language: "English",
      school: "Orion Primary School",
      selectedClass: "Classes 1",
      studentId: "STU-001",
      parentEmail: "vikram@example.com",
      parentMobile: "+91 9988776655",
      isGuardian: true,
    });

    assert.ok(res.childProfile);
    assert.equal(res.childProfile.childName, "Aanya Sahu");
    assert.equal(res.childProfile.userId, parent1Id);
    assert.ok(res.childProfile.id);
    assert.ok(res.session);
    assert.equal(res.session.childProfileId, res.childProfile.id);
    assert.equal(res.session.userId, parent1Id);

    child1Id = res.childProfile.id;
    child1SessionId = res.session.id;
  });

  it("2. Parent can onboard the SAME child name again ('Aanya Sahu')", async () => {
    const res = await submitUserOnboarding(parent1Id, {
      childName: "Aanya Sahu",
      age: 6,
      language: "English",
      school: "Orion Primary School",
      selectedClass: "Classes 1",
      studentId: "STU-001-B",
      parentEmail: "vikram@example.com",
      parentMobile: "+91 9988776655",
      isGuardian: true,
    });

    assert.ok(res.childProfile);
    assert.equal(res.childProfile.childName, "Aanya Sahu");
    assert.equal(res.childProfile.userId, parent1Id);

    child2Id = res.childProfile.id;
    child2SessionId = res.session.id;
  });

  it("3. Both same-name submissions create SEPARATE child profile IDs", async () => {
    assert.notEqual(
      child1Id,
      child2Id,
      "Second onboarding with same name MUST produce a distinct childProfile ID"
    );

    const c1 = await getChildProfile(parent1Id, child1Id);
    const c2 = await getChildProfile(parent1Id, child2Id);
    assert.equal(c1.childName, "Aanya Sahu");
    assert.equal(c2.childName, "Aanya Sahu");
    assert.notEqual(c1.id, c2.id);
  });

  it("4. Both same-name profiles have independent quest sessions", async () => {
    assert.notEqual(
      child1SessionId,
      child2SessionId,
      "Each child onboarding MUST produce an independent quest session ID"
    );

    const session1 = await prisma.questSession.findUnique({
      where: { id: child1SessionId },
    });
    const session2 = await prisma.questSession.findUnique({
      where: { id: child2SessionId },
    });

    assert.equal(session1?.childProfileId, child1Id);
    assert.equal(session2?.childProfileId, child2Id);
  });

  it("5. Parent can onboard a different child name ('Rahul Sahu')", async () => {
    const res = await createChildProfile(parent1Id, {
      childName: "Rahul Sahu",
      age: 8,
      language: "English",
      school: "Orion High School",
      selectedClass: "Classes 2",
      studentId: "STU-003",
      parentEmail: "vikram@example.com",
      parentMobile: "+91 9988776655",
      isGuardian: true,
    });

    assert.ok(res.id);
    assert.equal(res.childName, "Rahul Sahu");
    assert.equal(res.userId, parent1Id);
    assert.notEqual(res.id, child1Id);
    assert.notEqual(res.id, child2Id);

    child3Id = res.id;
    child3SessionId = res.initialSessionId;
  });

  it("6. All three child records remain associated with the same parent user ID", async () => {
    const children = await listChildren(parent1Id);
    assert.equal(children.length, 3);
    assert.ok(children.every((c) => c.userId === parent1Id));

    const ids = children.map((c) => c.id);
    assert.ok(ids.includes(child1Id));
    assert.ok(ids.includes(child2Id));
    assert.ok(ids.includes(child3Id));
  });

  it("7. Every onboarding submission produces a new session", async () => {
    const sessionIds = [child1SessionId, child2SessionId, child3SessionId];
    const uniqueSessionIds = new Set(sessionIds);
    assert.equal(
      uniqueSessionIds.size,
      3,
      "All 3 quest sessions must be strictly distinct"
    );
  });

  it("8. A double-click or network retry of the same request does not create accidental duplicates (Idempotency)", async () => {
    const testIdempotencyKey = `idem_key_${timestamp}`;

    // First deliberate submission with idempotency key
    const firstCall = await createChildProfile(
      parent1Id,
      {
        childName: "Rohan Sahu",
        age: 7,
        language: "English",
        school: "Orion Grammar",
        selectedClass: "Classes 2",
        parentEmail: "vikram@example.com",
        parentMobile: "+91 9988776655",
        isGuardian: true,
      },
      testIdempotencyKey
    );

    // Second accidental duplicate call (e.g. rapid double-click or network retry)
    const secondCall = await createChildProfile(
      parent1Id,
      {
        childName: "Rohan Sahu",
        age: 7,
        language: "English",
        school: "Orion Grammar",
        selectedClass: "Classes 2",
        parentEmail: "vikram@example.com",
        parentMobile: "+91 9988776655",
        isGuardian: true,
      },
      testIdempotencyKey
    );

    assert.equal(
      firstCall.id,
      secondCall.id,
      "Duplicate submission with identical idempotency key must return the exact same profile"
    );
    assert.equal(
      firstCall.initialSessionId,
      secondCall.initialSessionId,
      "Duplicate submission must return the exact same session"
    );

    // Clean up temporary rohan profile
    await prisma.questSession.deleteMany({ where: { childProfileId: firstCall.id } });
    await prisma.childProfile.delete({ where: { id: firstCall.id } });
  });

  it("9. Two deliberate submissions create two distinct profiles even when the names match", async () => {
    const children = await listChildren(parent1Id);
    const aanyaProfiles = children.filter((c) => c.childName === "Aanya Sahu");
    assert.equal(
      aanyaProfiles.length,
      2,
      "Must have 2 separate profiles for Aanya Sahu"
    );
    assert.notEqual(aanyaProfiles[0].id, aanyaProfiles[1].id);
  });

  it("10. Child 1 progression does NOT affect Child 2 progression", async () => {
    // Child 1 completes Warm-Up and Stroop Level 1
    await saveWarmUpSubmission(parent1Id, child1SessionId, { "1": "answer" });
    await startLevelAttempt(parent1Id, child1SessionId, "stroop", 1);
    await completeLevelAttempt(parent1Id, child1SessionId, {
      gameKey: "stroop",
      levelNumber: 1,
      attemptNumber: 1,
      totalTrials: 10,
      correctTrials: 10,
      accuracy: 100,
      durationMs: 4500,
    });

    // Check Child 1 resume state: advanced to level 2
    const resume1 = await getResumeState(parent1Id, child1Id);
    assert.equal(resume1.currentLevel, 2);
    assert.equal(resume1.destination, "/games/stroop?level=2");

    // Check Child 2 resume state: STILL on warm-up (0 progress!)
    const resume2 = await getResumeState(parent1Id, child2Id);
    assert.equal(resume2.currentStage, "WARM_UP");
    assert.equal(resume2.destination, "/warm-up");
  });

  it("11. Child 1's level attempts do NOT appear in Child 2's progress matrix", async () => {
    const progress1 = await getChildProgress(parent1Id, child1Id);
    const progress2 = await getChildProgress(parent1Id, child2Id);

    assert.equal(progress1.completedLevelsCount, 1);
    assert.equal(progress2.completedLevelsCount, 0);

    const p1Stroop = progress1.matrix.find((g) => g.key === "stroop");
    const p2Stroop = progress2.matrix.find((g) => g.key === "stroop");

    assert.equal(p1Stroop?.levels[0].status, "COMPLETED");
    assert.equal(p2Stroop?.levels[0].status, "LOCKED");
  });

  it("12. A parent cannot access another parent's child profiles (IDOR prevention)", async () => {
    await assert.rejects(
      async () => {
        await getChildProfile(parent2Id, child1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("13. A parent cannot access another parent's sessions or reports", async () => {
    await assert.rejects(
      async () => {
        await startLevelAttempt(parent2Id, child1SessionId, "stroop", 2);
      },
      (err: any) => err instanceof ForbiddenError
    );

    await assert.rejects(
      async () => {
        await getChildReports(parent2Id, child1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("14. Admin can see all child records belonging to Parent 1", async () => {
    const adminChildren = await getUserChildren(parent1Id);
    assert.equal(adminChildren.length, 3);

    const names = adminChildren.map((c) => c.childName);
    assert.equal(names.filter((n) => n === "Aanya Sahu").length, 2);
    assert.equal(names.filter((n) => n === "Rahul Sahu").length, 1);
  });

  it("15. Admin can distinguish same-name profiles by ID and see accurate stats", async () => {
    const adminChildren = await getUserChildren(parent1Id);
    const aanyas = adminChildren.filter((c) => c.childName === "Aanya Sahu");

    assert.equal(aanyas.length, 2);
    assert.notEqual(aanyas[0].id, aanyas[1].id);

    // One Aanya has 1 completed level, the other has 0
    const aanya1 = aanyas.find((a) => a.id === child1Id);
    const aanya2 = aanyas.find((a) => a.id === child2Id);

    assert.ok(aanya1);
    assert.ok(aanya2);
    assert.equal(aanya1.completedLevels, 1);
    assert.equal(aanya2.completedLevels, 0);
  });

  it("16. Parent analytics accurately aggregate all child records and sessions", async () => {
    const userDetail = await getUserDetail(parent1Id);

    assert.equal(userDetail.user.id, parent1Id);
    assert.equal(userDetail.stats.childProfileCount, 3);
    assert.equal(userDetail.stats.totalSessions, 3);
    assert.equal(userDetail.stats.inProgressSessions, 3);
    assert.equal(userDetail.stats.completedSessions, 0);
    assert.equal(userDetail.stats.abandonedSessions, 0);
    assert.equal(
      userDetail.stats.totalCompletedLevels,
      1,
      "Aggregated completed levels across all sessions must equal 1"
    );
  });

  it("17. Existing resume behavior still works within an individual session", async () => {
    const resumeA1 = await getResumeState(parent1Id, child1Id);
    assert.equal(resumeA1.hasResumableQuest, true);
    assert.equal(resumeA1.sessionId, child1SessionId);
    assert.equal(resumeA1.currentLevel, 2);
    assert.equal(resumeA1.destination, "/games/stroop?level=2");
  });
});
