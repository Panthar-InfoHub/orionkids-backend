import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  generateOrGetReport,
  getReportPdfBuffer,
} from "../src/services/quest.service.js";
import {
  adminRegenerateReport,
  adminGetReportPdf,
  listAllQuestReports,
} from "../src/services/admin.service.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/utils/errors.js";

describe("AI-Powered Quest Report Generation & Security Verification Suite", () => {
  const parent1Id = `test_parent1_${Date.now()}`;
  const parent2Id = `test_parent2_${Date.now()}`;
  const adminId = `test_admin_${Date.now()}`;

  let child1Id = "";
  let child2Id = "";
  let completedSessionId = "";
  let inProgressSessionId = "";

  before(async () => {
    // 1. Create fixtures for Parent 1, Parent 2, and Admin
    await prisma.user.createMany({
      data: [
        {
          id: parent1Id,
          name: "Parent One",
          email: `${parent1Id}@example.com`,
          status: "ACTIVE",
          role: "USER",
        },
        {
          id: parent2Id,
          name: "Parent Two",
          email: `${parent2Id}@example.com`,
          status: "ACTIVE",
          role: "USER",
        },
        {
          id: adminId,
          name: "System Admin",
          email: `${adminId}@example.com`,
          status: "ACTIVE",
          role: "ADMIN",
        },
      ],
    });

    const child1 = await prisma.childProfile.create({
      data: {
        userId: parent1Id,
        childName: "Alex Star",
        age: 8,
        language: "English",
        selectedClass: "Class 2",
        school: "Orion Academy",
        parentEmail: `${parent1Id}@example.com`,
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
    child1Id = child1.id;

    const child2 = await prisma.childProfile.create({
      data: {
        userId: parent2Id,
        childName: "Maya Moon",
        age: 7,
        language: "English",
        selectedClass: "Class 1",
        school: "Galaxy Elementary",
        parentEmail: `${parent2Id}@example.com`,
        parentMobile: "9876543211",
        isGuardian: true,
      },
    });
    child2Id = child2.id;

    // 2. Create In-Progress Quest Session for Child 1
    const inProgressSession = await prisma.questSession.create({
      data: {
        userId: parent1Id,
        childProfileId: child1Id,
        status: "IN_PROGRESS",
        currentStage: "GAME_1_LEVEL_2",
        currentGame: 1,
        currentLevel: 2,
      },
    });
    inProgressSessionId = inProgressSession.id;

    // 3. Create Completed Quest Session for Child 1 with all 18 level attempts
    const completedSession = await prisma.questSession.create({
      data: {
        userId: parent1Id,
        childProfileId: child1Id,
        status: "COMPLETED",
        currentStage: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });
    completedSessionId = completedSession.id;

    // Add warm-up submission
    await prisma.warmUpSubmission.create({
      data: {
        questSessionId: completedSessionId,
        userId: parent1Id,
        answers: {
          "1": "excited",
          "2": "retry",
          "3": "both",
          "4": "numbers",
          "5": "morning",
          "6": "happy",
        },
      },
    });

    // Populate genuine completed attempts for all 6 games and 18 levels
    const gameKeys = [
      "stroop",
      "card-flip",
      "pattern",
      "odd-one-out",
      "rule-discovery",
      "story-sequencing",
    ];

    const attemptsData: any[] = [];
    for (let g = 1; g <= 6; g++) {
      const key = gameKeys[g - 1]!;
      for (let lvl = 1; lvl <= 3; lvl++) {
        attemptsData.push({
          questSessionId: completedSessionId,
          userId: parent1Id,
          gameId: g,
          gameKey: key,
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 9,
          accuracy: 90,
          durationMs: 15000,
          averageReactionTimeMs: 1400,
          completedAt: new Date(),
        });
      }
    }

    await prisma.levelAttempt.createMany({
      data: attemptsData,
    });
  });

  after(async () => {
    try {
      await prisma.user.deleteMany({
        where: { id: { in: [parent1Id, parent2Id, adminId] } },
      });
    } catch {
      // Ignore cleanup error if cascade deleted
    }
  });

  it("prevents report generation for an IN_PROGRESS quest session", async () => {
    await assert.rejects(
      async () => generateOrGetReport(parent1Id, inProgressSessionId),
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /in progress|completed/i);
        return true;
      }
    );
  });

  it("generates an authoritative, structured report for a COMPLETED quest session", async () => {
    const report = await generateOrGetReport(parent1Id, completedSessionId);

    assert.ok(report);
    assert.ok(report.id);
    assert.equal(report.questSessionId, completedSessionId);
    assert.equal(report.userId, parent1Id);
    assert.equal(report.childProfileId, child1Id);
    assert.equal(report.childName, "Alex Star");
    assert.equal(report.status, "GENERATED");
    assert.equal(report.overallAccuracy, 90);
    assert.ok(report.totalDurationMs > 0);

    // Verify structured AI report content
    assert.ok(report.aiReport, "aiReport must be present");
    const ai = report.aiReport as any;
    assert.ok(ai.reportTitle);
    assert.ok(ai.overallPerformanceSummary);
    assert.equal(ai.gameWiseAnalysis.length, 6, "Must contain all 6 games");
    assert.equal(ai.levelWisePerformance.length, 18, "Must contain all 18 levels");
    assert.ok(Array.isArray(ai.observedStrengths));
    assert.ok(Array.isArray(ai.parentRecommendations));
    assert.ok(ai.dataLimitations);
  });

  it("is idempotent: duplicate completion calls return the saved report without creating duplicates", async () => {
    const reportFirst = await generateOrGetReport(parent1Id, completedSessionId);
    const reportSecond = await generateOrGetReport(parent1Id, completedSessionId);

    assert.equal(reportFirst.id, reportSecond.id);

    // Verify exactly 1 report exists for this session
    const count = await prisma.questReport.count({
      where: { questSessionId: completedSessionId },
    });
    assert.equal(count, 1);
  });

  it("enforces strict ownership: Parent 2 cannot access Parent 1's report", async () => {
    await assert.rejects(
      async () => generateOrGetReport(parent2Id, completedSessionId),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /do not own/i);
        return true;
      }
    );

    await assert.rejects(
      async () => getReportPdfBuffer(parent2Id, completedSessionId, false),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      }
    );
  });

  it("allows the authorized parent to download the report as a valid binary PDF", async () => {
    const pdfBytes = await getReportPdfBuffer(parent1Id, completedSessionId, false);

    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 500, "PDF size must be substantial");

    // Verify PDF magic header bytes: %PDF- (0x25 0x50 0x44 0x46)
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");
    assert.match(header, /^%PDF-/);
  });

  it("allows administrators to view, list, and download reports for authorized children", async () => {
    // 1. Admin can access report directly
    const report = await generateOrGetReport(adminId, completedSessionId, false, true);
    assert.ok(report);
    assert.equal(report.childName, "Alex Star");

    // 2. Admin can download PDF
    const pdfBytes = await adminGetReportPdf(completedSessionId);
    assert.ok(pdfBytes.length > 500);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");
    assert.match(header, /^%PDF-/);

    // 3. Admin can list reports with filtering
    const listResult = await listAllQuestReports({
      page: 1,
      limit: 10,
      search: "Alex",
    });

    assert.ok(listResult.reports.length >= 1);
    const found = listResult.reports.find((r) => r.questSessionId === completedSessionId);
    assert.ok(found);
    assert.equal(found?.childName, "Alex Star");
    assert.equal(found?.status, "GENERATED");
  });

  it("allows administrators to explicitly regenerate a report", async () => {
    const regenerated = await adminRegenerateReport(completedSessionId);
    assert.ok(regenerated);
    assert.equal(regenerated.questSessionId, completedSessionId);

    // Ensure still exactly 1 report in database
    const count = await prisma.questReport.count({
      where: { questSessionId: completedSessionId },
    });
    assert.equal(count, 1);
  });
});

