import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getAdminOverview,
  listUsers,
  getUserDetail,
  getUserChildren,
  getUserQuestSessions,
  getUserQuestSessionDetail,
  getUserSessionAttempts,
  getUserSessionReport,
  setUserStatus,
  getUserChildDetail,
  getUserChildQuestSessions,
  getUserChildQuestSessionDetail,
  getUserChildSessionAttempts,
  getUserChildSessionReport,
  getAdminQuestSessionDetail,
} from "../src/services/admin.service.js";
import {
  ForbiddenError,
  NotFoundError,
} from "../src/utils/errors.js";

describe("Admin User 360° Service & Authorization Test Suite", () => {
  const timestamp = Date.now();
  const adminUser = {
    id: `admin_test_${timestamp}`,
    name: "Admin Tester",
    email: `admin_${timestamp}@example.com`,
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
  };

  const normalUserA = {
    id: `user_a_${timestamp}`,
    name: "Alice Parent",
    email: `alice_${timestamp}@example.com`,
    role: "USER" as const,
    status: "ACTIVE" as const,
  };

  const normalUserB = {
    id: `user_b_${timestamp}`,
    name: "Bob Parent",
    email: `bob_${timestamp}@example.com`,
    role: "USER" as const,
    status: "PENDING" as const,
    onboardingSubmittedAt: new Date(),
  };

  let sessionAId = "";
  let attemptA1Id = "";
  let childAId = "";

  before(async () => {
    // 1. Create admin user
    await prisma.user.create({ data: adminUser });

    // 2. Create User A with child profile and quest session
    await prisma.user.create({
      data: {
        ...normalUserA,
        childProfiles: {
          create: {
            childName: "Charlie",
            age: 8,
            language: "English",
            school: "Orion Elementary",
            selectedClass: "Grade 3",
            parentEmail: normalUserA.email,
            parentMobile: "+1234567890",
            isGuardian: true,
          },
        },
      },
    });

    // 3. Create User B with pending status
    await prisma.user.create({ data: normalUserB });

    // 4. Create quest session for User A
    const childProfile = await prisma.childProfile.findFirst({ where: { userId: normalUserA.id } });
    if (childProfile) childAId = childProfile.id;

    const sessionA = await prisma.questSession.create({
      data: {
        userId: normalUserA.id,
        childProfileId: childAId || undefined,
        status: "IN_PROGRESS",
        currentStage: "GAME_1_LEVEL_2",
        currentGame: 1,
        currentLevel: 2,
        warmUpSubmission: {
          create: {
            userId: normalUserA.id,
            answers: { q1: "Focused", q2: "Energetic" },
          },
        },
      },
    });
    sessionAId = sessionA.id;

    // 5. Create level attempt for User A (Game 1, Level 1 completed)
    const attempt = await prisma.levelAttempt.create({
      data: {
        questSessionId: sessionAId,
        userId: normalUserA.id,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 9,
        accuracy: 90,
        durationMs: 42000,
        averageReactionTimeMs: 780,
        metrics: { consistency: 0.88 },
        trialRecords: [{ trial: 1, correct: true, reactionTimeMs: 750 }],
        completedAt: new Date(),
      },
    });
    attemptA1Id = attempt.id;
  });

  after(async () => {
    // Cleanup test fixtures in correct relational order
    await prisma.levelAttempt.deleteMany({
      where: { userId: { in: [adminUser.id, normalUserA.id, normalUserB.id] } },
    });
    await prisma.warmUpSubmission.deleteMany({
      where: { userId: { in: [adminUser.id, normalUserA.id, normalUserB.id] } },
    });
    await prisma.questSession.deleteMany({
      where: { userId: { in: [adminUser.id, normalUserA.id, normalUserB.id] } },
    });
    await prisma.childProfile.deleteMany({
      where: { userId: { in: [adminUser.id, normalUserA.id, normalUserB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUser.id, normalUserA.id, normalUserB.id] } },
    });
  });

  it("1. getAdminOverview returns accurate system aggregate metrics", async () => {
    const overview = await getAdminOverview();
    assert.ok(overview.accounts.total >= 3);
    assert.ok(overview.accounts.active >= 2);
    assert.ok(overview.accounts.pending >= 1);
    assert.ok(overview.accounts.admins >= 1);
    assert.ok(overview.children.total >= 1);
    assert.ok(overview.sessions.total >= 1);
    assert.ok(overview.sessions.inProgress >= 1);
    assert.ok(Array.isArray(overview.recentRegistrations));
  });

  it("2. listUsers filters by search query and status", async () => {
    // Search by name
    const searchResult = await listUsers({ page: 1, limit: 10, search: "Alice Parent" });
    assert.ok(searchResult.users.length >= 1);
    assert.equal(searchResult.users[0].id, normalUserA.id);
    assert.ok(searchResult.users[0].childProfile);
    assert.equal(searchResult.users[0].childProfile.childName, "Charlie");

    // Filter by PENDING status
    const pendingResult = await listUsers({ page: 1, limit: 10, status: "PENDING" });
    assert.ok(pendingResult.users.some((u) => u.id === normalUserB.id));
  });

  it("3. getUserDetail returns 360° overview and quest statistics", async () => {
    const detail = await getUserDetail(normalUserA.id);
    assert.equal(detail.user.id, normalUserA.id);
    assert.equal(detail.user.name, "Alice Parent");
    assert.equal(detail.stats.childProfileCount, 1);
    assert.equal(detail.stats.totalSessions, 1);
    assert.equal(detail.stats.inProgressSessions, 1);
    assert.equal(detail.stats.completedSessions, 0);
    assert.ok(detail.stats.latestSession);
    assert.equal(detail.stats.latestSession.id, sessionAId);

    // Verify NotFoundError for nonexistent user
    await assert.rejects(
      async () => getUserDetail("nonexistent_user_xyz"),
      (err: any) => err instanceof NotFoundError
    );
  });

  it("4. getUserChildren returns scoped child profiles", async () => {
    const children = await getUserChildren(normalUserA.id);
    assert.equal(children.length, 1);
    assert.equal(children[0].childName, "Charlie");
    assert.equal(children[0].selectedClass, "Grade 3");

    // User without children returns empty array
    const emptyChildren = await getUserChildren(normalUserB.id);
    assert.deepEqual(emptyChildren, []);
  });

  it("5. getUserQuestSessions returns session list with authoritative progression", async () => {
    const res = await getUserQuestSessions(normalUserA.id, { page: 1, limit: 10 });
    assert.equal(res.sessions.length, 1);
    const session = res.sessions[0];
    assert.equal(session.id, sessionAId);
    assert.equal(session.warmUpCompleted, true);
    assert.equal(session.completedLevelsCount, 1); // Level 1 is completed
    assert.equal(session.totalLevels, 18);
    assert.equal(session.hasReport, false);
    assert.equal(session.totalAttemptsCount, 1);
  });

  it("6. getUserQuestSessionDetail renders canonical 6 games with 3 levels each", async () => {
    const detail = await getUserQuestSessionDetail(normalUserA.id, sessionAId);
    assert.equal(detail.session.id, sessionAId);
    assert.ok(detail.warmUp);
    assert.equal(detail.warmUp.answers.q1, "Focused");
    assert.equal(detail.progression.highestCompletedIndex, 1);
    assert.equal(detail.progression.games.length, 6);

    // Stroop game (Game 1)
    const stroopGame = detail.progression.games[0];
    assert.equal(stroopGame.gameKey, "stroop");
    assert.equal(stroopGame.completedLevels, 1);
    assert.equal(stroopGame.levels[0].status, "COMPLETED");
    assert.equal(stroopGame.levels[0].bestAccuracy, 90);
    assert.equal(stroopGame.levels[1].status, "IN_PROGRESS");
    assert.equal(stroopGame.levels[2].status, "LOCKED");

    // Other games should be locked
    const cardFlipGame = detail.progression.games[1];
    assert.equal(cardFlipGame.gameKey, "card-flip");
    assert.equal(cardFlipGame.completedLevels, 0);
  });

  it("7. enforces strict relationship security: cross-user session access is forbidden", async () => {
    // Admin attempting to view User B's sessions with User A's sessionId MUST be rejected
    await assert.rejects(
      async () => getUserQuestSessionDetail(normalUserB.id, sessionAId),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );

    await assert.rejects(
      async () => getUserSessionAttempts(normalUserB.id, sessionAId, { page: 1, limit: 50 }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );
  });

  it("8. getUserSessionAttempts retrieves genuine gameplay telemetry", async () => {
    const attemptsRes = await getUserSessionAttempts(normalUserA.id, sessionAId, {
      page: 1,
      limit: 50,
    });
    assert.equal(attemptsRes.attempts.length, 1);
    const attempt = attemptsRes.attempts[0];
    assert.equal(attempt.id, attemptA1Id);
    assert.equal(attempt.accuracy, 90);
    assert.equal(attempt.totalTrials, 10);
    assert.equal(attempt.correctTrials, 9);
    assert.ok(Array.isArray(attempt.trialRecords));
  });

  it("9. getUserSessionReport honestly reports unavailable for in-progress session", async () => {
    const reportRes = await getUserSessionReport(normalUserA.id, sessionAId);
    assert.equal(reportRes.hasReport, false);
    assert.equal(reportRes.reason, "QUEST_IN_PROGRESS");
    assert.ok(reportRes.message.includes("in progress"));
  });

  it("10. setUserStatus prevents self-restriction and successfully mutates status", async () => {
    // Admin cannot restrict self
    await assert.rejects(
      async () =>
        setUserStatus(adminUser.id, adminUser.id, {
          status: "RESTRICTED",
          reason: "Testing self-restriction block",
        }),
      (err: any) => err instanceof ForbiddenError
    );

    // Admin approves User B
    const approved = await setUserStatus(adminUser.id, normalUserB.id, {
      status: "ACTIVE",
    });
    assert.equal(approved.status, "ACTIVE");
    assert.equal(approved.reviewedById, adminUser.id);
    assert.ok(approved.reviewedAt);

    // Admin restricts User B with reason
    const restricted = await setUserStatus(adminUser.id, normalUserB.id, {
      status: "RESTRICTED",
      reason: "Suspicious activity detected during audit",
    });
    assert.equal(restricted.status, "RESTRICTED");
    assert.equal(restricted.restrictedReason, "Suspicious activity detected during audit");
  });

  it("11. getUserChildDetail returns comprehensive child & parent info and stats", async () => {
    const detail = await getUserChildDetail(normalUserA.id, childAId);
    assert.equal(detail.id, childAId);
    assert.equal(detail.childName, "Charlie");
    assert.equal(detail.parentName, "Alice Parent");
    assert.equal(detail.parentEmail, normalUserA.email);
    assert.equal(detail.age, 8);
    assert.equal(detail.selectedClass, "Grade 3");
    assert.equal(detail.school, "Orion Elementary");
    assert.equal(detail.stats.totalSessions, 1);
    assert.equal(detail.stats.sessionStatus, "IN_PROGRESS");
    assert.equal(detail.stats.completedLevels, 1);

    // NotFound for invalid child ID
    await assert.rejects(
      async () => getUserChildDetail(normalUserA.id, "nonexistent_child_xyz"),
      (err: any) => err instanceof NotFoundError
    );

    // Forbidden if child does not belong to specified user
    await assert.rejects(
      async () => getUserChildDetail(normalUserB.id, childAId),
      (err: any) => err instanceof ForbiddenError
    );
  });

  it("12. getUserChildQuestSessions strictly isolates sessions by childProfileId", async () => {
    // Create a second child profile for normalUserA with SAME name "Charlie" (repeatable onboarding)
    const secondChild = await prisma.childProfile.create({
      data: {
        userId: normalUserA.id,
        childName: "Charlie",
        age: 8,
        language: "English",
        selectedClass: "Grade 3",
        parentEmail: normalUserA.email,
        parentMobile: "+1234567890",
      },
    });

    // Create session strictly for second child
    const secondSession = await prisma.questSession.create({
      data: {
        userId: normalUserA.id,
        childProfileId: secondChild.id,
        status: "COMPLETED",
        currentStage: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
      },
    });

    // Fetch Child 1 sessions -> must ONLY contain sessionA
    const child1Sessions = await getUserChildQuestSessions(normalUserA.id, childAId, {
      page: 1,
      limit: 10,
    });
    assert.equal(child1Sessions.sessions.length, 1);
    assert.equal(child1Sessions.sessions[0].id, sessionAId);
    assert.equal(child1Sessions.sessions[0].childProfileId, childAId);

    // Fetch Child 2 sessions -> must ONLY contain secondSession
    const child2Sessions = await getUserChildQuestSessions(normalUserA.id, secondChild.id, {
      page: 1,
      limit: 10,
    });
    assert.equal(child2Sessions.sessions.length, 1);
    assert.equal(child2Sessions.sessions[0].id, secondSession.id);
    assert.equal(child2Sessions.sessions[0].childProfileId, secondChild.id);

    // Status filtering works on child sessions
    const completedChild1 = await getUserChildQuestSessions(normalUserA.id, childAId, {
      page: 1,
      limit: 10,
      status: "COMPLETED",
    });
    assert.equal(completedChild1.sessions.length, 0);

    const inProgressChild1 = await getUserChildQuestSessions(normalUserA.id, childAId, {
      page: 1,
      limit: 10,
      status: "IN_PROGRESS",
    });
    assert.equal(inProgressChild1.sessions.length, 1);

    // Clean up secondChild and its session
    await prisma.questSession.delete({ where: { id: secondSession.id } });
    await prisma.childProfile.delete({ where: { id: secondChild.id } });
  });

  it("13. getUserChildQuestSessionDetail verifies child ownership and rejects mismatched child ID", async () => {
    // Valid child and session
    const detail = await getUserChildQuestSessionDetail(normalUserA.id, childAId, sessionAId);
    assert.equal(detail.session.id, sessionAId);
    assert.equal(detail.session.childProfileId, childAId);

    // Create a temporary dummy child under User A
    const dummyChild = await prisma.childProfile.create({
      data: {
        userId: normalUserA.id,
        childName: "Temporary",
        age: 7,
        language: "English",
        selectedClass: "Grade 2",
        parentEmail: normalUserA.email,
        parentMobile: "+1234567890",
      },
    });

    // Attempting to access sessionA under dummyChild must be rejected with ForbiddenError
    await assert.rejects(
      async () =>
        getUserChildQuestSessionDetail(normalUserA.id, dummyChild.id, sessionAId),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );

    // Clean up dummy child
    await prisma.childProfile.delete({ where: { id: dummyChild.id } });
  });

  it("14. getAdminQuestSessionDetail allows direct session lookup", async () => {
    const detail = await getAdminQuestSessionDetail(sessionAId);
    assert.equal(detail.session.id, sessionAId);
    assert.equal(detail.session.userId, normalUserA.id);

    await assert.rejects(
      async () => getAdminQuestSessionDetail("nonexistent_session_id"),
      (err: any) => err instanceof NotFoundError
    );
  });

});
