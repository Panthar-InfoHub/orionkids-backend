import { createHash, randomBytes } from "node:crypto";
import { prisma, type Prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { reportDelivery } from "../config/env.js";
import { CANONICAL_GAMES } from "../config/games.js";
import { AppError, ConflictError, NotFoundError, TooManyRequestsError } from "../utils/errors.js";
import { generateRuleBasedReport, type AiStructuredReport } from "./aiReport.service.js";
import { generateReportPdf } from "./pdfReport.service.js";
import * as r2 from "../lib/r2.js";
import { sendReportReadyEmail, EmailSendError } from "../lib/email.js";

/**
 * Report delivery: stores the report PDF in Cloudflare R2 (private) and emails the parent
 * a secure, expiring link (Resend).
 *
 * Flow per delivery: claim → PDF (build + upload) → new link (old ones revoked) → email → SENT/FAILED.
 */

export type DeliveryReason = "CREATED" | "REGENERATED" | "RESEND";

/**
 * External dependencies, overridable in tests so tests never touch R2/Resend.
 */
export const deliveryDeps = {
  isEnabled: () => reportDelivery.enabled,
  uploadPdf: r2.uploadPdf,
  getPdf: r2.getPdf,
  deletePdfs: r2.deletePdfs,
  getTemporaryViewUrl: r2.getTemporaryViewUrl,
  sendEmail: sendReportReadyEmail,
  /** Waits between attempts: 1st→2nd ≈30s, 2nd→3rd ≈2min (3 attempts in total) */
  retryDelaysMs: [30_000, 120_000] as number[],
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const MAX_ATTEMPTS = 3;
const STALE_PENDING_MS = 10 * 60 * 1000; // PENDING older than this is treated as stuck
const RESEND_COOLDOWN_MS = 60 * 1000; // at most one manual resend per minute per report

// ---------------------------------------------------------------------------
// PDF rendering (moved from quest.service so storage and downloads share it)
// ---------------------------------------------------------------------------

type ReportWithSession = Prisma.QuestReportGetPayload<{
  include: { questSession: { select: { startedAt: true; completedAt: true } } };
}>;

/** Builds the PDF bytes for a saved report (uses the rule-based text if no AI text was saved). */
export async function renderReportPdf(report: ReportWithSession): Promise<Uint8Array> {
  let structuredAi = report.aiReport as AiStructuredReport | null;
  if (!structuredAi) {
    // Generate authoritative structured representation from existing saved report fields
    structuredAi = generateRuleBasedReport({
      child: {
        childName: report.childName,
        age: report.age,
        selectedClass: report.selectedClass,
        school: report.school,
      },
      quest: {
        sessionId: report.questSessionId,
        startedAt: report.questSession.startedAt.toISOString(),
        completedAt: report.questSession.completedAt
          ? report.questSession.completedAt.toISOString()
          : null,
        totalLevelsCompleted: 18,
        overallAccuracy: report.overallAccuracy,
        totalDurationMs: report.totalDurationMs,
      },
      warmUp: {
        copingStrategy: (report.growthObservations as any)?.copingStrategy || "retry",
        learningStyle: (report.growthObservations as any)?.learningStyle || "both",
        favoriteSubject: (report.growthObservations as any)?.favoriteSubject || "exploration",
        emotionalState: (report.growthObservations as any)?.emotionalState || "happy",
      },
      games: CANONICAL_GAMES.map((cg) => {
        const gs = (report.gameSummaries as any)?.[cg.key] || {};
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          levelsCompleted: gs.levelsCompleted ?? 3,
          averageAccuracy: gs.averageAccuracy ?? null,
          averageReactionTimeMs: gs.averageReactionTimeMs ?? null,
          levels: [1, 2, 3].map((lvl) => ({
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: null,
            correctTrials: null,
            accuracy: gs.averageAccuracy ?? null,
            durationMs: null,
            averageReactionTimeMs: gs.averageReactionTimeMs ?? null,
          })),
        };
      }),
    });
  }

  return await generateReportPdf({
    childName: report.childName,
    age: report.age,
    selectedClass: report.selectedClass,
    school: report.school,
    questCompletedAt: report.questSession.completedAt
      ? report.questSession.completedAt.toISOString()
      : null,
    reportGeneratedAt: report.generatedAt.toISOString(),
    overallAccuracy: report.overallAccuracy,
    totalDurationMs: report.totalDurationMs,
    aiReport: structuredAi,
  });
}

async function loadReport(reportId: string): Promise<ReportWithSession | null> {
  return prisma.questReport.findUnique({
    where: { id: reportId },
    include: { questSession: { select: { startedAt: true, completedAt: true } } },
  });
}

function pdfFileName(childName: string): string {
  return `OrionKids-${childName.trim().replace(/\s+/g, "_") || "Child"}-Report.pdf`;
}

/**
 * Makes sure the report PDF is stored in R2 and returns its key.
 * Rebuilds when `forceRebuild` is set (e.g. after a regenerate) or nothing is stored yet.
 */
async function ensureStoredPdf(
  report: ReportWithSession,
  forceRebuild: boolean
): Promise<{ key: string; bytes?: Uint8Array }> {
  if (report.pdfStorageKey && !forceRebuild) {
    return { key: report.pdfStorageKey };
  }

  const key = r2.buildReportPdfKey({
    userId: report.userId,
    childProfileId: report.childProfileId,
    questSessionId: report.questSessionId,
  });
  const bytes = await renderReportPdf(report);
  await deliveryDeps.uploadPdf(key, bytes);
  await prisma.questReport.update({
    where: { id: report.id },
    data: { pdfStorageKey: key, pdfGeneratedAt: new Date() },
  });
  logger.info({ reportId: report.id }, "report_delivery.pdf_stored");
  return { key, bytes };
}

/**
 * PDF bytes for dashboard/admin downloads.
 * Serves the stored R2 copy; stores it first if missing (never sends an email).
 * Falls back to on-the-fly rendering when R2 is not configured or temporarily unavailable.
 */
export async function getReportPdfBytes(report: ReportWithSession): Promise<Uint8Array> {
  if (!deliveryDeps.isEnabled()) {
    return renderReportPdf(report);
  }

  try {
    if (report.pdfStorageKey) {
      const stored = await deliveryDeps.getPdf(report.pdfStorageKey);
      if (stored) return stored;
    }
    const { bytes } = await ensureStoredPdf(report, true);
    return bytes ?? (await renderReportPdf(report));
  } catch (err) {
    logger.error(
      { reportId: report.id, err: err instanceof Error ? err.message : String(err) },
      "report_delivery.pdf_storage_unavailable_rendering_directly"
    );
    return renderReportPdf(report);
  }
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildShareLinkUrl(token: string): string {
  return `${reportDelivery.linkBaseUrl}/api/reports/link/${token}`;
}

/** Revokes every active link of the report and creates a fresh one. */
async function createShareLink(reportId: string, recipientEmail: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + reportDelivery.linkTtlDays * 24 * 60 * 60 * 1000);

  const link = await prisma.$transaction(async (tx) => {
    await tx.reportShareLink.updateMany({
      where: { questReportId: reportId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.reportShareLink.create({
      data: {
        questReportId: reportId,
        tokenHash: hashLinkToken(token),
        recipientEmail,
        expiresAt,
      },
    });
  });

  return { id: link.id, url: buildShareLinkUrl(token), expiresAt };
}

export type ShareLinkResolution =
  | { ok: true; url: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

/** Validates an emailed link code and returns a 5-minute R2 URL that opens the PDF. */
export async function resolveShareLink(token: string): Promise<ShareLinkResolution> {
  if (!token || token.length < 20 || token.length > 100) {
    return { ok: false, reason: "invalid" };
  }

  const link = await prisma.reportShareLink.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: { id: true, questReportId: true, expiresAt: true, revokedAt: true },
  });

  if (!link) return { ok: false, reason: "invalid" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };
  if (link.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const report = await loadReport(link.questReportId);
  if (!report) return { ok: false, reason: "invalid" };

  if (!deliveryDeps.isEnabled()) {
    throw new AppError("Report storage is not configured", 503, "REPORT_STORAGE_UNAVAILABLE");
  }

  // Make sure the PDF really exists in storage (rebuild it if it went missing)
  let key = report.pdfStorageKey;
  if (!key || !(await deliveryDeps.getPdf(key))) {
    key = (await ensureStoredPdf(report, true)).key;
  }

  await prisma.reportShareLink.update({
    where: { id: link.id },
    data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
  });

  const url = await deliveryDeps.getTemporaryViewUrl(key, pdfFileName(report.childName));
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Delivery (PDF + link + email) with retries
// ---------------------------------------------------------------------------

/**
 * Atomically marks the report as PENDING so two deliveries never run at once.
 * A PENDING status that has not moved for 10 minutes (e.g. server restart) can be reclaimed.
 */
async function claimDelivery(reportId: string): Promise<boolean> {
  const result = await prisma.questReport.updateMany({
    where: {
      id: reportId,
      OR: [
        { emailStatus: { not: "PENDING" } },
        { updatedAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
      ],
    },
    data: { emailStatus: "PENDING", emailError: null },
  });
  return result.count === 1;
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}

/** Runs a claimed delivery to completion. Never throws. */
async function runDelivery(reportId: string, reason: DeliveryReason): Promise<void> {
  const log = logger.child({ reportId, reason });
  let pdfReady = false;
  let shareLink: { id: string; url: string; expiresAt: Date } | null = null;
  let recipient: string | null = null;
  let lastError = "Unknown error";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const report = await prisma.questReport.update({
          where: { id: reportId },
          data: { emailAttempts: { increment: 1 }, emailStatus: "PENDING" },
          include: {
            questSession: { select: { startedAt: true, completedAt: true } },
            childProfile: { select: { parentEmail: true } },
          },
        });

        recipient = report.childProfile?.parentEmail?.trim() || null;
        if (!recipient) {
          throw new EmailSendError("No parent email is saved for this child", true);
        }

        // 1. PDF in R2 (rebuild after a regenerate; otherwise reuse the stored copy)
        if (!pdfReady) {
          await ensureStoredPdf(report, reason === "REGENERATED" || !report.pdfStorageKey);
          pdfReady = true;
        }

        // 2. One fresh link per delivery (old links are revoked); reused across retries
        if (!shareLink) {
          shareLink = await createShareLink(reportId, recipient);
        }

        // 3. Email (idempotency key = link id, so a retry never sends twice)
        await deliveryDeps.sendEmail({
          to: recipient,
          childName: report.childName,
          link: shareLink.url,
          expiresAt: shareLink.expiresAt,
          idempotencyKey: `report-email-${shareLink.id}`,
        });

        await prisma.questReport.update({
          where: { id: reportId },
          data: {
            emailStatus: "SENT",
            emailRecipient: recipient,
            emailSentAt: new Date(),
            emailError: null,
          },
        });
        log.info({ attempt }, "report_delivery.email_sent");
        return;
      } catch (err) {
        lastError = errorMessage(err);
        const permanent = err instanceof EmailSendError && err.permanent;
        log.warn({ attempt, permanent, err: lastError }, "report_delivery.attempt_failed");

        if (permanent || attempt >= MAX_ATTEMPTS) break;

        await prisma.questReport
          .update({ where: { id: reportId }, data: { emailError: lastError } })
          .catch(() => {});
        await deliveryDeps.sleep(deliveryDeps.retryDelaysMs[attempt - 1] ?? 60_000);
      }
    }

    // All attempts failed: the unsent link is useless, so revoke it
    if (shareLink) {
      await prisma.reportShareLink
        .update({ where: { id: shareLink.id }, data: { revokedAt: new Date() } })
        .catch(() => {});
    }
    await prisma.questReport.update({
      where: { id: reportId },
      data: {
        emailStatus: "FAILED",
        emailError: lastError,
        ...(recipient ? { emailRecipient: recipient } : {}),
      },
    });
    log.error({ err: lastError }, "report_delivery.failed");
  } catch (err) {
    // Unexpected failure (e.g. report deleted mid-delivery): log and stop
    log.error({ err: errorMessage(err) }, "report_delivery.crashed");
    await prisma.questReport
      .updateMany({
        where: { id: reportId, emailStatus: "PENDING" },
        data: { emailStatus: "FAILED", emailError: errorMessage(err) },
      })
      .catch(() => {});
  }
}

/**
 * Starts delivery in the background (never blocks the request).
 * Used when a report is created or regenerated.
 */
export function scheduleReportDelivery(reportId: string, reason: DeliveryReason): void {
  if (!deliveryDeps.isEnabled()) {
    logger.info({ reportId, reason }, "report_delivery.skipped_not_configured");
    return;
  }

  setImmediate(() => {
    void (async () => {
      try {
        if (!(await claimDelivery(reportId))) {
          logger.info({ reportId, reason }, "report_delivery.skipped_already_in_progress");
          return;
        }
        await runDelivery(reportId, reason);
      } catch (err) {
        logger.error({ reportId, reason, err: errorMessage(err) }, "report_delivery.schedule_failed");
      }
    })();
  });
}

export interface ReportEmailState {
  reportId: string;
  emailStatus: "NOT_SENT" | "PENDING" | "SENT" | "FAILED";
  emailRecipient: string | null;
  emailSentAt: Date | null;
  emailError: string | null;
}

/**
 * Manual "Resend email" (admin or school). Sends to the CURRENT parent email,
 * revokes the previous link and runs in the background.
 */
export async function resendReportEmail(reportId: string): Promise<ReportEmailState> {
  if (!deliveryDeps.isEnabled()) {
    throw new AppError(
      "Report email delivery is not configured on the server",
      503,
      "EMAIL_DELIVERY_UNAVAILABLE"
    );
  }

  const report = await prisma.questReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      emailSentAt: true,
      childProfile: { select: { parentEmail: true } },
    },
  });

  if (!report) {
    throw new NotFoundError("Quest assessment report not found");
  }

  if (!report.childProfile?.parentEmail?.trim()) {
    throw new ConflictError(
      "No parent email is saved for this child. Please add one first.",
      "PARENT_EMAIL_MISSING"
    );
  }

  if (report.emailSentAt && Date.now() - report.emailSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new TooManyRequestsError("The email was just sent. Please wait a minute before resending.");
  }

  if (!(await claimDelivery(reportId))) {
    throw new ConflictError("The report email is already being sent", "EMAIL_SEND_IN_PROGRESS");
  }

  setImmediate(() => {
    void runDelivery(reportId, "RESEND");
  });

  return {
    reportId,
    emailStatus: "PENDING",
    emailRecipient: report.childProfile.parentEmail,
    emailSentAt: report.emailSentAt,
    emailError: null,
  };
}

/**
 * Status as shown in the UI: a PENDING that has been stuck for 10+ minutes is reported as FAILED,
 * so it can be resent.
 */
export function effectiveEmailStatus(report: {
  emailStatus: "NOT_SENT" | "PENDING" | "SENT" | "FAILED";
  updatedAt: Date;
}): "NOT_SENT" | "PENDING" | "SENT" | "FAILED" {
  if (report.emailStatus === "PENDING" && Date.now() - report.updatedAt.getTime() > STALE_PENDING_MS) {
    return "FAILED";
  }
  return report.emailStatus;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Collects the stored PDF keys of the reports matching `where` (call BEFORE deleting rows). */
export async function collectReportPdfKeys(where: Prisma.QuestReportWhereInput): Promise<string[]> {
  const rows = await prisma.questReport.findMany({
    where: { ...where, pdfStorageKey: { not: null } },
    select: { pdfStorageKey: true },
  });
  return rows.map((r) => r.pdfStorageKey).filter((k): k is string => Boolean(k));
}

/** Deletes stored PDFs. Failures are logged, never thrown (the DB deletion already happened). */
export async function deleteStoredPdfs(keys: string[]): Promise<void> {
  if (keys.length === 0 || !deliveryDeps.isEnabled()) return;
  try {
    await deliveryDeps.deletePdfs(keys);
    logger.info({ count: keys.length }, "report_delivery.pdfs_deleted");
  } catch (err) {
    logger.error(
      { count: keys.length, err: errorMessage(err) },
      "report_delivery.pdf_delete_failed"
    );
  }
}
