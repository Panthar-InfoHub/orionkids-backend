import http from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(
    `🚀 Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`
  );
});

// ---- Graceful shutdown ----
// Stop accepting new connections, let in-flight requests finish,
// close the DB connection, then exit.
let isShuttingDown = false;

function shutdown(signal: string, exitCode = 0): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async (err) => {
    if (err) logger.error({ err }, "Error while closing HTTP server");

    await prisma.$disconnect();
    logger.info("Shutdown complete");
    process.exit(err ? 1 : exitCode);
  });

  // Force-exit if something hangs (e.g. a stuck keep-alive connection).
  setTimeout(() => {
    logger.error("Forced shutdown after 10s timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---- Last-resort safety nets ----
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception, process state is unreliable");
  process.exit(1);
});
