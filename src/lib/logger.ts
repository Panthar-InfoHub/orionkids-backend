import { pino } from "pino";
import { env, isDev } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL ?? (isDev ? "debug" : "info"),

  // Never write secrets to logs.
  // Each "*" matches exactly one level, so list every depth we care about.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "password",
      "token",
      "*.password",
      "*.token",
      "*.*.password",
      "*.*.token",
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
