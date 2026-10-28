import { prisma } from "../lib/prisma.js";

export async function getCurrentUserProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({
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
      childProfile: {
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
        },
      },
    },
  });
}
