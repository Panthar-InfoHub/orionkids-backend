-- CreateTable
CREATE TABLE IF NOT EXISTS "idempotency_key" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_FLIGHT',
    "statusCode" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_key_userId_endpoint_key_key" UNIQUE ("userId", "endpoint", "key"),
    CONSTRAINT "idempotency_key_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idempotency_key_createdAt_idx" ON "idempotency_key"("createdAt");

-- Create unique index on level_attempt for session, gameKey, levelNumber, attemptNumber
CREATE UNIQUE INDEX IF NOT EXISTS "level_attempt_questSessionId_gameKey_levelNumber_attemptNumber_key"
ON "level_attempt"("questSessionId", "gameKey", "levelNumber", "attemptNumber");

-- Add foreign keys for LevelAttempt.userId and WarmUpSubmission.userId
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'level_attempt_userId_fkey') THEN
    ALTER TABLE "level_attempt" ADD CONSTRAINT "level_attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warm_up_submission_userId_fkey') THEN
    ALTER TABLE "warm_up_submission" ADD CONSTRAINT "warm_up_submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_quest_session_per_child"
ON "quest_session"("childProfileId")
WHERE "status" = 'IN_PROGRESS' AND "childProfileId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "unique_pending_access_request_per_user"
ON "access_request"("userId")
WHERE "status" = 'PENDING';

