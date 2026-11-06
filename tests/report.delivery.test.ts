import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  deliveryDeps,
  scheduleReportDelivery,
  resendReportEmail,
  resolveShareLink,
  hashLinkToken,
} from "../src/services/reportDelivery.service.js";
import { generateOrGetReport } from "../src/services/quest.service.js";
import {
  resendChildReportEmail,
  deleteChildProfile,
} from "../src/services/child.service.js";
import { EmailSendError } from "../src/lib/email.js";

/**
 * Report PDF storage (R2) + parent email (Resend) delivery.
 * R2 and Resend are FAKED here: nothing is uploaded and no real email is sent.
 * Reports are created directly in the DB, so OpenAI is never called either.
 */

type SentEmail = { to: string; childName: string; link: string; idempotencyKey: string };

const fake = {
  storage: new Map<string, Uint8Array>(),
  sent: [] as SentEmail[],
  deleted: [] as string[],
  // Each call shifts one entry: undefined = success, otherwise the error to throw
  sendPlan: [] as Array<Error | undefined>,
};

const originalDeps = { ...deliveryDeps };

function installFakes() {
  deliveryDeps.isEnabled = () => true;
  deliveryDeps.uploadPdf = async (key, bytes) => {
    fake.storage.set(key, bytes);
  };
  deliveryDeps.getPdf = async (key) => fake.storage.get(key) ?? null;
  deliveryDeps.deletePdfs = async (keys) => {
    fake.deleted.push(...keys);
    keys.forEach((k) => fake.storage.delete(k));
  };
  deliveryDeps.getTemporaryViewUrl = async (key) => `https://r2.test/${key}?signed=1`;
  deliveryDeps.sendEmail = async (input) => {
    const planned = fake.sendPlan.shift();
    if (planned) throw planned;
    fake.sent.push({
      to: input.to,
      childName: input.childName,
      link: input.link,
      idempotencyKey: input.idempotencyKey,
    });
    return { id: `email_${fake.sent.length}` };
  };
  deliveryDeps.retryDelaysMs = [1, 1];
  deliveryDeps.sleep = async () => {};
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for background delivery");
}

const waitForStatus = (reportId: string, statuses: string[]) =>
  waitFor(async () => {
    const r = await prisma.questReport.findUnique({ where: { id: reportId } });
    return Boolean(r && statuses.includes(r.emailStatus));
  });

function tokenFromLink(link: string): string {
  return link.split("/api/reports/link/")[1] ?? "";
}

describe("Report delivery: PDF storage + parent email", () => {
  const stamp = Date.now();
  const schoolId = `test_school_${stamp}`;
  const otherSchoolId = `test_other_${stamp}`;
  let childId = "";
  let sessionId = "";
  let reportId = "";

  before(async () => {
    installFakes();

    await prisma.user.createMany({
      data: [
        { id: schoolId, name: "Test School", email: `${schoolId}@example.com`, status: "ACTIVE", role: "USER" },
        { id: otherSchoolId, name: "Other School", email: `${otherSchoolId}@example.com`, status: "ACTIVE", role: "USER" },
      ],
    });

    const child = await prisma.childProfile.create({
      data: {
        userId: schoolId,
        childName: "Alex Star",
        age: 8,
        language: "English",
        selectedClass: "Class 2",
        parentEmail: "parent.alex@example.com",
        parentMobile: "9876543210",
        isGuardian: true,
      },
    });
    childId = child.id;

    const session = await prisma.questSession.create({
      data: {
        userId: schoolId,
        childProfileId: childId,
        status: "COMPLETED",
        currentStage: "COMPLETED",
        currentGame: 6,
        currentLevel: 3,
        completedAt: new Date(),
      },
    });
    sessionId = session.id;

    const report = await prisma.questReport.create({
      data: {
        questSessionId: sessionId,
        userId: schoolId,
        childProfileId: childId,
        childName: "Alex Star",
        age: 8,
        selectedClass: "Class 2",
        overallAccuracy: 88,
        totalDurationMs: 600000,
        gameSummaries: {},
        cognitiveFacets: {},
        growthObservations: {},
        aiReport: undefined,
      },
    });
    reportId = report.id;
  });

  beforeEach(() => {
    fake.sent = [];
    fake.deleted = [];
    fake.sendPlan = [];
  });

  after(async () => {
    Object.assign(deliveryDeps, originalDeps);
    await prisma.user
      .deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } })
      .catch(() => {});
  });

  it("delivers a new report: stores the PDF, creates one link and sends one email", async () => {
    scheduleReportDelivery(reportId, "CREATED");
    await waitForStatus(reportId, ["SENT", "FAILED"]);

    const report = await prisma.questReport.findUniqueOrThrow({ where: { id: reportId } });
    assert.equal(report.emailStatus, "SENT");
    assert.equal(report.emailRecipient, "parent.alex@example.com");
    assert.ok(report.emailSentAt);
    assert.ok(report.pdfStorageKey);
    assert.ok(fake.storage.has(report.pdfStorageKey!));
    assert.ok(!report.pdfStorageKey!.includes("Alex"), "no names in storage paths");

    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0]!.to, "parent.alex@example.com");

    const activeLinks = await prisma.reportShareLink.count({
      where: { questReportId: reportId, revokedAt: null },
    });
    assert.equal(activeLinks, 1);

    // Only the hash is stored, never the token
    const token = tokenFromLink(fake.sent[0]!.link);
    const stored = await prisma.reportShareLink.findFirstOrThrow({ where: { questReportId: reportId } });
    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.tokenHash, hashLinkToken(token));
  });

  it("does not send a second email when an existing report is requested again", async () => {
    const report = await generateOrGetReport(schoolId, sessionId);
    assert.equal(report.id, reportId);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fake.sent.length, 0);
  });

  it("opens a valid link and counts the access", async () => {
    const link = await prisma.reportShareLink.findFirstOrThrow({
      where: { questReportId: reportId, revokedAt: null },
    });
    // We only know the hash; issue a fresh known link by resending
    await prisma.questReport.update({ where: { id: reportId }, data: { emailSentAt: new Date(0) } });
    await resendReportEmail(reportId);
    await waitForStatus(reportId, ["SENT", "FAILED"]);

    const token = tokenFromLink(fake.sent.at(-1)!.link);
    const result = await resolveShareLink(token);
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.url, /^https:\/\/r2\.test\/reports\//);

    const fresh = await prisma.reportShareLink.findUniqueOrThrow({
      where: { tokenHash: hashLinkToken(token) },
    });
    assert.equal(fresh.accessCount, 1);

    // The previous link was revoked by the resend
    const old = await prisma.reportShareLink.findUniqueOrThrow({ where: { id: link.id } });
    assert.ok(old.revokedAt);
  });

  it("rejects invalid, revoked and expired links", async () => {
    assert.deepEqual(await resolveShareLink("not-a-real-token-but-long-enough"), {
      ok: false,
      reason: "invalid",
    });

    const revoked = await prisma.reportShareLink.findFirstOrThrow({
      where: { questReportId: reportId, revokedAt: { not: null } },
    });
    // A revoked link cannot be opened (look it up via a known token: create one directly)
    const revokedToken = "revoked-token-for-tests-0123456789";
    await prisma.reportShareLink.update({
      where: { id: revoked.id },
      data: { tokenHash: hashLinkToken(revokedToken) },
    });
    assert.deepEqual(await resolveShareLink(revokedToken), { ok: false, reason: "revoked" });

    const expiredToken = "expired-token-for-tests-0123456789";
    await prisma.reportShareLink.create({
      data: {
        questReportId: reportId,
        tokenHash: hashLinkToken(expiredToken),
        recipientEmail: "parent.alex@example.com",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    assert.deepEqual(await resolveShareLink(expiredToken), { ok: false, reason: "expired" });
  });

  it("blocks a second manual resend within one minute", async () => {
    await assert.rejects(() => resendReportEmail(reportId), (err: any) => {
      assert.equal(err.statusCode, 429);
      return true;
    });
  });

  it("retries temporary failures and then succeeds", async () => {
    await prisma.questReport.update({
      where: { id: reportId },
      data: { emailSentAt: new Date(0), emailAttempts: 0 },
    });
    fake.sendPlan = [
      new EmailSendError("rate limited", false),
      new EmailSendError("temporary outage", false),
    ];

    await resendReportEmail(reportId);
    await waitForStatus(reportId, ["SENT", "FAILED"]);

    const report = await prisma.questReport.findUniqueOrThrow({ where: { id: reportId } });
    assert.equal(report.emailStatus, "SENT");
    assert.equal(report.emailAttempts, 3);
    assert.equal(fake.sent.length, 1);
  });

  it("fails immediately on a permanent error and revokes the unsent link", async () => {
    await prisma.questReport.update({
      where: { id: reportId },
      data: { emailSentAt: new Date(0), emailAttempts: 0 },
    });
    fake.sendPlan = [new EmailSendError("invalid address", true)];

    await resendReportEmail(reportId);
    await waitForStatus(reportId, ["SENT", "FAILED"]);

    const report = await prisma.questReport.findUniqueOrThrow({ where: { id: reportId } });
    assert.equal(report.emailStatus, "FAILED");
    assert.equal(report.emailAttempts, 1);
    assert.match(report.emailError ?? "", /invalid address/);

    const active = await prisma.reportShareLink.count({
      where: { questReportId: reportId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    assert.equal(active, 0);
  });

  it("does not let another school resend this child's report", async () => {
    await assert.rejects(() => resendChildReportEmail(otherSchoolId, childId, sessionId), (err: any) => {
      assert.equal(err.statusCode, 403);
      return true;
    });
  });

  it("deleting the child removes stored PDFs and revokes all links", async () => {
    const before = await prisma.questReport.findUniqueOrThrow({ where: { id: reportId } });
    assert.ok(before.pdfStorageKey);

    await deleteChildProfile(schoolId, childId);

    assert.ok(fake.deleted.includes(before.pdfStorageKey!));
    const active = await prisma.reportShareLink.count({
      where: { questReportId: reportId, revokedAt: null },
    });
    assert.equal(active, 0);
  });
});
