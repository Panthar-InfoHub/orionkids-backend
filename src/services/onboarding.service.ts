import { prisma } from "../lib/prisma.js";
import { ForbiddenError } from "../utils/errors.js";
import type { SubmitOnboardingInput } from "../validators/onboarding.schema.js";

export async function submitUserOnboarding(
  userId: string,
  input: SubmitOnboardingInput
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, role: true },
  });

  if (!user) {
    throw new ForbiddenError("User not found", "USER_NOT_FOUND");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError("Your account is restricted", "ACCOUNT_RESTRICTED");
  }

  return prisma.$transaction(async (tx) => {
    const childProfile = await tx.childProfile.upsert({
      where: { userId },
      create: {
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
      update: {
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
    };
  });
}
