-- CreateEnum
CREATE TYPE "ReportEmailStatus" AS ENUM ('NOT_SENT', 'PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "quest_report" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailRecipient" TEXT,
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailStatus" "ReportEmailStatus" NOT NULL DEFAULT 'NOT_SENT',
ADD COLUMN     "pdfGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "pdfStorageKey" TEXT,
ALTER COLUMN "schemaVersion" SET DEFAULT 2;

-- CreateTable
CREATE TABLE "report_share_link" (
    "id" TEXT NOT NULL,
    "questReportId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_share_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_share_link_tokenHash_key" ON "report_share_link"("tokenHash");

-- CreateIndex
CREATE INDEX "report_share_link_questReportId_idx" ON "report_share_link"("questReportId");

-- CreateIndex
CREATE INDEX "quest_report_emailStatus_idx" ON "quest_report"("emailStatus");

-- AddForeignKey
ALTER TABLE "report_share_link" ADD CONSTRAINT "report_share_link_questReportId_fkey" FOREIGN KEY ("questReportId") REFERENCES "quest_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "level_attempt_questSessionId_gameKey_levelNumber_attemptNumber_" RENAME TO "level_attempt_questSessionId_gameKey_levelNumber_attemptNum_key";
