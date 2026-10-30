import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";
import { env, isDev } from "../config/env.js";
import { logger } from "./logger.js";

// Runtime uses the POOLED connection string.
// Configure connection pool timeouts and error handlers to safely handle serverless resets.
const adapter = new PrismaNeon(
  {
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  },
  {
    onPoolError: (err) => {
      logger.error({ err: err?.message || err }, "Neon database pool error");
    },
    onConnectionError: (err) => {
      logger.error({ err: err?.message || err }, "Neon database connection error");
    },
  }
);

export const prisma = new PrismaClient({
  adapter,
  log: isDev ? ["warn", "error"] : ["error"],
});
