import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getUserDetail,
  getUserChildren,
  getUserChildDetail,
  getUserChildQuestSessions,
  getUserChildQuestSessionDetail,
  getUserChildSessionAttempts,
  getUserChildSessionReport,
} from "../src/services/admin.service.js";
import { NotFoundError, ForbiddenError } from "../src/utils/errors.js";

describe("Admin Dashboard Child-First Navigation & Isolation Verification Suite", () => {
  const ts = Date.now();
  const parentAId = "test_parent_a_" + ts;
  const parentBId = "test_parent_b_" + ts;

  let childA1Id = "";
  let childA2Id = "";
  let childA3Id = "";
  let childB1Id = "";

  let sessionA1CompletedId = "";
  let sessionA1InProgressId = "";
  let sessionA2InProgressId = "";
  let sessionB1Id = "";

  before(async () => {
    // 1. Create Parent A
    await prisma.user.create({
      data: {
        id: parentAId,
        name: "Pooja Sahu",
        email: "pooja_" + ts + "@example.com",
        role: "USER",
        status: "ACTIVE",
      },
    });

    // 2. Create Parent B
    await prisma.user.create({
      data: {
        id: parentBId,
        name: "Vikram Sharma",
        email: "vikram_" + ts + "@example.com",
        role: "USER",
        status: "ACTIVE",
      },
    });

    // 3. Create two children with IDENTICAL names for Parent A (repeatable onboarding)
    const c1 = await prisma.childProfile.create({
      data: {
        userId: parentAId,
        childName: "Aanya Sahu",
        age: 8,
        language: "English",
        selectedClass: "Grade 3",
        school: "Delhi Public School",
        parentEmail: "pooja_" + ts + "@example.com",
        parentMobile: "+919876543210",
        isGuardian: true,
      },
    });
    childA1Id = c1.id;

    const c2 = await prisma.childProfile.create({
      data: {
        userId: parentAId,
        childName: "Aanya Sahu", // Same name!
        age: 8,
        language: "Hindi",
        selectedClass: "Grade 3",
        school: "Delhi Public School",
        parentEmail: "pooja_" + ts + "@example.com",
        parentMobile: "+919876543210",
        isGuardian: true,
      },
    });
    childA2Id = c2.id;

    // 4. Create third child for Parent A with different name
    const c3 = await prisma.childProfile.create({
      data: {
        userId: parentAId,
        childName: "Aarav Sahu",
        age: 6,
        language: "English",
        selectedClass: "Grade 1",
        school: "Delhi Public School",
        parentEmail: "pooja_" + ts + "@example.com",
        parentMobile: "+919876543210",
        isGuardian: true,
      },
    });
    childA3Id = c3.id;

    // 5. Create Child for Parent B
    const cb = await prisma.childProfile.create({
      data: {
        userId: parentBId,
        childName: "Rohan Sharma",
        age: 9,
        language: "English",
        selectedClass: "Grade 4",
        parentEmail: "vikram_" + ts + "@example.com",
        parentMobile: "+919876543211",
        isGuardian: true,
      },
    });
    childB1Id = cb.id;

    // 6. Create Sessions for Child A1:
    // Session A1-1: Completed with 18 levels and report
    const sA1Comp = await prisma.questSession.create({
      data: {
        userId: parentAId,
        childProfileId: childA1Id,
        status: "COMPLETED",
        currentStage: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        completedAt: new Date(),
        warmUpSubmission: {
          create: {
            userId: parentAId,
            answers: { energy: "High", focus: "Good" },
          },
        },
        questReport: {
          create: {
            userId: parentAId,
            childProfileId: childA1Id,
            childName: "Aanya Sahu",
            age: 8,
            selectedClass: "Grade 3",
            overallAccuracy: 94.5,
            totalDurationMs: 420000,
            gameSummaries: {},
            cognitiveFacets: {},
            growthObservations: {},
          },
        },
      },
    });
    sessionA1CompletedId = sA1Comp.id;

    // Create 18 completed level attempts for sA1Comp
    const games = [
      "stroop",
      "card-flip",
      "odd-one-out",
      "pattern",
      "story-sequencing",
      "rule-discovery",
    ];
    for (let g = 0; g < 6; g++) {
      for (let l = 1; l <= 3; l++) {
        await prisma.levelAttempt.create({
          data: {
            questSessionId: sessionA1CompletedId,
            userId: parentAId,
            gameId: g + 1,
            gameKey: games[g],
            levelNumber: l,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 10,
            correctTrials: 9,
            accuracy: 90,
            durationMs: 25000,
            completedAt: new Date(),
          },
        });
      }
    }

    // Session A1-2: In Progress at Level 2
    const sA1InProg = await prisma.questSession.create({
      data: {
        userId: parentAId,
        childProfileId: childA1Id,
        status: "IN_PROGRESS",
        currentStage: "GAME_1_LEVEL_2",
        currentGame: 1,
        currentLevel: 2,
        warmUpSubmission: {
          create: {
            userId: parentAId,
            answers: { q: "ready" },
          },
        },
      },
    });
    sessionA1InProgressId = sA1InProg.id;

    await prisma.levelAttempt.create({
      data: {
        questSessionId: sessionA1InProgressId,
        userId: parentAId,
        gameId: 1,
        gameKey: "stroop",
        levelNumber: 1,
        attemptNumber: 1,
        status: "COMPLETED",
        totalTrials: 10,
        correctTrials: 10,
        accuracy: 100,
        durationMs: 20000,
        completedAt: new Date(),
      },
    });

    // Session A2-1: For Child A2 (In progress, 0 completed levels)
    const sA2InProg = await prisma.questSession.create({
      data: {
        userId: parentAId,
        childProfileId: childA2Id,
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
      },
    });
    sessionA2InProgressId = sA2InProg.id;

    // Session B1: For Parent B Child B1
    const sB1 = await prisma.questSession.create({
      data: {
        userId: parentBId,
        childProfileId: childB1Id,
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
      },
    });
    sessionB1Id = sB1.id;
  });

  after(async () => {
    // Cleanup fixtures
    await prisma.levelAttempt.deleteMany({
      where: { userId: { in: [parentAId, parentBId] } },
    });
    await prisma.questReport.deleteMany({
      where: { userId: { in: [parentAId, parentBId] } },
    });
    await prisma.warmUpSubmission.deleteMany({
      where: { userId: { in: [parentAId, parentBId] } },
    });
    await prisma.questSession.deleteMany({
      where: { userId: { in: [parentAId, parentBId] } },
    });
    await prisma.childProfile.deleteMany({
      where: { userId: { in: [parentAId, parentBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [parentAId, parentBId] } },
    });
  });

  it("Scenario 1 & 2: Parent overview aggregates statistics and returns all child cards", async () => {
    const parentDetail = await getUserDetail(parentAId);
    assert.equal(parentDetail.user.id, parentAId);
    assert.equal(parentDetail.user.name, "Pooja Sahu");
    assert.equal(parentDetail.stats.childProfileCount, 3);
    assert.equal(parentDetail.stats.totalSessions, 3);
    assert.equal(parentDetail.stats.completedSessions, 1);
    assert.equal(parentDetail.stats.inProgressSessions, 2);
    assert.equal(parentDetail.stats.totalCompletedLevels, 19);

    const children = await getUserChildren(parentAId);
    assert.equal(children.length, 3);
    // All 3 children are visible as separate cards
    assert.equal(children[0].childName, "Aanya Sahu");
    assert.equal(children[1].childName, "Aanya Sahu");
    assert.equal(children[2].childName, "Aarav Sahu");
    assert.notEqual(children[0].id, children[1].id);
  });

  it("Scenario 3, 4 & 5: Selecting Child 1 displays ONLY Child 1 sessions and analytics", async () => {
    const c1Detail = await getUserChildDetail(parentAId, childA1Id);
    assert.equal(c1Detail.id, childA1Id);
    assert.equal(c1Detail.childName, "Aanya Sahu");
    assert.equal(c1Detail.parentName, "Pooja Sahu");
    assert.equal(c1Detail.userId, parentAId);
    assert.equal(c1Detail.stats.totalSessions, 2);
    assert.equal(c1Detail.stats.completedSessions, 1);
    assert.equal(c1Detail.stats.inProgressSessions, 1);
    assert.equal(c1Detail.stats.hasReport, true);

    const c1Sessions = await getUserChildQuestSessions(parentAId, childA1Id, {
      page: 1,
      limit: 10,
    });
    assert.equal(c1Sessions.sessions.length, 2);
    const sessionIds = c1Sessions.sessions.map((s) => s.id);
    assert.ok(sessionIds.includes(sessionA1CompletedId));
    assert.ok(sessionIds.includes(sessionA1InProgressId));
    // Must NOT contain Child 2 or Child B sessions
    assert.ok(!sessionIds.includes(sessionA2InProgressId));
    assert.ok(!sessionIds.includes(sessionB1Id));
  });

  it("Scenario 5 & 6: Same-name children remain completely separate", async () => {
    // Child A2 has the same name Aanya Sahu but a different ID
    const c2Detail = await getUserChildDetail(parentAId, childA2Id);
    assert.equal(c2Detail.id, childA2Id);
    assert.equal(c2Detail.childName, "Aanya Sahu");
    assert.equal(c2Detail.language, "Hindi");
    assert.equal(c2Detail.stats.totalSessions, 1);
    assert.equal(c2Detail.stats.completedSessions, 0);
    assert.equal(c2Detail.stats.inProgressSessions, 1);
    assert.equal(c2Detail.stats.hasReport, false);

    const c2Sessions = await getUserChildQuestSessions(parentAId, childA2Id, {
      page: 1,
      limit: 10,
    });
    assert.equal(c2Sessions.sessions.length, 1);
    assert.equal(c2Sessions.sessions[0].id, sessionA2InProgressId);
    // Never mixes Child A1 sessions into Child A2
    assert.notEqual(c2Sessions.sessions[0].id, sessionA1CompletedId);
  });

  it("Scenario 7: Session filters work accurately for child sessions", async () => {
    // Child A1 completed sessions
    const completedRes = await getUserChildQuestSessions(parentAId, childA1Id, {
      page: 1,
      limit: 10,
      status: "COMPLETED",
    });
    assert.equal(completedRes.sessions.length, 1);
    assert.equal(completedRes.sessions[0].id, sessionA1CompletedId);

    // Child A1 in-progress sessions
    const inProgressRes = await getUserChildQuestSessions(parentAId, childA1Id, {
      page: 1,
      limit: 10,
      status: "IN_PROGRESS",
    });
    assert.equal(inProgressRes.sessions.length, 1);
    assert.equal(inProgressRes.sessions[0].id, sessionA1InProgressId);

    // Child A1 abandoned sessions
    const abandonedRes = await getUserChildQuestSessions(parentAId, childA1Id, {
      page: 1,
      limit: 10,
      status: "ABANDONED",
    });
    assert.equal(abandonedRes.sessions.length, 0);
  });

  it("Scenario 8 & 9: Inspect Session loads genuine persisted progression and telemetry", async () => {
    const detail = await getUserChildQuestSessionDetail(
      parentAId,
      childA1Id,
      sessionA1CompletedId
    );
    assert.equal(detail.session.id, sessionA1CompletedId);
    assert.equal(detail.session.childProfileId, childA1Id);
    assert.equal(detail.session.completedLevelsCount, 18);
    assert.equal(detail.progression.isQuestComplete, true);
    assert.equal(detail.progression.games.length, 6);
    assert.ok(detail.warmUp);
    assert.ok(detail.report);
    assert.equal(detail.report.overallAccuracy, 94.5);

    // Check attempts telemetry
    const attempts = await getUserChildSessionAttempts(
      parentAId,
      childA1Id,
      sessionA1CompletedId,
      { page: 1, limit: 50 }
    );
    assert.equal(attempts.attempts.length, 18);

    // Check report retrieval
    const reportRes = await getUserChildSessionReport(
      parentAId,
      childA1Id,
      sessionA1CompletedId
    );
    assert.equal(reportRes.hasReport, true);
    assert.equal(reportRes.report?.childName, "Aanya Sahu");
  });

  it("Scenario 10: Parent ID is preserved in child detail for Back to Parent navigation", async () => {
    const detail = await getUserChildDetail(parentAId, childA1Id);
    assert.equal(detail.userId, parentAId);
  });

  it("Scenario 12: Invalid child ID returns NotFoundError", async () => {
    await assert.rejects(
      async () => getUserChildDetail(parentAId, "invalid_child_id_12345"),
      (err) => err instanceof NotFoundError
    );

    await assert.rejects(
      async () =>
        getUserChildQuestSessions(parentAId, "invalid_child_id_12345", {
          page: 1,
          limit: 10,
        }),
      (err) => err instanceof NotFoundError
    );
  });

  it("Scenario 13: IDOR Prevention: Manipulated child/parent/session IDs are rejected", async () => {
    // 1. Parent B attempting to access Parent A child
    await assert.rejects(
      async () => getUserChildDetail(parentBId, childA1Id),
      (err) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );

    // 2. Parent B attempting to access Parent A child sessions
    await assert.rejects(
      async () =>
        getUserChildQuestSessions(parentBId, childA1Id, { page: 1, limit: 10 }),
      (err) => err instanceof ForbiddenError
    );

    // 3. Child A2 attempting to inspect Child A1 session
    await assert.rejects(
      async () =>
        getUserChildQuestSessionDetail(
          parentAId,
          childA2Id,
          sessionA1CompletedId
        ),
      (err) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );

    // 4. Session belonging to Child B cannot be inspected under Parent A / Child A1
    await assert.rejects(
      async () =>
        getUserChildQuestSessionDetail(parentAId, childA1Id, sessionB1Id),
      (err) => err instanceof ForbiddenError
    );
  });
});
