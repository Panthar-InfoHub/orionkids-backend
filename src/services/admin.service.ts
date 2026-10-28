import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ForbiddenError } from "../utils/errors.js";
import type {
  ListUsersQuery,
  UpdateUserStatusBody,
} from "../validators/admin.schema.js";

export async function listUsers(query: ListUsersQuery) {
  const where: any = {};
  if (query.status) {
    where.status = query.status;
    // When filtering by PENDING, ensure the queue represents actual submitted onboarding requests
    if (query.status === "PENDING") {
      where.onboardingSubmittedAt = { not: null };
    }
  }

  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        restrictedReason: true,
        reviewedAt: true,
        reviewedById: true,
        onboardingSubmittedAt: true,
        createdAt: true,
        updatedAt: true,
        childProfile: {
          select: {
            childName: true,
            age: true,
            language: true,
            school: true,
            selectedClass: true,
            studentId: true,
            parentEmail: true,
            parentMobile: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function setUserStatus(
  adminId: string,
  targetUserId: string,
  input: UpdateUserStatusBody
) {
  if (adminId === targetUserId) {
    throw new ForbiddenError(
      "You cannot change your own account status",
      "FORBIDDEN"
    );
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: targetUserId },
      data: {
        status: input.status,
        restrictedReason: input.status === "RESTRICTED" ? input.reason : null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        restrictedReason: true,
        reviewedAt: true,
        reviewedById: true,
        onboardingSubmittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (input.status === "RESTRICTED") {
      await tx.session.deleteMany({
        where: { userId: targetUserId },
      });
    }

    return user;
  });

  logger.info(
    { adminId, targetId: targetUserId, status: input.status },
    "admin.user_status_changed"
  );

  return updatedUser;
}
