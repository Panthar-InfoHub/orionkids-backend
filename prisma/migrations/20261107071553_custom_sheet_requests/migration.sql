-- CreateEnum
CREATE TYPE "CustomSheetRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CustomSheetRequesterRole" AS ENUM ('PARENT', 'TEACHER', 'SCHOOL');

-- CreateTable
CREATE TABLE "custom_sheet_request" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "requesterRole" "CustomSheetRequesterRole" NOT NULL,
    "organizationName" TEXT,
    "phone" TEXT,
    "gradeLevel" TEXT NOT NULL,
    "sheetType" TEXT,
    "details" TEXT NOT NULL,
    "status" "CustomSheetRequestStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_sheet_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_sheet_request_status_createdAt_idx" ON "custom_sheet_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "custom_sheet_request_email_idx" ON "custom_sheet_request"("email");
