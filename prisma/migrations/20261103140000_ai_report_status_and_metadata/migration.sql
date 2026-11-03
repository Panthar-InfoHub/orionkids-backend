-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'GENERATING', 'GENERATED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "quest_report" 
ADD COLUMN IF NOT EXISTS "status" "ReportStatus" NOT NULL DEFAULT 'GENERATED',
ADD COLUMN IF NOT EXISTS "aiReport" JSONB,
ADD COLUMN IF NOT EXISTS "modelName" TEXT,
ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "quest_report_status_idx" ON "quest_report"("status");

