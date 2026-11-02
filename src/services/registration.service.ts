import { prisma } from "../lib/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "../utils/errors.js";
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_POLICY_VERSION,
  type AcceptTermsBody,
  type SubmitAccessRequestBody,
} from "../validators/registration.schema.js";

export interface RegistrationStatusResult {
  userId: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  accountStatus: "PENDING" | "ACTIVE" | "RESTRICTED";
  termsAccepted: boolean;
  currentTermsVersion: string;
  userTermsVersion: string | null;
  termsAcceptedAt: Date | null;
  privacyPolicyVersion: string | null;
  privacyAcceptedAt: Date | null;
  accessRequestStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  accessRequest: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedById: string | null;
    rejectionReason: string | null;
  } | null;
  onboardingCompleted: boolean;
  childProfileCount: number;
  destination: string;
}

export function determineDestination(status: {
  accountStatus: "PENDING" | "ACTIVE" | "RESTRICTED";
  role: "USER" | "ADMIN";
  termsAccepted: boolean;
  accessRequestStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  onboardingCompleted: boolean;
}): string {
  // 1. Restricted
  if (status.accountStatus === "RESTRICTED") {
    return "/access-denied";
  }

  // 2. Active Admin
  if (status.role === "ADMIN" && status.accountStatus === "ACTIVE") {
    return "/admin";
  }

  // 3. Terms not accepted
  if (!status.termsAccepted) {
    return "/terms-and-conditions";
  }

  // 4. Access request rejected
  if (status.accessRequestStatus === "REJECTED") {
    return "/access-rejected";
  }

  // 5. Terms accepted, no access request submitted yet
  if (status.accessRequestStatus === "NONE") {
    return "/access-request";
  }

  // 6. Access request pending review
  if (status.accessRequestStatus === "PENDING" || status.accountStatus === "PENDING") {
    return "/access-pending";
  }

  // 7. Request approved, check onboarding
  if (status.accountStatus === "ACTIVE") {
    if (!status.onboardingCompleted) {
      return "/onboarding";
    }
    return "/dashboard";
  }

  return "/access-pending";
}

export async function getRegistrationStatus(
  userId: string
): Promise<RegistrationStatusResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      termsAccepted: true,
      termsVersion: true,
      termsAcceptedAt: true,
      privacyPolicyVersion: true,
      privacyAcceptedAt: true,
      onboardingSubmittedAt: true,
      _count: {
        select: {
          childProfiles: true,
        },
      },
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
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const latestRequest = user.accessRequests[0] || null;
  const isTermsValid =
    user.termsAccepted === true && user.termsVersion === CURRENT_TERMS_VERSION;

  let requestStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" = "NONE";
  if (latestRequest) {
    requestStatus = latestRequest.status;
  } else if (user.status === "ACTIVE" || user.role === "ADMIN") {
    // Legacy active account
    requestStatus = "APPROVED";
  }

  const onboardingCompleted =
    Boolean(user.onboardingSubmittedAt) || user._count.childProfiles > 0;

  const destination = determineDestination({
    accountStatus: user.status,
    role: user.role,
    termsAccepted: isTermsValid,
    accessRequestStatus: requestStatus,
    onboardingCompleted,
  });

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.status,
    termsAccepted: isTermsValid,
    currentTermsVersion: CURRENT_TERMS_VERSION,
    userTermsVersion: user.termsVersion,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyPolicyVersion: user.privacyPolicyVersion,
    privacyAcceptedAt: user.privacyAcceptedAt,
    accessRequestStatus: requestStatus,
    accessRequest: latestRequest,
    onboardingCompleted,
    childProfileCount: user._count.childProfiles,
    destination,
  };
}

export async function acceptUserTerms(
  userId: string,
  input: AcceptTermsBody,
  metadata?: { ipAddress?: string; userAgent?: string }
): Promise<RegistrationStatusResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError("Your account is restricted", "ACCOUNT_RESTRICTED");
  }

  const termsVersion = input.termsVersion || CURRENT_TERMS_VERSION;
  const privacyPolicyVersion =
    input.privacyPolicyVersion || CURRENT_PRIVACY_POLICY_VERSION;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        termsAccepted: true,
        termsVersion,
        termsAcceptedAt: now,
        privacyPolicyVersion,
        privacyAcceptedAt: now,
      },
    });

    await tx.termsAcceptance.create({
      data: {
        userId,
        termsVersion,
        privacyPolicyVersion,
        acceptedAt: now,
        ipAddress: metadata?.ipAddress || null,
        userAgent: metadata?.userAgent || null,
      },
    });
  });

  return getRegistrationStatus(userId);
}

export async function submitUserAccessRequest(
  userId: string,
  input: SubmitAccessRequestBody
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      role: true,
      termsAccepted: true,
      termsVersion: true,
      accessRequests: {
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError("Your account is restricted", "ACCOUNT_RESTRICTED");
  }

  // 1. Verify terms acceptance
  if (!user.termsAccepted || user.termsVersion !== CURRENT_TERMS_VERSION) {
    throw new ForbiddenError(
      "You must accept the Terms & Conditions and Privacy Policy before submitting an access request.",
      "TERMS_REQUIRED"
    );
  }

  // 2. Prevent duplicate pending requests
  const latestRequest = user.accessRequests[0];
  if (latestRequest && latestRequest.status === "PENDING") {
    throw new ConflictError(
      "An access request is already pending review. Please wait for an administrator to review your request."
    );
  }

  // If already approved active user
  if (user.status === "ACTIVE" && latestRequest?.status === "APPROVED") {
    return {
      message: "Your account is already active and approved.",
      request: latestRequest,
      status: await getRegistrationStatus(userId),
    };
  }

  // 3. Create new access request and ensure user status is PENDING
  const newRequest = await prisma.$transaction(async (tx) => {
    const created = await tx.accessRequest.create({
      data: {
        userId,
        status: "PENDING",
        notes: input.notes || null,
        submittedAt: new Date(),
      },
    });

    if (user.status !== "PENDING" && user.role !== "ADMIN") {
      await tx.user.update({
        where: { id: userId },
        data: { status: "PENDING" },
      });
    }

    return created;
  });

  const regStatus = await getRegistrationStatus(userId);
  return {
    message: "Access request submitted successfully.",
    request: newRequest,
    status: regStatus,
  };
}

export async function getMyAccessRequests(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const requests = await prisma.accessRequest.findMany({
    where: { userId },
    orderBy: { submittedAt: "desc" },
  });

  const regStatus = await getRegistrationStatus(userId);

  return {
    currentRequest: requests[0] || null,
    history: requests,
    status: regStatus,
  };
}
