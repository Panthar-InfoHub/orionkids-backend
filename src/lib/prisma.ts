import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool as PgPool } from "pg";
import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { env, isDev, isTest } from "../config/env.js";
import { logger } from "./logger.js";

export { Prisma };

// Safety check for test database isolation (Issue #21)
if (isTest) {
  if (!env.DATABASE_URL_TEST) {
    throw new Error(
      "FATAL: DATABASE_URL_TEST is not configured in test environment. Tests cannot run against production database!"
    );
  }
  if (env.DATABASE_URL_TEST === env.DATABASE_URL) {
    throw new Error(
      "FATAL: DATABASE_URL_TEST is identical to DATABASE_URL. Running tests against production database is strictly forbidden!"
    );
  }
}

const activeConnectionString = isTest
  ? env.DATABASE_URL_TEST!
  : env.DATABASE_URL;
const isNeonConnection = activeConnectionString.includes("neon.tech");

let adapter: PrismaNeon | PrismaPg;

let activePool: PgPool | null = null;

if (isNeonConnection) {
  adapter = new PrismaNeon(
    {
      connectionString: activeConnectionString,
      max: 20,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 45_000,
    },
    {
      onPoolError: (err) => {
        logger.error({ err: err?.message || err }, "Neon database pool error");
      },
      onConnectionError: (err) => {
        logger.error(
          { err: err?.message || err },
          "Neon database connection error"
        );
      },
    }
  );
} else {
  const pgPool = new PgPool({
    connectionString: activeConnectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  activePool = pgPool;
  pgPool.on("error", (err) => {
    logger.error({ err: err?.message || err }, "PostgreSQL pool error");
  });
  adapter = new PrismaPg(pgPool);
}

export const prisma = new PrismaClient({
  adapter,
  log: isDev ? ["warn", "error"] : ["error"],
});

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, "Error disconnecting Prisma");
  }
  if (activePool) {
    try {
      await activePool.end();
    } catch (err) {
      logger.error({ err }, "Error ending PostgreSQL pool");
    }
  }
}
