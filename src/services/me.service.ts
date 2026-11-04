import { prisma } from "../lib/prisma.js";
import { CURRENT_TERMS_VERSION } from "../validators/registration.schema.js";

export async function getCurrentUserProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      status: true,
      restrictedReason: true,
      onboardingSubmittedAt: true,
      termsAccepted: true,
      termsVersion: true,
      termsAcceptedAt: true,
      privacyPolicyVersion: true,
      privacyAcceptedAt: true,
      accessRequests: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          reviewedById: true,
          rejectionReason: true,
        },
      },
      childProfiles: {
        select: {
          id: true,
          childName: true,
          age: true,
          language: true,
          school: true,
          selectedClass: true,
          studentId: true,
          parentEmail: true,
          parentMobile: true,
          isGuardian: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const latestRequest = user.accessRequests[0] || null;
  const isTermsValid =
    user.termsAccepted === true && user.termsVersion === CURRENT_TERMS_VERSION;

  let accessRequestStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" =
    "NONE";
  if (latestRequest) {
    accessRequestStatus = latestRequest.status;
  } else if (user.status === "ACTIVE" || user.role === "ADMIN") {
    accessRequestStatus = "APPROVED";
  }

  return {
    ...user,
    termsAccepted: isTermsValid,
    accessRequestStatus,
    accessRequest: latestRequest,
    childProfile: user.childProfiles[0] || null,
  };
}

export async function deleteCurrentUserAccount(userId: string) {
  await prisma.user.delete({
    where: { id: userId },
  });

  return {
    success: true,
    message: "Account and associated data deleted successfully",
  };
}
