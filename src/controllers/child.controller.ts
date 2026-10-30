import type { Request, Response } from "express";
import { UnauthorizedError } from "../utils/errors.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  createChildSchema,
  updateChildSchema,
  childIdParamSchema,
} from "../validators/child.schema.js";
import {
  createChildProfile,
  listChildren,
  getChildProfile,
  updateChildProfile,
  getChildProgress,
  getChildQuestSessions,
  getChildReports,
} from "../services/child.service.js";

function getUserId(req: Request): string {
  if (!req.authCtx?.userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  return req.authCtx.userId;
}

export async function createChildController(req: Request, res: Response) {
  const userId = getUserId(req);
  const validated = createChildSchema.parse(req.body);
  const headerKey = req.headers["x-idempotency-key"];
  const idempotencyKey =
    typeof headerKey === "string" && headerKey.trim().length > 0
      ? headerKey.trim()
      : validated.idempotencyKey;

  const child = await createChildProfile(userId, validated, idempotencyKey);
  sendSuccess(res, 201, child, "Child profile created successfully");
}

export async function listChildrenController(req: Request, res: Response) {
  const userId = getUserId(req);
  const children = await listChildren(userId);
  sendSuccess(res, 200, children, "Child profiles retrieved successfully");
}

export async function getChildController(req: Request, res: Response) {
  const userId = getUserId(req);
  const { childId } = childIdParamSchema.parse(req.params);
  const child = await getChildProfile(userId, childId);
  sendSuccess(res, 200, child, "Child profile retrieved successfully");
}

export async function updateChildController(req: Request, res: Response) {
  const userId = getUserId(req);
  const { childId } = childIdParamSchema.parse(req.params);
  const validated = updateChildSchema.parse(req.body);
  const updated = await updateChildProfile(userId, childId, validated);
  sendSuccess(res, 200, updated, "Child profile updated successfully");
}

export async function getChildProgressController(req: Request, res: Response) {
  const userId = getUserId(req);
  const { childId } = childIdParamSchema.parse(req.params);
  const progress = await getChildProgress(userId, childId);
  sendSuccess(res, 200, progress, "Child progress summary retrieved successfully");
}

export async function getChildQuestSessionsController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const { childId } = childIdParamSchema.parse(req.params);
  const sessions = await getChildQuestSessions(userId, childId);
  sendSuccess(res, 200, sessions, "Child quest sessions retrieved successfully");
}

export async function getChildReportsController(req: Request, res: Response) {
  const userId = getUserId(req);
  const { childId } = childIdParamSchema.parse(req.params);
  const reports = await getChildReports(userId, childId);
  sendSuccess(res, 200, reports, "Child reports retrieved successfully");
}
