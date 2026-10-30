import type { Request, Response } from "express";
import { UnauthorizedError } from "../utils/errors.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  warmUpAnswersSchema,
  startLevelSchema,
  completeLevelSchema,
  legacyStroopSubmitSchema,
  saveCheckpointSchema,
  createSessionSchema,
  GAME_ID_TO_KEY,
} from "../validators/quest.schema.js";
import {
  getOrCreateActiveSession,
  getCurrentSession,
  getSessionById,
  saveWarmUpSubmission,
  startLevelAttempt,
  completeLevelAttempt,
  generateOrGetReport,
  getResumeState,
  saveAttemptCheckpoint,
} from "../services/quest.service.js";

function getUserId(req: Request): string {
  if (!req.authCtx?.userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  return req.authCtx.userId;
}

function getParamString(
  param: string | string[] | undefined,
  name: string
): string {
  if (!param || Array.isArray(param)) {
    throw new UnauthorizedError(`Missing or invalid ${name}`, "INVALID_PARAM");
  }
  return param;
}

export async function getOrCreateSessionController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const rawChildId = req.body?.childProfileId || req.query?.childProfileId;
  const childProfileId =
    typeof rawChildId === "string" && rawChildId.trim().length > 0
      ? rawChildId.trim()
      : undefined;

  const session = await getOrCreateActiveSession(userId, childProfileId);
  sendSuccess(res, 200, session, "Quest session initialized successfully");
}

export async function getCurrentSessionController(req: Request, res: Response) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const userId = getUserId(req);
  const rawChildId = req.query?.childProfileId;
  const childProfileId =
    typeof rawChildId === "string" && rawChildId.trim().length > 0
      ? rawChildId.trim()
      : undefined;

  const session = await getCurrentSession(userId, childProfileId);
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

  let nextLevelRoute = `/report?sessionId=${sessionId}`;
  if (!result.isQuestComplete) {
    const nextGameKey = GAME_ID_TO_KEY[result.currentGame];
    if (nextGameKey) {
      nextLevelRoute = `/games/${nextGameKey}?level=${result.currentLevel}&sessionId=${sessionId}`;
    }
  }

  sendSuccess(
    res,
    200,
    { ...result, nextLevelRoute },
    "Level attempt completed successfully"
  );
}

export async function getReportController(req: Request, res: Response) {
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");

  const report = await generateOrGetReport(userId, sessionId);
  sendSuccess(res, 200, report, "Cognitive assessment report retrieved");
}

// Backward compatibility handlers for legacy frontend endpoints:
export async function legacyWarmUpSubmitController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const rawAnswers = req.body.answers || {};
  const completedAt = req.body.completedAt;
  const rawSessionId =
    typeof req.body.sessionId === "string" ? req.body.sessionId : undefined;

  const result = await saveWarmUpSubmission(
    userId,
    rawSessionId,
    rawAnswers,
    completedAt
  );

  sendSuccess(res, 200, result, "Warm-up answers saved successfully");
}

/**
 * Legacy endpoint: POST /api/games/stroop/level-submit
 *
 * Backward-compatibility endpoint called by the Stroop frontend.
 * Enforces strict progression validation, authentication, session ownership,
 * and genuine trial verification. Rejects future-level submissions without advancing
 * the session, ensures idempotent resubmissions, and returns server-authoritative state.
 */
export async function legacyStroopLevelSubmitController(
  req: Request,
  res: Response
) {
  const userId = getUserId(req);
  const validated = legacyStroopSubmitSchema.parse(req.body);

  const sessionId =
    validated.sessionId || (await getOrCreateActiveSession(userId)).id;

  const result = await completeLevelAttempt(userId, sessionId, {
    gameKey: "stroop",
    levelNumber: validated.level,
    attemptNumber: 1,
    totalTrials: validated.totalTrials,
    correctTrials: validated.correctTrials,
    accuracy: validated.accuracy,
    durationMs: validated.durationMs,
    averageReactionTimeMs: validated.averageReactionTimeMs,
    metrics: {
      totalTrials: validated.totalTrials,
      correctTrials: validated.correctTrials,
    },
    trialRecords: validated.trials || [],
    completedAt: validated.completedAt || new Date().toISOString(),
  });

  let nextLevelRoute = `/report?sessionId=${sessionId}`;
  if (!result.isQuestComplete) {
    const nextGameKey = GAME_ID_TO_KEY[result.currentGame];
    if (nextGameKey) {
      nextLevelRoute = `/games/${nextGameKey}?level=${result.currentLevel}&sessionId=${sessionId}`;
    } else {
      nextLevelRoute = `/report?sessionId=${sessionId}`;
    }
  }

  sendSuccess(
    res,
    200,
    {
      ...result,
      nextLevelRoute,
    },
    result.message || "Level progress saved successfully"
  );
}

export async function getResumeStateController(req: Request, res: Response) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const userId = getUserId(req);
  const rawChildId = req.query?.childProfileId;
  const childProfileId =
    typeof rawChildId === "string" && rawChildId.trim().length > 0
      ? rawChildId.trim()
      : undefined;

  const result = await getResumeState(userId, childProfileId);
  sendSuccess(res, 200, result, "Quest resume state retrieved successfully");
}

export async function saveCheckpointController(req: Request, res: Response) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const userId = getUserId(req);
  const sessionId = getParamString(req.params.sessionId, "sessionId");
  const attemptId = getParamString(req.params.attemptId, "attemptId");
  const validated = saveCheckpointSchema.parse(req.body);

  const result = await saveAttemptCheckpoint(
    userId,
    sessionId,
    attemptId,
    validated.checkpoint
  );
  sendSuccess(res, 200, result, "Level attempt checkpoint saved successfully");
}
