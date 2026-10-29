import type { Request, Response } from "express";
import { UnauthorizedError } from "../utils/errors.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  warmUpAnswersSchema,
  startLevelSchema,
  completeLevelSchema,
} from "../validators/quest.schema.js";
import {
  getOrCreateActiveSession,
  getCurrentSession,
  getSessionById,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  generateOrGetReport,
} from "../services/quest.service.js";

function getUserId(req: Request): string {
  if (!req.authCtx?.userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  return req.authCtx.userId;
}

function getParamString(param: string | string[] | undefined, name: string): string {
  if (!param || Array.isArray(param)) {
    throw new UnauthorizedError(`Missing or invalid ${name}`, "INVALID_PARAM");
  }
  return param;
}

export async function getOrCreateSessionController(req: Request, res: Response) {
  const userId = getUserId(req);
  const session = await getOrCreateActiveSession(userId);
  sendSuccess(res, 200, session, "Quest session initialized successfully");
}

export async function getCurrentSessionController(req: Request, res: Response) {
  const userId = getUserId(req);
  const session = await getCurrentSession(userId);
  sendSuccess(res, 200, session, "Current quest session retrieved");
}

export async function getSessionByIdController(req: Request, res: Response) {
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");
  const session = await getSessionById(userId, sessionId);
  sendSuccess(res, 200, session, "Quest session retrieved");
}

export async function submitWarmUpController(req: Request, res: Response) {
  const userId = getUserId(req);
  const rawSessionId = req.params.sessionId;
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
  const validated = warmUpAnswersSchema.parse(req.body);

  const result = await saveWarmUpSubmission(
    userId,
    sessionId,
    validated.answers,
    validated.completedAt
  );

  sendSuccess(res, 200, result, "Warm-up answers submitted successfully");
}

export async function startLevelController(req: Request, res: Response) {
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");
  const validated = startLevelSchema.parse(req.body);

  const result = await startLevelAttempt(
    userId,
    sessionId,
    validated.gameKey,
    validated.levelNumber
  );

  sendSuccess(res, 200, result, "Level attempt started");
}

export async function completeLevelController(req: Request, res: Response) {
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");
  const validated = completeLevelSchema.parse(req.body);

  const result = await completeLevelAttempt(userId, sessionId, validated);
  sendSuccess(res, 200, result, "Level attempt completed successfully");
}

export async function getReportController(req: Request, res: Response) {
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");

  const report = await generateOrGetReport(userId, sessionId);
  sendSuccess(res, 200, report, "Cognitive assessment report retrieved");
}

// Backward compatibility handlers for legacy frontend endpoints:
export async function legacyWarmUpSubmitController(req: Request, res: Response) {
  const userId = getUserId(req);
  const rawAnswers = req.body.answers || {};
  const completedAt = req.body.completedAt;
  const rawSessionId = typeof req.body.sessionId === "string" ? req.body.sessionId : undefined;

  const result = await saveWarmUpSubmission(
    userId,
    rawSessionId,
    rawAnswers,
    completedAt
  );

  sendSuccess(res, 200, result, "Warm-up answers saved successfully");
}

export async function legacyStroopLevelSubmitController(req: Request, res: Response) {
  const userId = getUserId(req);
  let sessionId = typeof req.body.sessionId === "string" ? req.body.sessionId : undefined;
  if (!sessionId) {
    const active = await getOrCreateActiveSession(userId);
    sessionId = active.id;
  }

  const result = await completeLevelAttempt(userId, sessionId, {
    gameKey: "stroop",
    levelNumber: req.body.level || 1,
    attemptNumber: 1,
    totalTrials: req.body.totalTrials,
    correctTrials: req.body.correctTrials,
    accuracy: req.body.accuracy,
    averageReactionTimeMs: req.body.averageReactionTimeMs,
    metrics: {
      totalTrials: req.body.totalTrials,
      correctTrials: req.body.correctTrials,
    },
    trialRecords: req.body.trials || [],
    completedAt: req.body.completedAt || new Date().toISOString(),
  });

  sendSuccess(res, 200, result, "Level progress saved successfully");
}
