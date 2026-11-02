import type { Request, Response } from "express";
import {
  acceptTermsBodySchema,
  submitAccessRequestBodySchema,
} from "../validators/registration.schema.js";
import {
  getRegistrationStatus,
  acceptUserTerms,
  submitUserAccessRequest,
  getMyAccessRequests,
} from "../services/registration.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

function getUserId(req: Request): string {
  if (!req.authCtx?.userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  return req.authCtx.userId;
}

export async function getRegistrationStatusController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const status = await getRegistrationStatus(userId);
  sendSuccess(res, 200, status, "Registration status retrieved successfully");
}

export async function acceptTermsController(req: Request, res: Response) {
  const userId = getUserId(req);
  const body = acceptTermsBodySchema.parse(req.body);

  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await acceptUserTerms(userId, body, { ipAddress, userAgent });
  sendSuccess(res, 200, result, "Terms accepted successfully");
}

export async function submitAccessRequestController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const body = submitAccessRequestBodySchema.parse(req.body);

  const result = await submitUserAccessRequest(userId, body);
  sendSuccess(res, 201, result, result.message);
}

export async function getMyAccessRequestController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const result = await getMyAccessRequests(userId);
  sendSuccess(res, 200, result, "Access request retrieved successfully");
}
