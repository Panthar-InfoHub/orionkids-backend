/**
 * In-memory idempotency cache for HTTP requests.
 * Prevents accidental duplicate submissions caused by double-clicking
 * or retrying the same HTTP request with the same idempotency key.
 */

interface IdempotencyRecord<T = unknown> {
  result: T;
  statusCode: number;
  createdAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

class IdempotencyRegistry {
  private store = new Map<string, IdempotencyRecord>();

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now - record.createdAt > CACHE_TTL_MS) {
        this.store.delete(key);
      }
    }
  }

  get<T>(userId: string, key: string): IdempotencyRecord<T> | null {
    this.cleanup();
    const entry = this.store.get(`${userId}:${key}`);
    return (entry as IdempotencyRecord<T>) || null;
  }

  set<T>(userId: string, key: string, result: T, statusCode: number = 200): void {
    this.cleanup();
    this.store.set(`${userId}:${key}`, {
      result,
      statusCode,
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.store.clear();
  }
}

export const idempotencyRegistry = new IdempotencyRegistry();
