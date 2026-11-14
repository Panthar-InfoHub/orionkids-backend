import type { Request, Response } from "express";
import {
  getCurrentUserProfile,
  deleteCurrentUserAccount,
} from "../services/me.service.js";
import { prisma } from "../lib/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function getMeController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const user = await getCurrentUserProfile(req.authCtx.userId);
  sendSuccess(res, 200, user);
}

export async function getAccountStatusController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const user = await prisma.user.findUnique({
    where: { id: req.authCtx.userId },
    select: {
      id: true,
      role: true,
      status: true,
      restrictedReason: true,
    },
  });

  if (!user) {
    throw new UnauthorizedError("User not found", "UNAUTHENTICATED");
  }

  sendSuccess(res, 200, {
    status: user.status,
    role: user.role,
    restrictedReason: user.status === "RESTRICTED" ? user.restrictedReason : null,
  });
}

export async function deleteMeController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const result = await deleteCurrentUserAccount(req.authCtx.userId);
  sendSuccess(res, 200, result, "Account deleted successfully");
}
