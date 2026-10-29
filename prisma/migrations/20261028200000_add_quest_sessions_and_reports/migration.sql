-- CreateEnum
CREATE TYPE "QuestSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "LevelAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "quest_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "QuestSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStage" TEXT NOT NULL DEFAULT 'WARM_UP',
    "currentGame" INTEGER NOT NULL DEFAULT 1,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),

    CONSTRAINT "quest_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warm_up_submission" (
    "id" TEXT NOT NULL,
    "questSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warm_up_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_attempt" (
    "id" TEXT NOT NULL,
    "questSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" INTEGER NOT NULL,
    "gameKey" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "LevelAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "totalTrials" INTEGER,
    "correctTrials" INTEGER,
    "accuracy" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "averageReactionTimeMs" INTEGER,
    "metrics" JSONB,
    "trialRecords" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "level_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_report" (
    "id" TEXT NOT NULL,
    "questSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "selectedClass" TEXT NOT NULL,
    "school" TEXT,
    "overallAccuracy" DOUBLE PRECISION NOT NULL,
    "totalDurationMs" INTEGER NOT NULL,
    "gameSummaries" JSONB NOT NULL,
    "cognitiveFacets" JSONB NOT NULL,
    "growthObservations" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quest_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quest_session_userId_status_idx" ON "quest_session"("userId", "status");

-- CreateIndex
CREATE INDEX "quest_session_userId_startedAt_idx" ON "quest_session"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warm_up_submission_questSessionId_key" ON "warm_up_submission"("questSessionId");

-- CreateIndex
CREATE INDEX "warm_up_submission_userId_idx" ON "warm_up_submission"("userId");

-- CreateIndex
CREATE INDEX "level_attempt_questSessionId_gameKey_levelNumber_idx" ON "level_attempt"("questSessionId", "gameKey", "levelNumber");

-- CreateIndex
CREATE INDEX "level_attempt_userId_idx" ON "level_attempt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "quest_report_questSessionId_key" ON "quest_report"("questSessionId");

-- CreateIndex
CREATE INDEX "quest_report_userId_idx" ON "quest_report"("userId");

-- AddForeignKey
ALTER TABLE "quest_session" ADD CONSTRAINT "quest_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warm_up_submission" ADD CONSTRAINT "warm_up_submission_questSessionId_fkey" FOREIGN KEY ("questSessionId") REFERENCES "quest_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_attempt" ADD CONSTRAINT "level_attempt_questSessionId_fkey" FOREIGN KEY ("questSessionId") REFERENCES "quest_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_report" ADD CONSTRAINT "quest_report_questSessionId_fkey" FOREIGN KEY ("questSessionId") REFERENCES "quest_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
