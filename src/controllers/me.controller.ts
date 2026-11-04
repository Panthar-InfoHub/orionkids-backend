import type { Request, Response } from "express";
import {
  getCurrentUserProfile,
  deleteCurrentUserAccount,
} from "../services/me.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function getMeController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const user = await getCurrentUserProfile(req.authCtx.userId);
  sendSuccess(res, 200, user);
}

export async function deleteMeController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const result = await deleteCurrentUserAccount(req.authCtx.userId);
  sendSuccess(res, 200, result, "Account deleted successfully");
}
