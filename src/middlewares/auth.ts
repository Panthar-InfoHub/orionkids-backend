import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const requireAuth: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError("User not found", "UNAUTHENTICATED");
    }

    req.authCtx = {
      userId: user.id,
      sessionId: session.session.id,
      role: user.role,
      status: user.status,
    };

    next();
  }
);

export const checkAccountActive: RequestHandler = (req, _res, next) => {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  if (req.authCtx.status === "RESTRICTED") {
    throw new ForbiddenError(
      "Your account is restricted",
      "ACCOUNT_RESTRICTED"
    );
  }

  if (req.authCtx.status === "PENDING") {
    throw new ForbiddenError(
      "Your account review is pending",
      "ACCOUNT_PENDING"
    );
  }

  next();
};

export const checkAdminRole: RequestHandler = (req, _res, next) => {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  if (req.authCtx.role !== "ADMIN") {
    throw new ForbiddenError("Forbidden", "FORBIDDEN");
  }

  next();
};

export const requireActive: RequestHandler[] = [
  requireAuth,
  checkAccountActive,
];

export const requireAdmin: RequestHandler[] = [
  ...requireActive,
  checkAdminRole,
];
