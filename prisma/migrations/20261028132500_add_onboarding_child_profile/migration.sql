-- AlterTable
ALTER TABLE "user" ADD COLUMN "onboardingSubmittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "child_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "school" TEXT,
    "selectedClass" TEXT NOT NULL,
    "studentId" TEXT,
    "parentEmail" TEXT NOT NULL,
    "parentMobile" TEXT NOT NULL,
    "isGuardian" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "child_profile_userId_key" ON "child_profile"("userId");

-- CreateIndex
CREATE INDEX "user_status_onboardingSubmittedAt_idx" ON "user"("status", "onboardingSubmittedAt");

-- AddForeignKey
ALTER TABLE "child_profile" ADD CONSTRAINT "child_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
