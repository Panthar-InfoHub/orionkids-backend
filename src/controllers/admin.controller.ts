import type { Request, Response } from "express";
import {
  listUsersQuerySchema,
  userIdParamSchema,
  userSessionParamsSchema,
  listQuestSessionsQuerySchema,
  listLevelAttemptsQuerySchema,
  updateUserStatusParamsSchema,
  updateUserStatusBodySchema,
} from "../validators/admin.schema.js";
import {
  getAdminOverview,
  listUsers,
  getUserDetail,
  getUserChildren,
  getUserQuestSessions,
  getUserQuestSessionDetail,
  getUserSessionAttempts,
  getUserSessionReport,
  setUserStatus,
} from "../services/admin.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

function getAdminUserId(req: Request): string {
  if (!req.authCtx?.userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  return req.authCtx.userId;
}

export async function getOverviewController(_req: Request, res: Response) {
  const overview = await getAdminOverview();
  sendSuccess(res, 200, overview, "Admin overview retrieved successfully");
}

export async function getUsersController(req: Request, res: Response) {
  const query = listUsersQuerySchema.parse(req.query);
  const result = await listUsers(query);
  sendSuccess(res, 200, result.users, undefined, result.meta);
}

export async function getUserDetailController(req: Request, res: Response) {
  const { userId } = userIdParamSchema.parse({
    userId: req.params.userId || req.params.id,
  });
  const detail = await getUserDetail(userId);
  sendSuccess(res, 200, detail, "User detail retrieved successfully");
}

export async function getUserChildrenController(req: Request, res: Response) {
  const { userId } = userIdParamSchema.parse({
    userId: req.params.userId || req.params.id,
  });
  const children = await getUserChildren(userId);
  sendSuccess(res, 200, children, "User child profiles retrieved");
}

export async function getUserQuestSessionsController(
  req: Request,
  res: Response
) {
  const { userId } = userIdParamSchema.parse({
    userId: req.params.userId || req.params.id,
  });
  const query = listQuestSessionsQuerySchema.parse(req.query);
  const result = await getUserQuestSessions(userId, query);
  sendSuccess(res, 200, result.sessions, undefined, result.meta);
}

export async function getUserQuestSessionDetailController(
  req: Request,
  res: Response
) {
  const { userId, sessionId } = userSessionParamsSchema.parse(req.params);
  const detail = await getUserQuestSessionDetail(userId, sessionId);
  sendSuccess(res, 200, detail, "Quest session details retrieved");
}

export async function getUserSessionAttemptsController(
  req: Request,
  res: Response
) {
  const { userId, sessionId } = userSessionParamsSchema.parse(req.params);
  const query = listLevelAttemptsQuerySchema.parse(req.query);
  const result = await getUserSessionAttempts(userId, sessionId, query);
  sendSuccess(res, 200, result.attempts, undefined, result.meta);
}

export async function getUserSessionReportController(
  req: Request,
  res: Response
) {
  const { userId, sessionId } = userSessionParamsSchema.parse(req.params);
  const result = await getUserSessionReport(userId, sessionId);
  sendSuccess(
    res,
    200,
    result,
    result.hasReport
      ? "Assessment report retrieved"
      : result.message
  );
}

export async function updateUserStatusController(req: Request, res: Response) {
  const adminId = getAdminUserId(req);
  const { id } = updateUserStatusParamsSchema.parse(req.params);
  const body = updateUserStatusBodySchema.parse(req.body);

  const updatedUser = await setUserStatus(adminId, id, body);
  sendSuccess(res, 200, updatedUser, "User status updated successfully");
}
