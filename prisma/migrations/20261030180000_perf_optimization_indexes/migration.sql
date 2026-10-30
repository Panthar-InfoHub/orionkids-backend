-- CreateIndex
CREATE INDEX IF NOT EXISTS "quest_session_userId_lastActivityAt_idx" ON "quest_session"("userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quest_session_childProfileId_startedAt_idx" ON "quest_session"("childProfileId", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "level_attempt_questSessionId_status_idx" ON "level_attempt"("questSessionId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "level_attempt_questSessionId_startedAt_idx" ON "level_attempt"("questSessionId", "startedAt");

