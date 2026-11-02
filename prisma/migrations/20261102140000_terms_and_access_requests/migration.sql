-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessRequestStatus') THEN
    CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "privacyPolicyVersion" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "privacyAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "access_request" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "terms_acceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyPolicyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_acceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "access_request_userId_status_idx" ON "access_request"("userId", "status");
CREATE INDEX IF NOT EXISTS "access_request_status_submittedAt_idx" ON "access_request"("status", "submittedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "terms_acceptance_userId_termsVersion_idx" ON "terms_acceptance"("userId", "termsVersion");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_request_userId_fkey'
  ) THEN
    ALTER TABLE "access_request" ADD CONSTRAINT "access_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terms_acceptance_userId_fkey'
  ) THEN
    ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backward compatibility data reconciliation:
-- Existing ACTIVE users or ADMINs are already active in production and should have terms marked accepted
UPDATE "user"
SET "termsAccepted" = true,
    "termsVersion" = 'v1.0',
    "termsAcceptedAt" = CURRENT_TIMESTAMP,
    "privacyPolicyVersion" = 'v1.0',
    "privacyAcceptedAt" = CURRENT_TIMESTAMP
WHERE ("status" = 'ACTIVE' OR "role" = 'ADMIN') AND "termsAccepted" = false;

-- Create legacy approved access request record for existing ACTIVE users or ADMINs so their history is consistent
INSERT INTO "access_request" ("id", "userId", "status", "submittedAt", "reviewedAt", "reviewedById", "createdAt", "updatedAt")
SELECT
    'legacy_' || "id",
    "id",
    'APPROVED'::"AccessRequestStatus",
    "createdAt",
    CURRENT_TIMESTAMP,
    'SYSTEM_MIGRATION',
    "createdAt",
    CURRENT_TIMESTAMP
FROM "user"
WHERE ("status" = 'ACTIVE' OR "role" = 'ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM "access_request" WHERE "access_request"."userId" = "user"."id"
  );
