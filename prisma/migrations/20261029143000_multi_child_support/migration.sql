-- Drop the single-child unique constraint on child_profile.userId
DROP INDEX IF EXISTS "child_profile_userId_key";

-- Create index on child_profile.userId for parent queries
CREATE INDEX IF NOT EXISTS "child_profile_userId_idx" ON "child_profile"("userId");

-- AlterTable: add childProfileId to quest_session
ALTER TABLE "quest_session" ADD COLUMN IF NOT EXISTS "childProfileId" TEXT;

-- CreateIndex on quest_session.childProfileId
CREATE INDEX IF NOT EXISTS "quest_session_childProfileId_idx" ON "quest_session"("childProfileId");
CREATE INDEX IF NOT EXISTS "quest_session_childProfileId_status_idx" ON "quest_session"("childProfileId", "status");

-- AddForeignKey for quest_session.childProfileId
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quest_session_childProfileId_fkey') THEN
    ALTER TABLE "quest_session" ADD CONSTRAINT "quest_session_childProfileId_fkey" FOREIGN KEY ("childProfileId") REFERENCES "child_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable: add childProfileId to quest_report
ALTER TABLE "quest_report" ADD COLUMN IF NOT EXISTS "childProfileId" TEXT;

-- CreateIndex on quest_report.childProfileId
CREATE INDEX IF NOT EXISTS "quest_report_childProfileId_idx" ON "quest_report"("childProfileId");

-- AddForeignKey for quest_report.userId
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quest_report_userId_fkey') THEN
    ALTER TABLE "quest_report" ADD CONSTRAINT "quest_report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey for quest_report.childProfileId
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quest_report_childProfileId_fkey') THEN
    ALTER TABLE "quest_report" ADD CONSTRAINT "quest_report_childProfileId_fkey" FOREIGN KEY ("childProfileId") REFERENCES "child_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Safe non-destructive backfill for historical sessions where the parent has exactly 1 registered child profile
UPDATE "quest_session" qs
SET "childProfileId" = cp.id
FROM "child_profile" cp
WHERE qs."userId" = cp."userId"
  AND qs."childProfileId" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "child_profile" cp2
    WHERE cp2."userId" = qs."userId"
  ) = 1;

-- Safe non-destructive backfill for historical quest reports where the parent has exactly 1 registered child profile
UPDATE "quest_report" qr
SET "childProfileId" = cp.id
FROM "child_profile" cp
WHERE qr."userId" = cp."userId"
  AND qr."childProfileId" IS NULL
  AND (
    SELECT COUNT(*)
    FROM "child_profile" cp2
    WHERE cp2."userId" = qr."userId"
  ) = 1;
