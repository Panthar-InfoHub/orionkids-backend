import { pino } from "pino";
import { env, isDev } from "../config/env.js";
import { getRequestContext } from "./context.js";

export const logger = pino({
  level: env.LOG_LEVEL ?? (isDev ? "debug" : "info"),

  mixin() {
    const ctx = getRequestContext();
    if (!ctx) return {};
    const extra: Record<string, any> = {};
    if (ctx.requestId) extra.requestId = ctx.requestId;
    if (ctx.userId) extra.userId = ctx.userId;
    if (ctx.role) extra.role = ctx.role;
    return extra;
  },

  // Never write secrets to logs.
  // Each "*" matches exactly one level, so list every depth we care about.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "password",
      "token",
      "apiKey",
      "openaiApiKey",
      "secret",
      "accessToken",
      "refreshToken",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.openaiApiKey",
      "*.secret",
      "*.accessToken",
      "*.refreshToken",
      "*.*.password",
      "*.*.token",
      "*.*.apiKey",
      "*.*.secret",
    ],
    censor: "[REDACTED]",
  },

  // Human-readable output in development; raw JSON in production
  // (log platforms parse the JSON).
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
