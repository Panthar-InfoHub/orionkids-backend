import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import apiRoutes from "./routes/index.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { sendSuccess } from "./utils/apiResponse.js";

const app = express();

// Needed behind a reverse proxy / load balancer (Render, Railway, Cloud Run…)
// so req.ip and secure cookies work.
app.set("trust proxy", 1);

// ---- Security ----
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  })
);

// ---- Body parsing ----
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Request logging (one line per request) ----
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
  })
);

// ---- Health check: confirms the server AND the database are up ----
app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, 200, {
      status: "ok",
      database: "up",
      uptime: process.uptime(),
    });
  })
);

// ---- API routes ----
app.use("/api", apiRoutes);

// ---- 404, then the error handler: these two must stay LAST, in this order ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
