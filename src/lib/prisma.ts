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

/**
 * Normalizes PostgreSQL / Neon connection strings and resolves SSL parameters.
 * - Converts 'sslmode=require', 'sslmode=prefer', and 'sslmode=verify-ca' to 'sslmode=verify-full'
 *   to eliminate pg-connection-string deprecation warnings and ensure genuine certificate validation.
 * - Appends 'sslmode=verify-full' for Neon connections if no sslmode is specified.
 * - Does not enable SSL for local databases (e.g., localhost, 127.0.0.1, sslmode=disable).
 * - Enforces verified TLS in production without setting rejectUnauthorized: false unless
 *   explicitly authorized by PG_SSL_ALLOW_INSECURE=true or NODE_TLS_REJECT_UNAUTHORIZED=0.
 */
export function normalizeDatabaseConnectionString(rawUrl: string): {
  normalizedConnectionString: string;
  isNeon: boolean;
  sslRequired: boolean;
} {
  if (!rawUrl) {
    return {
      normalizedConnectionString: rawUrl,
      isNeon: false,
      sslRequired: false,
    };
  }

  const isNeon = rawUrl.includes("neon.tech");
  let sslRequired = false;

  try {
    const parsed = new URL(rawUrl);
    const sslmode = parsed.searchParams.get("sslmode");

    if (
      isNeon ||
      sslmode === "require" ||
      sslmode === "prefer" ||
      sslmode === "verify-ca"
    ) {
      parsed.searchParams.set("sslmode", "verify-full");
      sslRequired = true;
    } else if (sslmode === "verify-full") {
      sslRequired = true;
    } else if (sslmode === "disable") {
      sslRequired = false;
    }

    return {
      normalizedConnectionString: parsed.toString(),
      isNeon,
      sslRequired,
    };
  } catch {
    let normalized = rawUrl;
    if (
      rawUrl.includes("sslmode=require") ||
      rawUrl.includes("sslmode=prefer") ||
      rawUrl.includes("sslmode=verify-ca")
    ) {
      normalized = rawUrl
        .replace(/sslmode=require/g, "sslmode=verify-full")
        .replace(/sslmode=prefer/g, "sslmode=verify-full")
        .replace(/sslmode=verify-ca/g, "sslmode=verify-full");
      sslRequired = true;
    } else if (isNeon) {
      normalized +=
        (normalized.includes("?") ? "&" : "?") + "sslmode=verify-full";
      sslRequired = true;
    }
    return {
      normalizedConnectionString: normalized,
      isNeon,
      sslRequired,
    };
  }
}

const activeConnectionString = isTest
  ? env.DATABASE_URL_TEST!
  : env.DATABASE_URL;

const {
  normalizedConnectionString,
  isNeon: isNeonConnection,
  sslRequired: isSslRequired,
} = normalizeDatabaseConnectionString(activeConnectionString);

const useNeonWebSocket =
  process.env.USE_NEON_WEBSOCKET === "true" ||
  process.env.USE_NEON_WEBSOCKET === "1";

const allowInsecureTls =
  process.env.PG_SSL_ALLOW_INSECURE === "true" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";

let adapter: PrismaNeon | PrismaPg;

let activePool: PgPool | null = null;

if (useNeonWebSocket && isNeonConnection) {
  adapter = new PrismaNeon(
    {
      connectionString: normalizedConnectionString,
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
    connectionString: normalizedConnectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ...(allowInsecureTls && isSslRequired
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
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

/**
 * Detects transient PostgreSQL / Neon concurrency conflicts, deadlocks, and serialization failures.
 * Prisma code P2034: Transaction failed due to a write conflict or a deadlock.
 */
export function isTransactionConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as any;
  if (anyErr.code === "P2034") return true;
  const message = String(anyErr.message || "").toLowerCase();
  return (
    message.includes("write conflict") ||
    message.includes("deadlock") ||
    message.includes("please retry your transaction") ||
    message.includes("could not serialize access") ||
    message.includes("concurrent update") ||
    message.includes("lock timeout")
  );
}

/**
 * Executes an interactive Prisma transaction with automatic jittered exponential backoff
 * when transient concurrency write conflicts or deadlocks are detected.
 */
export async function withTransactionRetry<T>(
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 60;
  let attempt = 0;

  while (true) {
    try {
      return await prisma.$transaction(action, {
        maxWait: options?.maxWait ?? 15000,
        timeout: options?.timeout ?? 25000,
        isolationLevel: options?.isolationLevel,
      });
    } catch (error) {
      attempt++;
      if (attempt <= maxRetries && isTransactionConflictError(error)) {
        const jitter = Math.floor(Math.random() * 50);
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        logger.warn(
          { attempt, maxRetries, delay, message: (error as any)?.message },
          "Database transaction conflict or deadlock detected; retrying with backoff"
        );
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      throw error;
    }
  }
}

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
