import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type { SubmitOnboardingInput } from "../validators/onboarding.schema.js";
import { idempotencyRegistry } from "../utils/idempotency.js";

export async function submitUserOnboarding(
  userId: string,
  input: SubmitOnboardingInput,
  idempotencyKey?: string
) {
  const effectiveIdempotencyKey = idempotencyKey || input.idempotencyKey;
  if (effectiveIdempotencyKey) {
    const lock = await idempotencyRegistry.acquireLock<{
      user: any;
      childProfile: any;
      session: any;
      sessionId: string;
    }>(userId, "onboarding", effectiveIdempotencyKey);
    if (lock.isCached && lock.result) {
      return lock.result;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, role: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError(
      "Your account is restricted",
      "ACCOUNT_RESTRICTED"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Every deliberate onboarding submission creates a distinct, new ChildProfile record
    const childProfile = await tx.childProfile.create({
      data: {
        userId,
        childName: input.childName,
        age: input.age,
        language: input.language,
        school: input.school || null,
        selectedClass: input.selectedClass,
        studentId: input.studentId || null,
        parentEmail: input.parentEmail,
        parentMobile: input.parentMobile,
        isGuardian: input.isGuardian,
      },
    });

    // Create an independent initial quest session specifically bound to this newly created child profile
    const session = await tx.questSession.create({
      data: {
        userId,
        childProfileId: childProfile.id,
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        onboardingSubmittedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        onboardingSubmittedAt: true,
      },
    });

    return {
      user: updatedUser,
      childProfile,
      session,
      sessionId: session.id,
    };
  });

  if (effectiveIdempotencyKey) {
    await idempotencyRegistry.saveResult(
      userId,
      "onboarding",
      effectiveIdempotencyKey,
      result,
      200
    );
  }

  logger.info(
    {
      userId,
      childProfileId: result.childProfile.id,
      childName: result.childProfile.childName,
      sessionId: result.sessionId,
    },
    "onboarding.submitted"
  );

  return result;
}
