import express from "express";
import { randomUUID } from "node:crypto";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { env, isTest } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { requestContextStorage } from "./lib/context.js";
import { prisma } from "./lib/prisma.js";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import apiRoutes from "./routes/index.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { sendSuccess } from "./utils/apiResponse.js";

const app = express();

// Needed behind a reverse proxy / load balancer (Render, Railway, Cloud Run…)
// so req.ip and secure cookies work.
app.set(
  "trust proxy",
  env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : 1
);

// ---- Request Correlation & Context Middleware ----
app.use((req, res, next) => {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.trim()
      ? incomingId.trim()
      : randomUUID();

  (req as any).id = requestId;
  res.setHeader("x-request-id", requestId);

  requestContextStorage.run(
    {
      requestId,
      method: req.method,
      path: req.path,
    },
    () => next()
  );
});

// ---- Security ----
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  })
);

// Mount Better Auth handler BEFORE body parsers (Express 5 splat syntax)
app.all("/api/auth/*splat", toNodeHandler(auth));

// ---- Body parsing ----
app.use(express.json({ limit: "1mb" }));

// ---- Request logging (one line per request) ----
app.use(
  pinoHttp({
    logger,
    genReqId: (req) =>
      (req as any).id ||
      (req.headers["x-request-id"] as string) ||
      randomUUID(),
    autoLogging: { ignore: (req) => req.url?.startsWith("/health") || false },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);

// ---- Health checks ----
// Liveness check: lightweight process ping (no DB hit)
app.get("/health/live", (_req, res) => {
  sendSuccess(res, 200, { status: "live", uptime: process.uptime() });
});

// Readiness check: confirms database connectivity
app.get(
  ["/health/ready", "/health"],
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, 200, {
      status: "ok",
      database: "up",
      uptime: process.uptime(),
    });
  })
);

// ---- Rate Limiting (Issue #18) ----
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 50_000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests, please try again later",
    },
  },
  skip: () => isTest,
});

// ---- API routes ----
app.use("/api", apiLimiter, apiRoutes);
app.use("/api/v1", apiLimiter, apiRoutes);

// ---- 404, then the error handler: these two must stay LAST, in this order ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
