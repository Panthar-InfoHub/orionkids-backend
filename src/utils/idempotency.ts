import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

interface IdempotencyRecord<T = unknown> {
  result: T;
  statusCode: number;
  createdAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class IdempotencyRegistry {
  private inMemoryStore = new Map<string, IdempotencyRecord>();

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.inMemoryStore.entries()) {
      if (now - record.createdAt > CACHE_TTL_MS) {
        this.inMemoryStore.delete(key);
      }
    }
  }

  get<T>(userId: string, key: string): IdempotencyRecord<T> | null {
    this.cleanup();
    const entry = this.inMemoryStore.get(`${userId}:${key}`);
    return (entry as IdempotencyRecord<T>) || null;
  }

  set<T>(
    userId: string,
    key: string,
    result: T,
    statusCode: number = 200
  ): void {
    this.cleanup();
    this.inMemoryStore.set(`${userId}:${key}`, {
      result,
      statusCode,
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.inMemoryStore.clear();
  }

  /**
   * Acquire an atomic in-flight idempotency lock in PostgreSQL.
   * If a previous request already completed with this key, returns the cached result.
   * If a concurrent request is currently in-flight, returns lockAcquired: false.
   */
  async acquireLock<T>(
    userId: string,
    endpoint: string,
    key: string
  ): Promise<{
    isCached: boolean;
    result?: T;
    statusCode?: number;
    lockAcquired: boolean;
  }> {
    // 1. Check in-memory fast-path first
    const memoryRecord = this.get<T>(userId, `${endpoint}:${key}`);
    if (memoryRecord) {
      return {
        isCached: true,
        result: memoryRecord.result,
        statusCode: memoryRecord.statusCode,
        lockAcquired: false,
      };
    }

    try {
      // 2. Attempt to create atomic lock row in DB
      await (prisma as any).idempotencyKey.create({
        data: {
          userId,
          endpoint,
          key,
          status: "IN_FLIGHT",
          lockedAt: new Date(),
        },
      });

      return { isCached: false, lockAcquired: true };
    } catch (err: any) {
      // P2002: Unique constraint failed on (userId, endpoint, key)
      if (err?.code === "P2002") {
        try {
          const existing = await (prisma as any).idempotencyKey.findUnique({
            where: {
              userId_endpoint_key: {
                userId,
                endpoint,
                key,
              },
            },
          });

          if (existing?.status === "COMPLETED" && existing.response) {
            return {
              isCached: true,
              result: existing.response as T,
              statusCode: existing.statusCode || 200,
              lockAcquired: false,
            };
          }

          // If lock is older than 60 seconds, treat as expired stale lock
          const isStale =
            existing &&
            Date.now() - new Date(existing.lockedAt).getTime() > 60000;
          if (isStale) {
            await (prisma as any).idempotencyKey.update({
              where: { id: existing.id },
              data: {
                status: "IN_FLIGHT",
                lockedAt: new Date(),
              },
            });
            return { isCached: false, lockAcquired: true };
          }

          return { isCached: false, lockAcquired: false };
        } catch (readErr) {
          logger.warn({ readErr }, "Failed reading existing idempotency lock");
        }
      }

      // If table doesn't exist or DB error, fall back to memory
      return { isCached: false, lockAcquired: true };
    }
  }

  /**
   * Persists the finished result to both DB and memory cache.
   */
  async saveResult<T>(
    userId: string,
    endpoint: string,
    key: string,
    result: T,
    statusCode: number = 200
  ): Promise<void> {
    this.set(userId, `${endpoint}:${key}`, result, statusCode);
    this.set(userId, key, result, statusCode);

    try {
      await (prisma as any).idempotencyKey.upsert({
        where: {
          userId_endpoint_key: {
            userId,
            endpoint,
            key,
          },
        },
        create: {
          userId,
          endpoint,
          key,
          status: "COMPLETED",
          statusCode,
          response: result as any,
          lockedAt: new Date(),
        },
        update: {
          status: "COMPLETED",
          statusCode,
          response: result as any,
        },
      });
    } catch (err) {
      logger.warn({ err }, "Failed saving persistent idempotency record");
    }
  }
}

export const idempotencyRegistry = new IdempotencyRegistry();
