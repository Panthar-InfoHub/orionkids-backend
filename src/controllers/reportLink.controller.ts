import type { Request, Response } from "express";
import { reportDelivery } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { resolveShareLink } from "../services/reportDelivery.service.js";

/**
 * GET /api/reports/link/:code  (public, no login)
 *
 * Opened from the parent's email. A valid code redirects to a 5-minute private R2 URL
 * that opens the PDF in the browser; anything else redirects to the frontend
 * "report link expired" page.
 */
export async function openReportLinkController(req: Request, res: Response) {
  // The code must never be cached or leaked through the Referer header
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");

  const code = typeof req.params.code === "string" ? req.params.code : "";
  const expiredPage = (reason: string) =>
    `${reportDelivery.frontendBaseUrl}/report-link-expired?reason=${reason}`;

  try {
    const result = await resolveShareLink(code);
    if (result.ok) {
      res.redirect(302, result.url);
      return;
    }
    res.redirect(302, expiredPage(result.reason));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "report_link.open_failed"
    );
    res.redirect(302, expiredPage("unavailable"));
  }
}
