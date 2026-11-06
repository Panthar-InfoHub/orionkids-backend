import { Resend } from "resend";
import { env } from "../config/env.js";

/**
 * Parent "report ready" email, sent through Resend.
 */

let client: Resend | null = null;

function getClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("Resend is not configured (RESEND_API_KEY)");
  }
  if (!client) {
    client = new Resend(env.RESEND_API_KEY);
  }
  return client;
}

/**
 * Thrown when sending fails. `permanent` errors (bad address, bad key…) are not retried;
 * temporary ones (rate limit, outage, network) are.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

// Resend error codes that will never succeed on retry
const PERMANENT_ERROR_CODES = new Set([
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "monthly_quota_exceeded",
  "security_error",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export interface ReportReadyEmailInput {
  to: string;
  childName: string;
  link: string;
  expiresAt: Date;
  /** Prevents duplicate delivery if the same send is retried */
  idempotencyKey: string;
}

export function buildReportReadyEmail(input: Omit<ReportReadyEmailInput, "to" | "idempotencyKey">) {
  const name = input.childName.trim() || "Your child";
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(input.link);
  const expiry = formatDate(input.expiresAt);

  const subject = `${name}'s OrionKids Learning Report is ready`;

  const text = [
    "Dear Parent/Guardian,",
    "",
    `${name} has completed the OrionKids learning quest, a series of six playful thinking games. Their personalised learning report is now ready.`,
    "",
    `View ${name}'s report: ${input.link}`,
    "",
    `For your child's privacy, this secure link will remain active until ${expiry}. If it has expired, please contact your school for a new link.`,
    "",
    "This report is an educational summary of gameplay and is not a medical or clinical assessment.",
    "",
    "Warm regards,",
    "The OrionKids Team",
    "",
    `You received this email because your address was provided when ${name} was registered on OrionKids. Questions? Simply reply to this email.`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#F0F6FA;font-family:Arial,Helvetica,sans-serif;color:#1E293B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0F6FA;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;overflow:hidden;">
            <tr>
              <td style="background-color:#0A1D3D;padding:22px 28px;">
                <span style="font-size:20px;font-weight:bold;color:#FFFFFF;">OrionKids</span>
                <span style="font-size:20px;font-weight:bold;color:#FFD028;"> &#9733;</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Dear Parent/Guardian,</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
                  <strong>${safeName}</strong> has completed the OrionKids learning quest, a series of six playful thinking games.
                  Their personalised learning report is now ready.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="background-color:#FFD028;border-radius:12px;border:2px solid #0A1D3D;">
                      <a href="${safeLink}" target="_blank" rel="noopener noreferrer"
                         style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:bold;color:#0A1D3D;text-decoration:none;">
                        View ${safeName}'s Report
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">
                  For your child's privacy, this secure link will remain active until <strong>${escapeHtml(expiry)}</strong>.
                  If it has expired, please contact your school for a new link.
                </p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#64748B;">
                  This report is an educational summary of gameplay and is not a medical or clinical assessment.
                </p>
                <p style="margin:0;font-size:15px;line-height:1.6;">Warm regards,<br />The OrionKids Team</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background-color:#F8FAFC;border-top:1px solid #E2E8F0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748B;">
                  You received this email because your address was provided when ${safeName} was registered on OrionKids.
                  Questions? Simply reply to this email.
                </p>
                <p style="margin:8px 0 0;font-size:11px;line-height:1.6;color:#94A3B8;">
                  If the button does not work, copy this link into your browser:<br />
                  <span style="word-break:break-all;">${safeLink}</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/** Sends the "report ready" email. Throws EmailSendError on failure. */
export async function sendReportReadyEmail(input: ReportReadyEmailInput): Promise<{ id: string }> {
  if (!env.EMAIL_FROM) {
    throw new EmailSendError("EMAIL_FROM is not configured", true);
  }

  const { subject, html, text } = buildReportReadyEmail(input);

  let result;
  try {
    result = await getClient().emails.send(
      {
        from: env.EMAIL_FROM,
        to: [input.to],
        subject,
        html,
        text,
        ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
        tags: [{ name: "category", value: "report_ready" }],
      },
      { idempotencyKey: input.idempotencyKey }
    );
  } catch (err) {
    // Network-level failure: worth retrying
    const message = err instanceof Error ? err.message : String(err);
    throw new EmailSendError(`Email request failed: ${message}`, false);
  }

  if (result.error) {
    const permanent = PERMANENT_ERROR_CODES.has(result.error.name);
    throw new EmailSendError(
      `Resend error (${result.error.name}): ${result.error.message}`,
      permanent
    );
  }

  return { id: result.data?.id ?? "" };
}
