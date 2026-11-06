import {
  listAccessRequestsQuerySchema,
  requestIdParamSchema,
  rejectAccessRequestBodySchema,
} from "../validators/registration.schema.js";
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
} from "../services/admin.service.js";
import type { Request, Response } from "express";
import {
  listUsersQuerySchema,
  userIdParamSchema,
  userSessionParamsSchema,
  listQuestSessionsQuerySchema,
  listLevelAttemptsQuerySchema,
  updateUserStatusParamsSchema,
  updateUserStatusBodySchema,
  userChildParamsSchema,
  userChildSessionParamsSchema,
  sessionIdParamSchema,
  listReportsQuerySchema,
  updateParentEmailBodySchema,
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
  getUserChildDetail,
  getUserChildQuestSessions,
  getUserChildQuestSessionDetail,
  getUserChildSessionAttempts,
  getUserChildSessionReport,
  getAdminQuestSessionDetail,
  adminRegenerateReport,
  adminGetReportPdf,
  listAllQuestReports,
  adminResendReportEmail,
  adminUpdateChildParentEmail,
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
    result.hasReport ? "Assessment report retrieved" : result.message
  );
}

export async function updateUserStatusController(req: Request, res: Response) {
  const adminId = getAdminUserId(req);
  const { id } = updateUserStatusParamsSchema.parse(req.params);
  const body = updateUserStatusBodySchema.parse(req.body);

  const updatedUser = await setUserStatus(adminId, id, body);
  sendSuccess(res, 200, updatedUser, "User status updated successfully");
}

export async function getUserChildDetailController(
  req: Request,
  res: Response
) {
  const { userId, childProfileId } = userChildParamsSchema.parse(req.params);
  const detail = await getUserChildDetail(userId, childProfileId);
  sendSuccess(res, 200, detail, "Child profile detail retrieved");
}

export async function getUserChildQuestSessionsController(
  req: Request,
  res: Response
) {
  const { userId, childProfileId } = userChildParamsSchema.parse(req.params);
  const query = listQuestSessionsQuerySchema.parse(req.query);
  const result = await getUserChildQuestSessions(userId, childProfileId, query);
  sendSuccess(res, 200, result.sessions, undefined, result.meta);
}

export async function getUserChildQuestSessionDetailController(
  req: Request,
  res: Response
) {
  const { userId, childProfileId, sessionId } =
    userChildSessionParamsSchema.parse(req.params);
  const detail = await getUserChildQuestSessionDetail(
    userId,
    childProfileId,
    sessionId
  );
  sendSuccess(res, 200, detail, "Child quest session detail retrieved");
}

export async function getUserChildSessionAttemptsController(
  req: Request,
  res: Response
) {
  const { userId, childProfileId, sessionId } =
    userChildSessionParamsSchema.parse(req.params);
  const query = listLevelAttemptsQuerySchema.parse(req.query);
  const result = await getUserChildSessionAttempts(
    userId,
    childProfileId,
    sessionId,
    query
  );
  sendSuccess(res, 200, result.attempts, undefined, result.meta);
}

export async function getUserChildSessionReportController(
  req: Request,
  res: Response
) {
  const { userId, childProfileId, sessionId } =
    userChildSessionParamsSchema.parse(req.params);
  const result = await getUserChildSessionReport(
    userId,
    childProfileId,
    sessionId
  );
  sendSuccess(
    res,
    200,
    result,
    result.hasReport ? "Assessment report retrieved" : result.message
  );
}

export async function getAdminQuestSessionDetailController(
  req: Request,
  res: Response
) {
  const { sessionId } = sessionIdParamSchema.parse(req.params);
  const detail = await getAdminQuestSessionDetail(sessionId);
  sendSuccess(res, 200, detail, "Quest session details retrieved");
}

export async function listAccessRequestsController(
  req: Request,
  res: Response
) {
  const query = listAccessRequestsQuerySchema.parse(req.query);
  const result = await listAccessRequests(query);
  sendSuccess(
    res,
    200,
    result.requests,
    "Access requests retrieved",
    result.meta
  );
}

export async function approveAccessRequestController(
  req: Request,
  res: Response
) {
  const adminId = getAdminUserId(req);
  const { requestId } = requestIdParamSchema.parse(req.params);

  const result = await approveAccessRequest(adminId, requestId);
  sendSuccess(res, 200, result, "Access request approved successfully");
}

export async function rejectAccessRequestController(
  req: Request,
  res: Response
) {
  const adminId = getAdminUserId(req);
  const { requestId } = requestIdParamSchema.parse(req.params);
  const body = rejectAccessRequestBodySchema.parse(req.body);

  const result = await rejectAccessRequest(adminId, requestId, body.reason);
  sendSuccess(res, 200, result, "Access request rejected successfully");
}

export async function adminRegenerateReportController(
  req: Request,
  res: Response
) {
  const { sessionId } = sessionIdParamSchema.parse(req.params);
  const report = await adminRegenerateReport(sessionId);
  sendSuccess(res, 200, report, "Quest report regenerated successfully");
}

export async function adminDownloadReportPdfController(
  req: Request,
  res: Response
) {
  const { sessionId } = sessionIdParamSchema.parse(req.params);
  const pdfBuffer = await adminGetReportPdf(sessionId);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="OrionKids-Admin-Report-${sessionId.slice(-6)}.pdf"`
  );
  res.setHeader("Content-Length", pdfBuffer.byteLength);
  res.status(200).send(Buffer.from(pdfBuffer));
}

export async function adminResendReportEmailController(
  req: Request,
  res: Response
) {
  const { sessionId } = sessionIdParamSchema.parse(req.params);
  const result = await adminResendReportEmail(sessionId);
  sendSuccess(res, 202, result, "Report email is being sent");
}

export async function adminUpdateChildParentEmailController(
  req: Request,
  res: Response
) {
  const adminId = getAdminUserId(req);
  const { userId, childProfileId } = userChildParamsSchema.parse(req.params);
  const { parentEmail } = updateParentEmailBodySchema.parse(req.body);
  const result = await adminUpdateChildParentEmail(
    adminId,
    userId,
    childProfileId,
    parentEmail
  );
  sendSuccess(res, 200, result, "Parent email updated successfully");
}

export async function adminListReportsController(req: Request, res: Response) {
  const query = listReportsQuerySchema.parse(req.query);
  const result = await listAllQuestReports(query);
  sendSuccess(
    res,
    200,
    result.reports,
    "Quest reports retrieved successfully",
    result.meta
  );
}

export async function getAdminSessionReportController(
  req: Request,
  res: Response
) {
  const { sessionId } = sessionIdParamSchema.parse(req.params);
  const detail = await getAdminQuestSessionDetail(sessionId);
  const result = await getUserSessionReport(detail.session.userId, sessionId);
  sendSuccess(
    res,
    200,
    result,
    result.hasReport ? "Assessment report retrieved" : result.message
  );
}
