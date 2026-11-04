import { prisma } from "../lib/prisma.js";
import { NotFoundError, ForbiddenError } from "./errors.js";

/**
 * Asserts that a child profile exists and belongs to the specified parent user.
 * Throws NotFoundError (404) if the child profile doesn't exist,
 * or ForbiddenError (403) if the parent does not own the profile.
 */
export async function assertChildOwnership(
  userId: string,
  childProfileId: string
) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childProfileId },
  });

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "You do not have access to this child profile",
      "ACCESS_DENIED"
    );
  }

  return child;
}
