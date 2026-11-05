import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { setRequestContextUser } from "../lib/context.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const requireAuth: RequestHandler = asyncHandler(
  async (req, _res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      logger.warn(
        { path: req.path, method: req.method },
        "auth.unauthenticated_request: Missing or invalid session"
      );
      throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
    }

    // Better Auth includes custom additionalFields (role, status) directly on session.user.
    // Reusing these skips a redundant database round-trip on every authenticated request.
    const sessionUser = session.user as any;
    if (
      sessionUser &&
      sessionUser.id &&
      sessionUser.role &&
      sessionUser.status
    ) {
      req.authCtx = {
        userId: sessionUser.id,
        sessionId: session.session.id,
        role: sessionUser.role,
        status: sessionUser.status,
      };
      setRequestContextUser(sessionUser.id, sessionUser.role);
      logger.debug(
        { userId: sessionUser.id, role: sessionUser.role },
        "auth.session_authenticated"
      );
      return next();
    }

    // Fallback if additionalFields were not populated by the session store
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      logger.warn(
        { userId: session.user.id },
        "auth.user_not_found: Session exists but user not found in database"
      );
      throw new UnauthorizedError("User not found", "UNAUTHENTICATED");
    }

    req.authCtx = {
      userId: user.id,
      sessionId: session.session.id,
      role: user.role,
      status: user.status,
    };
    setRequestContextUser(user.id, user.role);
    logger.debug(
      { userId: user.id, role: user.role },
      "auth.session_authenticated_from_db"
    );

    next();
  }
);

export const checkAccountActive: RequestHandler = (req, _res, next) => {
  if (!req.authCtx) {
    logger.warn("auth.missing_context: checkAccountActive called without authCtx");
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  if (req.authCtx.status === "RESTRICTED") {
    logger.warn(
      { userId: req.authCtx.userId, status: req.authCtx.status },
      "auth.access_rejected: User account is restricted"
    );
    throw new ForbiddenError(
      "Your account is restricted",
      "ACCOUNT_RESTRICTED"
    );
  }

  if (req.authCtx.status === "PENDING") {
    logger.warn(
      { userId: req.authCtx.userId, status: req.authCtx.status },
      "auth.access_rejected: User account review is pending"
    );
    throw new ForbiddenError(
      "Your account review is pending",
      "ACCOUNT_PENDING"
    );
  }

  next();
};

export const checkAdminRole: RequestHandler = (req, _res, next) => {
  if (!req.authCtx) {
    logger.warn("auth.missing_context: checkAdminRole called without authCtx");
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  if (req.authCtx.role !== "ADMIN") {
    logger.warn(
      { userId: req.authCtx.userId, role: req.authCtx.role },
      "auth.admin_access_denied: Non-admin attempted to access admin endpoint"
    );
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
