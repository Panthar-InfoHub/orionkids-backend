import { prisma, type Prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ErrorCodes,
} from "../utils/errors.js";
import { assertChildOwnership } from "../utils/ownership.js";
import {
  CANONICAL_GAMES,
  TOTAL_GAMES,
  LEVELS_PER_GAME,
  TOTAL_LEVELS,
} from "../config/games.js";
import type {
  GameKey,
  CompleteLevelInput,
} from "../validators/quest.schema.js";
import { GAME_KEY_TO_ID, GAME_ID_TO_KEY } from "../validators/quest.schema.js";
import {
  generateAiReport,
  generateRuleBasedReport,
  type GameplayReportInput,
  type AiStructuredReport,
} from "./aiReport.service.js";
import { generateReportPdf } from "./pdfReport.service.js";

/**
 * Helper to compute the authoritative progression stage from a session and its completed attempts.
 * Progression is strictly contiguous (Game 1 L1 -> L2 -> L3 -> Game 2 L1 -> ... -> Game 6 L3).
 */
export function computeSessionProgression(
  session: { currentGame: number; currentLevel: number; status: string },
  completedAttempts: Array<{
    gameKey: string;
    levelNumber: number;
    status?: string;
  }>
) {
  const completedIndices = new Set<number>();
  for (const a of completedAttempts) {
    if (!a.status || a.status === "COMPLETED") {
      const gId = GAME_KEY_TO_ID[a.gameKey as GameKey];
      if (gId) {
        completedIndices.add((gId - 1) * 3 + a.levelNumber);
      }
    }
  }

  // Find the highest contiguous completed level index (0 to 18)
  let highestContiguous = 0;
  for (let i = 1; i <= 18; i++) {
    if (completedIndices.has(i)) {
      highestContiguous = i;
    } else {
      break;
    }
  }

  const storedIndex = (session.currentGame - 1) * 3 + session.currentLevel;
  // Authorized index is at least (highestContiguous + 1)
  const authorizedIndex = Math.max(storedIndex, highestContiguous + 1);
  const isQuestComplete =
    session.status === "COMPLETED" || highestContiguous >= 18;

  if (isQuestComplete || authorizedIndex > 18) {
    return {
      currentGame: 6,
      currentLevel: 3,
      currentStage: "COMPLETED",
      isQuestComplete: true,
      authorizedIndex: 18,
      highestCompletedIndex: Math.min(18, highestContiguous),
      needsReconciliation: session.status !== "COMPLETED" || storedIndex < 18,
    };
  }

  const currentGame = Math.floor((authorizedIndex - 1) / 3) + 1;
  const currentLevel = ((authorizedIndex - 1) % 3) + 1;
  const currentStage = `GAME_${currentGame}_LEVEL_${currentLevel}`;

  return {
    currentGame,
    currentLevel,
    currentStage,
    isQuestComplete: false,
    authorizedIndex,
    highestCompletedIndex: highestContiguous,
    needsReconciliation: storedIndex < authorizedIndex,
  };
}

export async function getOrCreateActiveSession(
  userId: string,
  childProfileId?: string
) {
  let resolvedChildId = childProfileId;

  if (resolvedChildId) {
    await assertChildOwnership(userId, resolvedChildId);
  } else {
    // If no childProfileId is supplied, check if parent has exactly 1 child profile
    const children = await prisma.childProfile.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (children.length === 0) {
      throw new ValidationError(
        "Please create a child profile before starting a quest session",
        "CHILD_PROFILE_REQUIRED"
      );
    }
    if (children.length === 1 && children[0]) {
      resolvedChildId = children[0].id;
    } else {
      throw new ValidationError(
        "Parent has multiple children. Please specify childProfileId.",
        "AMBIGUOUS_CHILD_PROFILE"
      );
    }
  }

  const where = {
    userId,
    childProfileId: resolvedChildId,
    status: "IN_PROGRESS" as const,
  };

  // Check if there is an in-progress session
  let session = await prisma.questSession.findFirst({
    where,
    include: {
      childProfile: true,
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          completedAt: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  if (!session) {
    try {
      session = await prisma.questSession.create({
        data: {
          userId,
          childProfileId: resolvedChildId,
          status: "IN_PROGRESS",
          currentStage: "WARM_UP",
          currentGame: 1,
          currentLevel: 1,
        },
        include: {
          childProfile: true,
          warmUpSubmission: true,
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: {
              id: true,
              gameKey: true,
              levelNumber: true,
              accuracy: true,
              durationMs: true,
              averageReactionTimeMs: true,
              completedAt: true,
            },
          },
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        session = await prisma.questSession.findFirst({
          where: {
            userId,
            ...(resolvedChildId ? { childProfileId: resolvedChildId } : {}),
            status: "IN_PROGRESS",
          },
          include: {
            childProfile: true,
            warmUpSubmission: true,
            levelAttempts: {
              where: { status: "COMPLETED" },
              select: {
                id: true,
                gameKey: true,
                levelNumber: true,
                accuracy: true,
                durationMs: true,
                averageReactionTimeMs: true,
                completedAt: true,
              },
            },
          },
          orderBy: { startedAt: "desc" },
        });
      }
      if (!session) throw err;
    }
  }

  // Reconcile progression if drifted behind completed attempts
  const prog = computeSessionProgression(session, session.levelAttempts);
  if (prog.needsReconciliation) {
    session = await prisma.questSession.update({
      where: { id: session.id },
      data: {
        currentGame: prog.currentGame,
        currentLevel: prog.currentLevel,
        currentStage: prog.currentStage,
        status: prog.isQuestComplete ? "COMPLETED" : "IN_PROGRESS",
        lastActivityAt: new Date(),
      },
      include: {
        childProfile: true,
        warmUpSubmission: true,
        levelAttempts: {
          where: { status: "COMPLETED" },
          select: {
            id: true,
            gameKey: true,
            levelNumber: true,
            accuracy: true,
            durationMs: true,
            averageReactionTimeMs: true,
            completedAt: true,
          },
        },
      },
    });
  }

  logger.info(
    {
      sessionId: session.id,
      childProfileId: resolvedChildId,
      currentStage: session.currentStage,
      currentGame: session.currentGame,
      currentLevel: session.currentLevel,
      status: session.status,
    },
    "quest.session_retrieved_or_created"
  );

  return formatSessionResponse(session);
}

export async function getCurrentSession(
  userId: string,
  childProfileId?: string
) {
  const whereInProgress: Prisma.QuestSessionWhereInput = {
    userId,
    status: "IN_PROGRESS",
  };
  const whereCompleted: Prisma.QuestSessionWhereInput = {
    userId,
    status: "COMPLETED",
  };

  if (childProfileId) {
    await assertChildOwnership(userId, childProfileId);
    whereInProgress.childProfileId = childProfileId;
    whereCompleted.childProfileId = childProfileId;
  }

  // 1. Check in-progress session
  const activeSession = await prisma.questSession.findFirst({
    where: whereInProgress,
    include: {
      childProfile: true,
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          completedAt: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  if (activeSession) {
    const prog = computeSessionProgression(
      activeSession,
      activeSession.levelAttempts
    );
    if (prog.needsReconciliation) {
      const reconciled = await prisma.questSession.update({
        where: { id: activeSession.id },
        data: {
          currentGame: prog.currentGame,
          currentLevel: prog.currentLevel,
          currentStage: prog.currentStage,
          status: prog.isQuestComplete ? "COMPLETED" : "IN_PROGRESS",
          lastActivityAt: new Date(),
        },
        include: {
          childProfile: true,
          warmUpSubmission: true,
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: {
              id: true,
              gameKey: true,
              levelNumber: true,
              accuracy: true,
              durationMs: true,
              averageReactionTimeMs: true,
              completedAt: true,
            },
          },
        },
      });
      return formatSessionResponse(reconciled);
    }
    return formatSessionResponse(activeSession);
  }

  // 2. Otherwise get most recent completed session
  const latestCompleted = await prisma.questSession.findFirst({
    where: whereCompleted,
    include: {
      childProfile: true,
      warmUpSubmission: true,
      questReport: {
        select: {
          id: true,
          overallAccuracy: true,
          totalDurationMs: true,
          generatedAt: true,
        },
      },
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          completedAt: true,
        },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  if (latestCompleted) {
    return formatSessionResponse(latestCompleted);
  }

  return null;
}

export async function getSessionById(userId: string, sessionId: string) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    include: {
      childProfile: true,
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          completedAt: true,
        },
      },
      questReport: true,
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  logger.info(
    {
      sessionId: session.id,
      childProfileId: session.childProfileId,
      currentStage: session.currentStage,
      status: session.status,
    },
    "quest.session_retrieved_by_id"
  );

  return formatSessionResponse(session);
}

export async function saveWarmUpSubmission(
  userId: string,
  sessionId?: string,
  answers?: Record<string, string>,
  completedAt?: string,
  childProfileId?: string
) {
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    const active = await getOrCreateActiveSession(userId, childProfileId);
    targetSessionId = active.id;
  }

  const session = await prisma.questSession.findUnique({
    where: { id: targetSessionId },
    include: {
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        select: { id: true },
      },
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session", "FORBIDDEN");
  }

  if (session.status !== "IN_PROGRESS") {
    throw new ConflictError(
      "This quest session is already completed or abandoned",
      "SESSION_CLOSED"
    );
  }

  // Issue #13: Prevent warm-up submission from resetting existing quest progress
  if (session.warmUpSubmission) {
    const hasProgressed =
      session.currentStage !== "WARM_UP" || session.levelAttempts.length > 0;
    if (hasProgressed) {
      throw new ConflictError(
        "Warm-up questionnaire has already been completed and quest progression has started.",
        "WARMUP_ALREADY_COMPLETED"
      );
    }
  }

  const validAnswers = answers || {};

  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.warmUpSubmission.upsert({
      where: { questSessionId: targetSessionId! },
      create: {
        questSessionId: targetSessionId!,
        userId,
        answers: validAnswers,
        completedAt: completedAt ? new Date(completedAt) : new Date(),
      },
      update: {
        answers: validAnswers,
        completedAt: completedAt ? new Date(completedAt) : new Date(),
      },
    });

    const updatedSession = await tx.questSession.update({
      where: { id: targetSessionId! },
      data: {
        ...(session.currentStage === "WARM_UP"
          ? {
              currentStage: "GAME_1_LEVEL_1",
              currentGame: 1,
              currentLevel: 1,
            }
          : {}),
        lastActivityAt: new Date(),
      },
    });

    return { submission, session: updatedSession };
  });

  logger.info(
    {
      sessionId: result.session.id,
      currentStage: result.session.currentStage,
      nextGameRoute: `/games/stroop?level=1&sessionId=${result.session.id}`,
    },
    "quest.warm_up_completed"
  );

  return {
    success: true,
    sessionId: result.session.id,
    currentStage: result.session.currentStage,
    nextGameRoute: `/games/stroop?level=1&sessionId=${result.session.id}`,
  };
}

export async function startLevelAttempt(
  userId: string,
  sessionId: string,
  gameKey: GameKey,
  levelNumber: number,
  options?: {
    idempotencyKey?: string;
    isReplay?: boolean;
  }
) {
  const requestedGameId = GAME_KEY_TO_ID[gameKey];
  if (!requestedGameId) {
    throw new ValidationError("Invalid game key");
  }
  const requestedOverallIndex = (requestedGameId - 1) * 3 + levelNumber;
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  const isReplay = Boolean(options?.isReplay);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Concurrency lock: serialize concurrent level-start operations on the same quest session
    await tx.$queryRaw`SELECT id FROM quest_session WHERE id = ${sessionId} FOR UPDATE`;

    const session = await tx.questSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        status: true,
        currentGame: true,
        currentLevel: true,
        currentStage: true,
        warmUpSubmission: { select: { id: true } },
        levelAttempts: {
          orderBy: [{ startedAt: "asc" }, { attemptNumber: "asc" }],
          select: {
            id: true,
            gameId: true,
            gameKey: true,
            levelNumber: true,
            attemptNumber: true,
            status: true,
            metrics: true,
            startedAt: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundError("Quest session not found");
    }

    if (session.userId !== userId) {
      throw new ForbiddenError("You do not own this quest session");
    }

    if (session.status !== "IN_PROGRESS") {
      throw new ValidationError("Quest session is already closed");
    }

    if (!session.warmUpSubmission) {
      throw new ValidationError(
        "Warm-up questionnaire must be completed before starting levels"
      );
    }

    // Authoritative progression calculation
    const completedAttempts = session.levelAttempts.filter(
      (a) => a.status === "COMPLETED"
    );
    let currentSession = session;
    const prog = computeSessionProgression(session, completedAttempts);
    if (prog.needsReconciliation) {
      currentSession = await tx.questSession.update({
        where: { id: sessionId },
        data: {
          currentGame: prog.currentGame,
          currentLevel: prog.currentLevel,
          currentStage: prog.currentStage,
          status: prog.isQuestComplete ? "COMPLETED" : "IN_PROGRESS",
          completedAt: prog.isQuestComplete ? new Date() : null,
          lastActivityAt: new Date(),
        },
        select: {
          id: true,
          userId: true,
          status: true,
          currentGame: true,
          currentLevel: true,
          currentStage: true,
          warmUpSubmission: { select: { id: true } },
          levelAttempts: {
            orderBy: [{ startedAt: "asc" }, { attemptNumber: "asc" }],
            select: {
              id: true,
              gameId: true,
              gameKey: true,
              levelNumber: true,
              attemptNumber: true,
              status: true,
              metrics: true,
              startedAt: true,
            },
          },
        },
      });
    }

    if (currentSession.status === "COMPLETED" || prog.isQuestComplete) {
      throw new ConflictError(
        "Quest session is already completed",
        "SESSION_CLOSED"
      );
    }

    const authorizedOverallIndex =
      (currentSession.currentGame - 1) * 3 + currentSession.currentLevel;

    // Reject skipping forward beyond authorized stage
    if (requestedOverallIndex > authorizedOverallIndex) {
      logger.warn(
        {
          sessionId,
          gameKey,
          levelNumber,
          authorizedGame: currentSession.currentGame,
          authorizedLevel: currentSession.currentLevel,
        },
        "quest.level_locked_access_rejected"
      );
      throw new ForbiddenError(
        `Level progression violation: Game ${requestedGameId} Level ${levelNumber} is locked. You are on Game ${currentSession.currentGame} Level ${currentSession.currentLevel}.`
      );
    }

    const existingLevelAttempts = session.levelAttempts.filter(
      (a) => a.gameKey === gameKey && a.levelNumber === levelNumber
    );

    // 2. If client supplied an idempotencyKey, return the exact attempt matching it
    if (idempotencyKey) {
      const matchByKey = existingLevelAttempts.find(
        (a) => (a.metrics as any)?.idempotencyKey === idempotencyKey
      );
      if (matchByKey) {
        return {
          attemptId: matchByKey.id,
          sessionId: session.id,
          gameKey,
          levelNumber,
          status: matchByKey.status,
          attemptNumber: matchByKey.attemptNumber,
        };
      }
    }

    // 3. Return existing active IN_PROGRESS attempt if one already exists
    const activeAttempt = existingLevelAttempts.find(
      (a) => a.status === "IN_PROGRESS"
    );

    if (activeAttempt) {
      if (idempotencyKey && !(activeAttempt.metrics as any)?.idempotencyKey) {
        await tx.levelAttempt.update({
          where: { id: activeAttempt.id },
          data: {
            metrics: {
              ...((activeAttempt.metrics as Record<string, any>) || {}),
              idempotencyKey,
            },
          },
        });
      }

      return {
        attemptId: activeAttempt.id,
        sessionId: session.id,
        gameKey,
        levelNumber,
        status: activeAttempt.status,
        attemptNumber: activeAttempt.attemptNumber,
      };
    }

    // 4. Completed level handling:
    // If level is already completed in this session and NOT an intentional replay, return completed attempt
    const completedAttempt = [...existingLevelAttempts]
      .reverse()
      .find((a) => a.status === "COMPLETED");

    if (completedAttempt && !isReplay) {
      return {
        attemptId: completedAttempt.id,
        sessionId: session.id,
        gameKey,
        levelNumber,
        status: completedAttempt.status,
        attemptNumber: completedAttempt.attemptNumber,
      };
    }

    // 5. Create new attempt (initial entry or intentional replay)
    const nextAttemptNumber =
      existingLevelAttempts.length > 0
        ? Math.max(...existingLevelAttempts.map((a) => a.attemptNumber)) + 1
        : 1;

    const initialMetrics: Record<string, any> = {};
    if (idempotencyKey) {
      initialMetrics.idempotencyKey = idempotencyKey;
    }
    if (isReplay) {
      initialMetrics.isReplay = true;
    }

    let created;
    try {
      created = await tx.levelAttempt.create({
        data: {
          questSessionId: sessionId,
          userId,
          gameId: requestedGameId,
          gameKey,
          levelNumber,
          attemptNumber: nextAttemptNumber,
          status: "IN_PROGRESS",
          metrics: initialMetrics,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Race condition / duplicate attempt start: return existing concurrent attempt
        const existingConcurrent = await tx.levelAttempt.findFirst({
          where: {
            questSessionId: sessionId,
            gameKey,
            levelNumber,
          },
          orderBy: { attemptNumber: "desc" },
        });
        if (existingConcurrent) {
          return {
            attemptId: existingConcurrent.id,
            sessionId: session.id,
            gameKey,
            levelNumber,
            status: existingConcurrent.status,
            attemptNumber: existingConcurrent.attemptNumber,
          };
        }
      }
      throw err;
    }

    return {
      attemptId: created.id,
      sessionId: session.id,
      gameKey,
      levelNumber,
      status: created.status,
      attemptNumber: created.attemptNumber,
    };
  });

  logger.info(
    {
      sessionId,
      gameKey,
      levelNumber,
      attemptId: result.attemptId,
      attemptNumber: result.attemptNumber,
      isReplay,
    },
    "quest.level_attempt_started"
  );

  return result;
}

export async function completeLevelAttempt(
  userId: string,
  sessionId: string,
  input: CompleteLevelInput
) {
  // Reject placeholder/synthetic completion
  if (input.totalTrials !== undefined && input.totalTrials <= 0) {
    throw new ValidationError(
      "Level completion requires genuine gameplay trials (totalTrials must be greater than 0)"
    );
  }
  if (
    input.metrics &&
    ((input.metrics as any).autoAdvanced ||
      (input.metrics as any).skippedByFrontend)
  ) {
    throw new ValidationError(
      "Automatic or placeholder level completion is not permitted"
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const currentSession = await tx.questSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          status: true,
          currentStage: true,
          currentGame: true,
          currentLevel: true,
          warmUpSubmission: { select: { id: true } },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: { id: true, gameKey: true, levelNumber: true },
          },
        },
      });

      if (!currentSession) {
        throw new NotFoundError("Quest session not found");
      }

      if (currentSession.userId !== userId) {
        throw new ForbiddenError("You do not own this quest session");
      }

      const requestedGameId = GAME_KEY_TO_ID[input.gameKey];
      const requestedIndex = (requestedGameId - 1) * 3 + input.levelNumber;

      // Compute progression from current session and its completed attempts
      const prog = computeSessionProgression(
        currentSession,
        currentSession.levelAttempts
      );

      const existingCompleted = currentSession.levelAttempts.find(
        (a) =>
          a.gameKey === input.gameKey && a.levelNumber === input.levelNumber
      );

      // Closed session handling
      if (currentSession.status !== "IN_PROGRESS" || prog.isQuestComplete) {
        if (existingCompleted) {
          return {
            success: true,
            message: "Level was already recorded",
            levelAttemptId: existingCompleted.id,
            sessionId: currentSession.id,
            nextStage: "COMPLETED",
            currentGame: 6,
            currentLevel: 3,
            isQuestComplete: true,
          };
        }
        throw new ValidationError("Quest session is closed");
      }

      if (!currentSession.warmUpSubmission) {
        throw new ValidationError(
          "Warm-up questionnaire must be completed before completing levels"
        );
      }

      // Progression check: reject submitting levels beyond authorized stage
      if (requestedIndex > prog.authorizedIndex) {
        throw new ForbiddenError(
          `Level progression violation: Game ${requestedGameId} Level ${input.levelNumber} is locked. You are on Game ${prog.currentGame} Level ${prog.currentLevel}.`
        );
      }

      // Check if there is an active in-progress attempt for this level
      let activeAttempt = await tx.levelAttempt.findFirst({
        where: {
          questSessionId: sessionId,
          gameKey: input.gameKey,
          levelNumber: input.levelNumber,
          status: "IN_PROGRESS",
        },
        orderBy: { attemptNumber: "desc" },
      });

      const completedAt = new Date();
      const computedAccuracy =
        typeof input.totalTrials === "number" &&
        input.totalTrials > 0 &&
        typeof input.correctTrials === "number"
          ? Math.round((input.correctTrials / input.totalTrials) * 100)
          : (input.accuracy ?? null);
      const serverDurationMs = activeAttempt?.startedAt
        ? Math.max(
            0,
            completedAt.getTime() - new Date(activeAttempt.startedAt).getTime()
          )
        : (input.durationMs ?? null);

      // 1. Idempotent Retry: Level is ALREADY completed
      if (existingCompleted) {
        if (activeAttempt) {
          await tx.levelAttempt.update({
            where: { id: activeAttempt.id },
            data: {
              status: "COMPLETED",
              totalTrials: input.totalTrials ?? null,
              correctTrials: input.correctTrials ?? null,
              accuracy: computedAccuracy,
              durationMs: serverDurationMs,
              averageReactionTimeMs: input.averageReactionTimeMs ?? null,
              metrics: input.metrics || {},
              trialRecords: input.trialRecords || [],
              completedAt,
            },
          });
        }

        // Clean up / abandon any duplicate IN_PROGRESS attempts for this level
        await tx.levelAttempt.updateMany({
          where: {
            questSessionId: sessionId,
            gameKey: input.gameKey,
            levelNumber: input.levelNumber,
            status: "IN_PROGRESS",
            id: { not: activeAttempt?.id || existingCompleted.id },
          },
          data: { status: "ABANDONED" },
        });

        // Reconcile session if it had not yet advanced to the next level
        let nextGame = prog.currentGame;
        let nextLevel = prog.currentLevel;
        let nextStage = prog.currentStage;
        let isQuestFinished: boolean = prog.isQuestComplete;

        if (requestedIndex >= prog.authorizedIndex) {
          const newHighest = Math.max(
            prog.highestCompletedIndex,
            requestedIndex
          );
          if (newHighest >= 18) {
            nextGame = 6;
            nextLevel = 3;
            nextStage = "COMPLETED";
            isQuestFinished = true;
          } else {
            const nextIndex = newHighest + 1;
            nextGame = Math.floor((nextIndex - 1) / 3) + 1;
            nextLevel = ((nextIndex - 1) % 3) + 1;
            nextStage = `GAME_${nextGame}_LEVEL_${nextLevel}`;
          }

          await tx.questSession.update({
            where: { id: sessionId },
            data: {
              currentGame: nextGame,
              currentLevel: nextLevel,
              currentStage: nextStage,
              status: isQuestFinished ? "COMPLETED" : "IN_PROGRESS",
              completedAt: isQuestFinished ? new Date() : null,
              lastActivityAt: new Date(),
            },
          });
        }

        return {
          success: true,
          message: "Level was already recorded",
          levelAttemptId: activeAttempt?.id || existingCompleted.id,
          sessionId: currentSession.id,
          nextStage,
          currentGame: nextGame,
          currentLevel: nextLevel,
          isQuestComplete: isQuestFinished,
        };
      }

      // 2. First completion of this level:
      // Progression calculation: Determine next stage monotonically based on highest completed level.
      const newHighest = Math.max(prog.highestCompletedIndex, requestedIndex);
      let nextGame: number;
      let nextLevel: number;
      let nextStage: string;
      let isQuestFinished = false;

      if (newHighest >= TOTAL_LEVELS) {
        nextGame = TOTAL_GAMES;
        nextLevel = LEVELS_PER_GAME;
        nextStage = "COMPLETED";
        isQuestFinished = true;
      } else {
        const nextIndex = newHighest + 1;
        nextGame = Math.floor((nextIndex - 1) / LEVELS_PER_GAME) + 1;
        nextLevel = ((nextIndex - 1) % LEVELS_PER_GAME) + 1;
        nextStage = `GAME_${nextGame}_LEVEL_${nextLevel}`;
      }

      if (requestedIndex === prog.authorizedIndex) {
        const advanceResult = await tx.questSession.updateMany({
          where: {
            id: sessionId,
            currentGame: currentSession.currentGame,
            currentLevel: currentSession.currentLevel,
            status: "IN_PROGRESS",
          },
          data: {
            currentGame: nextGame,
            currentLevel: nextLevel,
            currentStage: nextStage,
            status: isQuestFinished ? "COMPLETED" : "IN_PROGRESS",
            completedAt: isQuestFinished ? new Date() : null,
            lastActivityAt: new Date(),
          },
        });

        // Another concurrent request already won and advanced this stage
        if (advanceResult.count === 0) {
          const fresh = await tx.questSession.findUnique({
            where: { id: sessionId },
            include: {
              levelAttempts: {
                where: {
                  gameKey: input.gameKey,
                  levelNumber: input.levelNumber,
                  status: "COMPLETED",
                },
              },
            },
          });
          const existing = fresh?.levelAttempts[0];
          return {
            success: true,
            message: "Level was already recorded",
            levelAttemptId: existing?.id || "idempotent",
            sessionId,
            nextStage: fresh?.currentStage || nextStage,
            currentGame: fresh?.currentGame || nextGame,
            currentLevel: fresh?.currentLevel || nextLevel,
            isQuestComplete: fresh?.status === "COMPLETED",
          };
        }
      } else {
        // Progression is strictly monotonic: completing an earlier level never regresses stored stage (Issue #27)
        const storedIndex =
          (currentSession.currentGame - 1) * 3 + currentSession.currentLevel;
        const targetIndex = Math.max(storedIndex, newHighest + 1);
        let targetGame = currentSession.currentGame;
        let targetLevel = currentSession.currentLevel;
        let targetStage = currentSession.currentStage;
        let questFinished = isQuestFinished;

        if (targetIndex >= 18 && newHighest >= 18) {
          targetGame = 6;
          targetLevel = 3;
          targetStage = "COMPLETED";
          questFinished = true;
        } else if (targetIndex > storedIndex) {
          targetGame = Math.floor((targetIndex - 1) / 3) + 1;
          targetLevel = ((targetIndex - 1) % 3) + 1;
          targetStage = `GAME_${targetGame}_LEVEL_${targetLevel}`;
        }

        await tx.questSession.update({
          where: { id: sessionId },
          data: {
            currentGame: targetGame,
            currentLevel: targetLevel,
            currentStage: targetStage,
            status: questFinished ? "COMPLETED" : "IN_PROGRESS",
            completedAt: questFinished ? new Date() : null,
            lastActivityAt: new Date(),
          },
        });
        nextGame = targetGame;
        nextLevel = targetLevel;
        nextStage = targetStage;
        isQuestFinished = questFinished;
      }

      // Persist the completed attempt
      let finalAttemptId: string;
      if (activeAttempt) {
        const updated = await tx.levelAttempt.update({
          where: { id: activeAttempt.id },
          data: {
            status: "COMPLETED",
            totalTrials: input.totalTrials ?? null,
            correctTrials: input.correctTrials ?? null,
            accuracy: computedAccuracy,
            durationMs: serverDurationMs,
            averageReactionTimeMs: input.averageReactionTimeMs ?? null,
            metrics: input.metrics || {},
            trialRecords: input.trialRecords || [],
            completedAt,
          },
        });
        finalAttemptId = updated.id;
      } else {
        const existingCount = await tx.levelAttempt.count({
          where: {
            questSessionId: sessionId,
            gameKey: input.gameKey,
            levelNumber: input.levelNumber,
          },
        });
        const created = await tx.levelAttempt.create({
          data: {
            questSessionId: sessionId,
            userId,
            gameId: requestedGameId,
            gameKey: input.gameKey,
            levelNumber: input.levelNumber,
            attemptNumber: existingCount + 1,
            status: "COMPLETED",
            totalTrials: input.totalTrials ?? null,
            correctTrials: input.correctTrials ?? null,
            accuracy: computedAccuracy,
            durationMs: serverDurationMs,
            averageReactionTimeMs: input.averageReactionTimeMs ?? null,
            metrics: input.metrics || {},
            trialRecords: input.trialRecords || [],
            completedAt,
          },
        });
        finalAttemptId = created.id;
      }

      // Mark any other IN_PROGRESS attempt for this level as ABANDONED
      await tx.levelAttempt.updateMany({
        where: {
          questSessionId: sessionId,
          gameKey: input.gameKey,
          levelNumber: input.levelNumber,
          status: "IN_PROGRESS",
          id: { not: finalAttemptId },
        },
        data: { status: "ABANDONED" },
      });

      // If quest finished, mark ALL remaining IN_PROGRESS attempts in this session as ABANDONED
      if (isQuestFinished) {
        await tx.levelAttempt.updateMany({
          where: {
            questSessionId: sessionId,
            status: "IN_PROGRESS",
          },
          data: { status: "ABANDONED" },
        });
      }

      return {
        success: true,
        message: "Level attempt completed and recorded",
        levelAttemptId: finalAttemptId,
        sessionId,
        nextStage,
        currentGame: nextGame,
        currentLevel: nextLevel,
        isQuestComplete: isQuestFinished,
      };
    },
    {
      maxWait: 15000,
      timeout: 25000,
    }
  );

  logger.info(
    {
      sessionId,
      gameKey: input.gameKey,
      levelNumber: input.levelNumber,
      levelAttemptId: result.levelAttemptId,
      accuracy: input.accuracy,
      durationMs: input.durationMs,
      nextStage: result.nextStage,
      isQuestComplete: result.isQuestComplete,
    },
    result.isQuestComplete
      ? "quest.session_completed"
      : "quest.level_attempt_completed"
  );

  return result;
}

export async function generateOrGetReport(
  userId: string,
  sessionId: string,
  forceRegenerate = false,
  isAdmin = false
) {
  // Fast path: if report is already stored and not forced, return it immediately without fetching attempt records
  const existingReport = await prisma.questReport.findUnique({
    where: { questSessionId: sessionId },
  });

  if (existingReport && !forceRegenerate) {
    if (!isAdmin && existingReport.userId !== userId) {
      throw new ForbiddenError("You do not own this quest session");
    }
    logger.info(
      {
        sessionId,
        reportId: existingReport.id,
        modelName: existingReport.modelName,
      },
      "quest.report_cache_hit"
    );
    return existingReport;
  }

  // Authoritative path: generate report from authoritative database records
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      status: true,
      currentGame: true,
      currentLevel: true,
      startedAt: true,
      completedAt: true,
      childProfileId: true,
      childProfile: {
        select: {
          id: true,
          childName: true,
          age: true,
          selectedClass: true,
          school: true,
        },
      },
      warmUpSubmission: {
        select: { answers: true },
      },
      levelAttempts: {
        where: { status: "COMPLETED" },
        orderBy: [
          { gameId: "asc" },
          { levelNumber: "asc" },
          { attemptNumber: "desc" },
        ],
        select: {
          id: true,
          gameId: true,
          gameKey: true,
          levelNumber: true,
          attemptNumber: true,
          status: true,
          totalTrials: true,
          correctTrials: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          metrics: true,
          completedAt: true,
        },
      },
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (!isAdmin && session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  if (session.status !== "COMPLETED") {
    throw new ValidationError(
      `Quest session is in progress (Game ${session.currentGame}, Level ${session.currentLevel}). All 18 levels must be completed before generating a final report.`
    );
  }

  // Refuse report generation for a session without an assigned child profile (Issue #8)
  if (!session.childProfileId || !session.childProfile) {
    throw new ConflictError(
      "Cannot generate a report for a quest session without an assigned child profile.",
      "CHILD_PROFILE_REQUIRED"
    );
  }

  const childProfile = session.childProfile;
  const childName = childProfile.childName;
  const age = childProfile.age;
  const selectedClass = childProfile.selectedClass;
  const school = childProfile.school || null;

  // Exclude synthetic/autoAdvanced/zero-trial/skipped attempts from genuine completion metrics (Issue #11)
  const isGenuineAttempt = (a: (typeof session.levelAttempts)[number]) => {
    if (typeof a.totalTrials !== "number" || a.totalTrials <= 0) return false;
    if (typeof a.correctTrials !== "number" || a.correctTrials < 0)
      return false;
    if (a.metrics && typeof a.metrics === "object") {
      const metricsObj = a.metrics as Record<string, unknown>;
      for (const k of Object.keys(metricsObj)) {
        if (k.startsWith("skipped") && Boolean(metricsObj[k])) {
          return false;
        }
      }
      if (Boolean(metricsObj.autoAdvanced)) return false;
    }
    return true;
  };

  const rawAttempts = session.levelAttempts.filter(isGenuineAttempt);

  // Deduplicate by gameId-levelNumber using deterministic ordering:
  // latest completedAt, then attemptNumber as tiebreaker (Issue #35)
  const dedupedMap = new Map<string, (typeof rawAttempts)[0]>();
  for (const att of rawAttempts) {
    const key = `${att.gameId}-${att.levelNumber}`;
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, att);
    } else {
      const existingTime = existing.completedAt
        ? new Date(existing.completedAt).getTime()
        : 0;
      const attTime = att.completedAt ? new Date(att.completedAt).getTime() : 0;
      if (attTime !== existingTime) {
        if (attTime > existingTime) {
          dedupedMap.set(key, att);
        }
      } else if (att.attemptNumber > existing.attemptNumber) {
        dedupedMap.set(key, att);
      }
    }
  }

  const attempts = Array.from(dedupedMap.values());
  const totalLevelsCompleted = attempts.length;

  const totalDurationMs = attempts.reduce(
    (acc, cur) => acc + (cur.durationMs || 0),
    0
  );

  const accuracyValues = attempts
    .map((a) => a.accuracy)
    .filter((v): v is number => typeof v === "number");

  const overallAccuracy =
    accuracyValues.length > 0
      ? Math.round(
          (accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length) *
            10
        ) / 10
      : 0;

  const gameSummaries: Record<string, any> = {};
  for (let g = 1; g <= 6; g++) {
    const key = GAME_ID_TO_KEY[g] as string;
    const gameAttempts = attempts.filter((a) => a.gameId === g);
    const gameAccs = gameAttempts
      .map((a) => a.accuracy)
      .filter((v): v is number => typeof v === "number");
    const avgGameAcc =
      gameAccs.length > 0
        ? Math.round(gameAccs.reduce((a, b) => a + b, 0) / gameAccs.length)
        : null;

    const rts = gameAttempts
      .map((a) => a.averageReactionTimeMs)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const avgRT =
      rts.length > 0
        ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length)
        : null;

    gameSummaries[key] = {
      gameId: g,
      gameKey: key,
      levelsCompleted: gameAttempts.length,
      averageAccuracy: avgGameAcc,
      averageReactionTimeMs: avgRT,
    };
  }

  const warmUpAnswers =
    (session.warmUpSubmission?.answers as Record<string, string>) || {};
  const copingStrategy = warmUpAnswers["2"] || null;
  const learningStyle = warmUpAnswers["3"] || null;
  const favoriteSubject = warmUpAnswers["4"] || null;
  const emotionalState = warmUpAnswers["6"] || null;

  const summaryNote =
    overallAccuracy >= 85
      ? `Demonstrated outstanding focus and accuracy (${overallAccuracy}%) with consistent performance across evaluated cognitive challenges.`
      : overallAccuracy >= 60
        ? `Demonstrated steady focus, positive persistence, and an adaptable problem-solving approach (${overallAccuracy}% accuracy) throughout the cognitive exploration journey.`
        : `Engaged actively across levels, showing notable persistence while working through challenging tasks (${overallAccuracy}% accuracy).`;

  const growthObservations = {
    copingStrategy,
    learningStyle,
    favoriteSubject,
    emotionalState,
    overallEngagement:
      totalLevelsCompleted >= 18
        ? "Full 18-Level Completion"
        : `${totalLevelsCompleted}/18 Levels Evaluated`,
    summaryNote,
  };

  const cognitiveFacets = {
    focusInhibition: {
      name: "Focus & Interference Resistance",
      score: gameSummaries["stroop"]?.averageAccuracy ?? null,
      domain: "Selective attention & impulse control (Stroop colour-word task)",
    },
    workingMemory: {
      name: "Visual Working Memory",
      score: gameSummaries["card-flip"]?.averageAccuracy ?? null,
      domain:
        "Short-term spatial recall & pair association (Card flip memory match)",
    },
    patternReasoning: {
      name: "Pattern Induction & Extrapolation",
      score: gameSummaries["pattern"]?.averageAccuracy ?? null,
      domain: "Rule abstraction & sequence prediction (Pattern recognition)",
    },
    visualDiscrimination: {
      name: "Visual Feature Acuity",
      score: gameSummaries["odd-one-out"]?.averageAccuracy ?? null,
      domain: "Categorization & invariant feature analysis (Odd one out)",
    },
    conceptualFlexibility: {
      name: "Hypothesis Testing & Flexibility",
      score: gameSummaries["rule-discovery"]?.averageAccuracy ?? null,
      domain: "Inductive reasoning & rule discovery under changing criteria",
    },
    temporalSequencing: {
      name: "Temporal & Narrative Sequencing",
      score: gameSummaries["story-sequencing"]?.averageAccuracy ?? null,
      domain: "Logical timeline reconstruction & causal reasoning",
    },
  };

  // Prepare input for AI report generation
  const gamesPayload = CANONICAL_GAMES.map((cg) => {
    const gameAttempts = attempts.filter((a) => a.gameId === cg.id);
    const summary = gameSummaries[cg.key] || {
      levelsCompleted: 0,
      averageAccuracy: null,
      averageReactionTimeMs: null,
    };
    return {
      gameId: cg.id,
      gameKey: cg.key,
      gameName: cg.name,
      domain: cg.domain,
      levelsCompleted: summary.levelsCompleted,
      averageAccuracy: summary.averageAccuracy,
      averageReactionTimeMs: summary.averageReactionTimeMs,
      levels: [1, 2, 3].map((lvl) => {
        const att = gameAttempts.find((a) => a.levelNumber === lvl);
        return {
          levelNumber: lvl,
          attemptNumber: att?.attemptNumber || 1,
          status: att ? "COMPLETED" : "NOT_COMPLETED",
          totalTrials: att?.totalTrials ?? null,
          correctTrials: att?.correctTrials ?? null,
          accuracy: att?.accuracy ?? null,
          durationMs: att?.durationMs ?? null,
          averageReactionTimeMs: att?.averageReactionTimeMs ?? null,
        };
      }),
    };
  });

  const aiInput: GameplayReportInput = {
    child: {
      childName,
      age,
      selectedClass,
      school,
    },
    quest: {
      sessionId,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt
        ? session.completedAt.toISOString()
        : null,
      totalLevelsCompleted,
      overallAccuracy,
      totalDurationMs,
    },
    warmUp: {
      copingStrategy: copingStrategy || "retry",
      learningStyle: learningStyle || "both",
      favoriteSubject: favoriteSubject || "exploration",
      emotionalState: emotionalState || "happy",
    },
    games: gamesPayload,
  };

  // Call OpenAI (or fallback)
  const aiResult = await generateAiReport(aiInput);

  const reportData = {
    questSessionId: sessionId,
    userId: session.userId,
    childProfileId: session.childProfileId || childProfile?.id || null,
    childName,
    age,
    selectedClass,
    school,
    overallAccuracy,
    totalDurationMs,
    gameSummaries,
    cognitiveFacets,
    growthObservations,
    aiReport: aiResult.report as any,
    status: "GENERATED" as const,
    modelName: aiResult.modelName,
    errorMessage: aiResult.errorMessage || null,
    schemaVersion: 2,
    generatedAt: new Date(),
  };

  if (existingReport && forceRegenerate) {
    const updated = await prisma.questReport.update({
      where: { questSessionId: sessionId },
      data: reportData,
    });
    logger.info(
      {
        sessionId,
        reportId: updated.id,
        modelName: updated.modelName,
        overallAccuracy: updated.overallAccuracy,
      },
      "quest.report_regenerated_and_persisted"
    );
    return updated;
  }

  try {
    const report = await prisma.questReport.create({
      data: reportData,
    });
    logger.info(
      {
        sessionId,
        reportId: report.id,
        modelName: report.modelName,
        overallAccuracy: report.overallAccuracy,
      },
      "quest.report_persisted"
    );
    return report;
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Concurrently created by parallel request; return existing report
      const existing = await prisma.questReport.findUnique({
        where: { questSessionId: sessionId },
      });
      if (existing) {
        logger.info(
          { sessionId, reportId: existing.id },
          "quest.report_concurrent_duplicate_resolved"
        );
        return existing;
      }
    }
    logger.error(
      { sessionId, err: err instanceof Error ? err.message : String(err) },
      "quest.report_persist_failed"
    );
    throw err;
  }
}

export async function getReportPdfBuffer(
  userId: string,
  sessionId: string,
  isAdmin = false
): Promise<Uint8Array> {
  const report = await prisma.questReport.findUnique({
    where: { questSessionId: sessionId },
    include: {
      questSession: {
        select: {
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });

  if (!report) {
    throw new NotFoundError("Quest assessment report not found");
  }

  if (!isAdmin && report.userId !== userId) {
    throw new ForbiddenError(
      "You do not have permission to access this report",
      "ACCESS_DENIED"
    );
  }

  let structuredAi = report.aiReport as AiStructuredReport | null;
  if (!structuredAi) {
    // Generate authoritative structured representation from existing saved report fields
    structuredAi = generateRuleBasedReport({
      child: {
        childName: report.childName,
        age: report.age,
        selectedClass: report.selectedClass,
        school: report.school,
      },
      quest: {
        sessionId: report.questSessionId,
        startedAt: report.questSession.startedAt.toISOString(),
        completedAt: report.questSession.completedAt
          ? report.questSession.completedAt.toISOString()
          : null,
        totalLevelsCompleted: 18,
        overallAccuracy: report.overallAccuracy,
        totalDurationMs: report.totalDurationMs,
      },
      warmUp: {
        copingStrategy:
          (report.growthObservations as any)?.copingStrategy || "retry",
        learningStyle:
          (report.growthObservations as any)?.learningStyle || "both",
        favoriteSubject:
          (report.growthObservations as any)?.favoriteSubject || "exploration",
        emotionalState:
          (report.growthObservations as any)?.emotionalState || "happy",
      },
      games: CANONICAL_GAMES.map((cg) => {
        const gs = (report.gameSummaries as any)?.[cg.key] || {};
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          levelsCompleted: gs.levelsCompleted ?? 3,
          averageAccuracy: gs.averageAccuracy ?? null,
          averageReactionTimeMs: gs.averageReactionTimeMs ?? null,
          levels: [1, 2, 3].map((lvl) => ({
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: null,
            correctTrials: null,
            accuracy: gs.averageAccuracy ?? null,
            durationMs: null,
            averageReactionTimeMs: gs.averageReactionTimeMs ?? null,
          })),
        };
      }),
    });
  }

  return await generateReportPdf({
    childName: report.childName,
    age: report.age,
    selectedClass: report.selectedClass,
    school: report.school,
    questCompletedAt: report.questSession.completedAt
      ? report.questSession.completedAt.toISOString()
      : null,
    reportGeneratedAt: report.generatedAt.toISOString(),
    overallAccuracy: report.overallAccuracy,
    totalDurationMs: report.totalDurationMs,
    aiReport: structuredAi,
  });
}

interface FormattableSession {
  id: string;
  userId: string;
  childProfileId?: string | null;
  childProfile?: { childName?: string | null } | null;
  status: string;
  currentStage: string;
  currentGame: number;
  currentLevel: number;
  warmUpSubmission?: unknown | null;
  startedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date | null;
  levelAttempts?: unknown[];
  questReport?: unknown | null;
}

function formatSessionResponse(session: FormattableSession) {
  const overallIndex =
    (session.currentGame - 1) * LEVELS_PER_GAME + session.currentLevel;

  return {
    id: session.id,
    userId: session.userId,
    childProfileId: session.childProfileId || null,
    childName: session.childProfile?.childName || null,
    status: session.status,
    currentStage: session.currentStage,
    currentGame: session.currentGame,
    currentLevel: session.currentLevel,
    currentProgressIndex:
      session.status === "COMPLETED" ? TOTAL_LEVELS : overallIndex - 1,
    totalLevels: TOTAL_LEVELS,
    isWarmUpCompleted: Boolean(session.warmUpSubmission),
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    completedAt: session.completedAt,
    completedLevels: session.levelAttempts || [],
    hasReport: Boolean(session.questReport),
  };
}

export async function getResumeState(userId: string, childProfileId?: string) {
  const where: Prisma.QuestSessionWhereInput = {
    userId,
    status: "IN_PROGRESS",
  };

  if (childProfileId) {
    await assertChildOwnership(userId, childProfileId);
    where.childProfileId = childProfileId;
  }

  // Query only the authenticated user's IN_PROGRESS quest sessions (never trust client userId)
  const activeSessions = await prisma.questSession.findMany({
    where,
    select: {
      id: true,
      userId: true,
      childProfileId: true,
      status: true,
      currentStage: true,
      currentGame: true,
      currentLevel: true,
      startedAt: true,
      warmUpSubmission: {
        select: { id: true },
      },
      levelAttempts: {
        orderBy: { attemptNumber: "desc" },
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          status: true,
          metrics: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  const primarySession = activeSessions[0];
  if (!primarySession) {
    return {
      hasResumableQuest: false,
      destination: "/",
      sessionId: null,
      childProfileId: childProfileId || null,
      currentStage: null,
      currentGame: null,
      currentLevel: null,
      attemptId: null,
      checkpoint: null,
    };
  }

  // Deterministic duplicate resolution ONLY for sessions of the same child:
  if (childProfileId) {
    if (activeSessions.length > 1) {
      const staleSessionIds = activeSessions.slice(1).map((s) => s.id);
      await prisma.questSession.updateMany({
        where: { id: { in: staleSessionIds } },
        data: {
          status: "ABANDONED",
          abandonedAt: new Date(),
        },
      });
    }
  } else {
    // If childProfileId is not specified, group by childProfileId so we don't cross-abandon
    const seenChildren = new Set<string>();
    const staleIds: string[] = [];
    for (const s of activeSessions) {
      const key = s.childProfileId || "unassigned";
      if (
        seenChildren.has(key) ||
        (primarySession.childProfileId && !s.childProfileId)
      ) {
        staleIds.push(s.id);
      } else {
        seenChildren.add(key);
      }
    }
    if (staleIds.length > 0) {
      await prisma.questSession.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: "ABANDONED",
          abandonedAt: new Date(),
        },
      });
    }
  }

  // Case B: Warm-up has not been submitted
  if (!primarySession.warmUpSubmission) {
    return {
      hasResumableQuest: true,
      sessionId: primarySession.id,
      childProfileId: primarySession.childProfileId || null,
      destination: "/warm-up",
      currentStage: "WARM_UP",
      currentGame: 1,
      currentLevel: 1,
      attemptId: null,
      checkpoint: null,
    };
  }

  // Compute authoritative stage from contiguous completions
  const prog = computeSessionProgression(
    primarySession,
    primarySession.levelAttempts
  );
  const activeGame = prog.currentGame;
  const activeLevel = prog.currentLevel;
  const activeStage = prog.currentStage;

  if (prog.needsReconciliation) {
    await prisma.questSession.update({
      where: { id: primarySession.id },
      data: {
        currentGame: activeGame,
        currentLevel: activeLevel,
        currentStage: activeStage,
        status: prog.isQuestComplete ? "COMPLETED" : "IN_PROGRESS",
        lastActivityAt: new Date(),
      },
    });
  }

  if (prog.isQuestComplete) {
    return {
      hasResumableQuest: false,
      destination: "/report",
      sessionId: primarySession.id,
      childProfileId: primarySession.childProfileId || null,
      currentStage: "COMPLETED",
      currentGame: 6,
      currentLevel: 3,
      attemptId: null,
      checkpoint: null,
    };
  }

  // Case C & D & E: Warm-up is submitted; determine game & level
  const gameKey = GAME_ID_TO_KEY[activeGame] || "stroop";
  const destination = `/games/${gameKey}?level=${activeLevel}`;

  // Find any unfinished attempt for this authorized stage
  const unfinishedAttempt = primarySession.levelAttempts.find(
    (a) =>
      a.gameKey === gameKey &&
      a.levelNumber === activeLevel &&
      a.status === "IN_PROGRESS"
  );

  const checkpoint = (unfinishedAttempt?.metrics as any)?.checkpoint || null;

  return {
    hasResumableQuest: true,
    sessionId: primarySession.id,
    childProfileId: primarySession.childProfileId || null,
    destination,
    currentStage: activeStage,
    currentGame: activeGame,
    currentLevel: activeLevel,
    attemptId: unfinishedAttempt?.id || null,
    checkpoint,
  };
}

export async function saveAttemptCheckpoint(
  userId: string,
  sessionId: string,
  attemptId: string,
  checkpoint: Record<string, any>
) {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.questSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundError("Quest session not found");
    }

    if (session.userId !== userId) {
      throw new ForbiddenError("You do not own this quest session");
    }

    if (session.status !== "IN_PROGRESS") {
      throw new ConflictError(
        "Cannot save checkpoint on a closed quest session",
        "SESSION_CLOSED"
      );
    }

    const attempt = await tx.levelAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt || attempt.questSessionId !== sessionId) {
      throw new NotFoundError("Level attempt not found in this quest session");
    }

    if (attempt.userId !== userId) {
      throw new ForbiddenError("You do not own this level attempt");
    }

    if (attempt.status !== "IN_PROGRESS") {
      throw new ValidationError(
        "Cannot save checkpoint on an attempt that is already completed or abandoned"
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const currentMetrics = (attempt.metrics as Record<string, any>) || {};

    const updatedAttempt = await tx.levelAttempt.update({
      where: { id: attemptId },
      data: {
        metrics: {
          ...currentMetrics,
          checkpoint,
          checkpointSavedAt: nowIso,
        },
      },
    });

    await tx.questSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: now },
    });

    return {
      success: true,
      attemptId: updatedAttempt.id,
      checkpointSavedAt: nowIso,
    };
  });

  logger.debug(
    {
      sessionId,
      attemptId,
      checkpointSavedAt: result.checkpointSavedAt,
    },
    "quest.checkpoint_saved"
  );

  return result;
}
