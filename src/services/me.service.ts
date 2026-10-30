import { prisma } from "../lib/prisma.js";

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

  return {
    ...user,
    childProfile: user.childProfiles[0] || null,
  };
}
