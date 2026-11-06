import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
    DATABASE_URL_TEST: z.string().optional(),

    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url().default("http://localhost:8080"),
    COOKIE_DOMAIN: z.string().optional(),
    TRUST_PROXY: z.string().default("1"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    OPEN_AI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_REPORT_MODEL: z.string().default("gpt-4o-mini"),

    // ---- Report PDF storage (Cloudflare R2, private bucket) ----
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),

    // ---- Parent report email (Resend) ----
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    EMAIL_REPLY_TO: z.string().optional(),

    // Public base URL of THIS backend, used to build the link inside report emails
    REPORT_LINK_BASE_URL: z.url().optional(),
    // Public base URL of the frontend, used to redirect expired/invalid report links
    FRONTEND_BASE_URL: z.url().optional(),
  })
  .superRefine((data, ctx) => {
    // In production, Google OAuth is required because email/password is disabled
    if (data.NODE_ENV === "production") {
      if (!data.GOOGLE_CLIENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GOOGLE_CLIENT_ID is required in production environment",
          path: ["GOOGLE_CLIENT_ID"],
        });
      }
      if (!data.GOOGLE_CLIENT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GOOGLE_CLIENT_SECRET is required in production environment",
          path: ["GOOGLE_CLIENT_SECRET"],
        });
      }

      // Parent report delivery must be fully configured in production
      const requiredForReportDelivery = [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "RESEND_API_KEY",
        "EMAIL_FROM",
        "REPORT_LINK_BASE_URL",
        "FRONTEND_BASE_URL",
      ] as const;
      for (const key of requiredForReportDelivery) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required in production environment`,
            path: [key],
          });
        }
      }

      // Emailed links must never point at localhost in production
      for (const key of ["REPORT_LINK_BASE_URL", "FRONTEND_BASE_URL"] as const) {
        const value = data[key];
        if (value && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} must be a public URL (not localhost) in production environment`,
            path: [key],
          });
        }
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on env, so plain console is the only option here.
  console.error("❌ Invalid environment variables:\n");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const openaiApiKey = env.OPEN_AI_API_KEY || env.OPENAI_API_KEY;

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Settings for the "report PDF + parent email" feature.
 * `enabled` is false when anything is missing (dev) and ALWAYS false in tests,
 * so tests never upload files to R2 or send real emails.
 */
export const reportDelivery = {
  enabled:
    !isTest &&
    Boolean(
      env.R2_ACCOUNT_ID &&
        env.R2_ACCESS_KEY_ID &&
        env.R2_SECRET_ACCESS_KEY &&
        env.R2_BUCKET &&
        env.RESEND_API_KEY &&
        env.EMAIL_FROM
    ),
  linkBaseUrl: stripTrailingSlash(env.REPORT_LINK_BASE_URL || env.BETTER_AUTH_URL),
  // Dev fallback: the first allowed frontend origin (e.g. http://localhost:3000)
  frontendBaseUrl: stripTrailingSlash(
    env.FRONTEND_BASE_URL || env.CORS_ORIGINS[0] || "http://localhost:3000"
  ),
  linkTtlDays: 90,
};
