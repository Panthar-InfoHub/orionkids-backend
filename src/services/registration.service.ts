import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
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
    return "/account/restricted";
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

  // 6. Request approved / user active, check onboarding (ACTIVE status is authoritative - Issue #2)
  if (status.accountStatus === "ACTIVE") {
    if (!status.onboardingCompleted) {
      return "/onboarding";
    }
    return "/dashboard";
  }

  // 7. Access request pending review
  if (
    status.accessRequestStatus === "PENDING" ||
    status.accountStatus === "PENDING"
  ) {
    return "/access-pending";
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

  let latestRequest = user.accessRequests[0] || null;

  // Self-heal: If an eligible PENDING user has no access request, create one idempotently
  if (!latestRequest && user.role === "USER" && user.status === "PENDING") {
    const created = await ensureUserAccessRequest(userId, {
      source: "get_registration_status",
    });
    if (created) {
      latestRequest = {
        id: created.id,
        status: created.status,
        submittedAt: created.submittedAt,
        reviewedAt: created.reviewedAt,
        reviewedById: created.reviewedById,
        rejectionReason: created.rejectionReason,
      };
    }
  }
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
    select: { id: true, status: true, role: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError(
      "Your account access is currently restricted.",
      "ACCOUNT_RESTRICTED"
    );
  }

  const termsVersion = CURRENT_TERMS_VERSION;
  const privacyPolicyVersion = CURRENT_PRIVACY_POLICY_VERSION;
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

  logger.info(
    { userId, termsVersion, privacyPolicyVersion },
    "registration.terms_accepted"
  );

  // If user is an eligible PENDING USER, ensure their access request is present
  if (user.role === "USER" && user.status === "PENDING") {
    await ensureUserAccessRequest(userId, { source: "terms_accepted" });
  }

  return getRegistrationStatus(userId);
}

/**
 * Ensures that an eligible pending USER has an active access request.
 * Enforces business rules:
 * - Never create requests for ADMIN accounts
 * - Never create requests for RESTRICTED accounts
 * - Never reset an ACTIVE user to PENDING
 * - Never overwrite existing approved or rejected decisions
 * - Never duplicate an existing pending request
 * - Uses the database partial unique constraint for race condition safety
 */
export async function ensureUserAccessRequest(
  userId: string,
  options?: { notes?: string; source?: string }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      accessRequests: {
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!user) {
    logger.warn({ userId }, "registration.ensure_request.user_not_found");
    return null;
  }

  // Business Rule: Never create admin requests for ADMIN accounts
  if (user.role === "ADMIN") {
    logger.info({ userId }, "registration.ensure_request.skipped_admin");
    return null;
  }

  // Business Rule: Never create requests for RESTRICTED users
  if (user.status === "RESTRICTED") {
    logger.info({ userId }, "registration.ensure_request.skipped_restricted");
    return null;
  }

  // Business Rule: If user is ACTIVE, do not create pending requests (preserve active state)
  if (user.status === "ACTIVE") {
    return user.accessRequests[0] || null;
  }

  const latest = user.accessRequests[0];

  // Business Rule: Never duplicate an existing pending request
  if (latest && latest.status === "PENDING") {
    if (options?.notes && options.notes !== latest.notes) {
      const updated = await prisma.accessRequest.update({
        where: { id: latest.id },
        data: { notes: options.notes },
      });
      logger.info(
        { userId, requestId: latest.id },
        "registration.access_request_notes_updated"
      );
      return updated;
    }
    logger.info(
      { userId, requestId: latest.id },
      "registration.existing_pending_request_detected"
    );
    return latest;
  }

  // Business Rule: Preserve existing rejection/approval decision
  if (latest && (latest.status === "REJECTED" || latest.status === "APPROVED")) {
    logger.info(
      { userId, requestId: latest.id, status: latest.status },
      "registration.existing_decision_preserved"
    );
    return latest;
  }

  // User is PENDING and has no access request: create one idempotently
  try {
    const created = await prisma.accessRequest.create({
      data: {
        userId,
        status: "PENDING",
        notes: options?.notes || null,
        submittedAt: new Date(),
      },
    });

    logger.info(
      { userId, requestId: created.id, source: options?.source || "auto" },
      "registration.access_request_created"
    );

    return created;
  } catch (err: any) {
    // If concurrent creation occurred, PostgreSQL unique_pending_access_request_per_user catches it
    if (err?.code === "P2002") {
      logger.info(
        { userId },
        "registration.access_request_concurrent_conflict_handled"
      );
      return prisma.accessRequest.findFirst({
        where: { userId, status: "PENDING" },
      });
    }
    logger.error(
      { err, userId },
      "registration.access_request_creation_failed"
    );
    throw err;
  }
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

  // 1. Never create admin requests for ADMIN accounts
  if (user.role === "ADMIN") {
    throw new ForbiddenError(
      "Admin accounts do not submit access requests",
      "ADMIN_NO_ACCESS_REQUEST"
    );
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError(
      "Your account access is currently restricted.",
      "ACCOUNT_RESTRICTED"
    );
  }

  // 2. Verify terms acceptance
  if (!user.termsAccepted || user.termsVersion !== CURRENT_TERMS_VERSION) {
    throw new ForbiddenError(
      "You must accept the Terms & Conditions and Privacy Policy before submitting an access request.",
      "TERMS_REQUIRED"
    );
  }

  // 3. Prevent duplicate pending requests
  const latestRequest = user.accessRequests[0];
  if (latestRequest && latestRequest.status === "PENDING") {
    // If request was auto-created without notes, allow the user to complete their submission
    if (!latestRequest.notes && input.notes) {
      const updated = await prisma.accessRequest.update({
        where: { id: latestRequest.id },
        data: { notes: input.notes },
      });
      const regStatus = await getRegistrationStatus(userId);
      return {
        message: "Access request submitted successfully.",
        request: updated,
        status: regStatus,
      };
    }

    if (!latestRequest.notes && !input.notes) {
      const regStatus = await getRegistrationStatus(userId);
      return {
        message: "Access request submitted successfully.",
        request: latestRequest,
        status: regStatus,
      };
    }

    // A deliberate request has already been submitted with notes: strictly prevent duplicate submissions
    throw new ConflictError(
      "An access request is already pending review. Please wait for an administrator to review your request."
    );
  }

  // 4. If user is already active, never demote them back to PENDING (Issue #17)
  if (user.status === "ACTIVE") {
    return {
      message: "Your account is already active and approved.",
      request: latestRequest || null,
      status: await getRegistrationStatus(userId),
    };
  }

  // 5. Create new access request and ensure user status is PENDING
  let newRequest;
  try {
    newRequest = await prisma.$transaction(async (tx) => {
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
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw new ConflictError(
        "An access request is already pending review. Please wait for an administrator to review your request."
      );
    }
    throw err;
  }

  const regStatus = await getRegistrationStatus(userId);

  logger.info(
    { userId, requestId: newRequest.id, notes: input.notes },
    "registration.access_request_submitted"
  );

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
