import { prisma } from "../lib/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type {
  GameKey,
  CompleteLevelInput,
} from "../validators/quest.schema.js";
import { GAME_KEY_TO_ID, GAME_ID_TO_KEY } from "../validators/quest.schema.js";

/**
 * Helper to compute the authoritative progression stage from a session and its completed attempts.
 * Progression is strictly contiguous (Game 1 L1 -> L2 -> L3 -> Game 2 L1 -> ... -> Game 6 L3).
 */
export function computeSessionProgression(
  session: { currentGame: number; currentLevel: number; status: string },
  completedAttempts: Array<{ gameKey: string; levelNumber: number; status?: string }>
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
  const isQuestComplete = session.status === "COMPLETED" || highestContiguous >= 18;

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
    const child = await prisma.childProfile.findUnique({
      where: { id: resolvedChildId },
    });
    if (!child) {
      throw new NotFoundError("Child profile not found");
    }
    if (child.userId !== userId) {
      throw new ForbiddenError(
        "You do not have access to this child profile",
        "ACCESS_DENIED"
      );
    }
  } else {
    // If no childProfileId is supplied, check if parent has exactly 1 child profile
    const children = await prisma.childProfile.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (children.length === 1 && children[0]) {
      resolvedChildId = children[0].id;
    }
  }

  const where: any = {
    userId,
    status: "IN_PROGRESS",
  };

  if (resolvedChildId) {
    where.childProfileId = resolvedChildId;
  }

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
    session = await prisma.questSession.create({
      data: {
        userId,
        childProfileId: resolvedChildId || null,
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

  return formatSessionResponse(session);
}

export async function getCurrentSession(
  userId: string,
  childProfileId?: string
) {
  const whereInProgress: any = {
    userId,
    status: "IN_PROGRESS",
  };
  const whereCompleted: any = {
    userId,
    status: "COMPLETED",
  };

  if (childProfileId) {
    const child = await prisma.childProfile.findUnique({
      where: { id: childProfileId },
    });
    if (!child) {
      throw new NotFoundError("Child profile not found");
    }
    if (child.userId !== userId) {
      throw new ForbiddenError(
        "You do not have access to this child profile",
        "ACCESS_DENIED"
      );
    }
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
    const prog = computeSessionProgression(activeSession, activeSession.levelAttempts);
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

  return formatSessionResponse(session);
}

export async function saveWarmUpSubmission(
  userId: string,
  sessionId?: string,
  answers?: Record<string, string>,
  completedAt?: string
) {
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    const active = await getOrCreateActiveSession(userId);
    targetSessionId = active.id;
  }

  const session = await prisma.questSession.findUnique({
    where: { id: targetSessionId },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  if (session.status !== "IN_PROGRESS") {
    throw new ValidationError(
      "This quest session is already completed or abandoned"
    );
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
        currentStage: "GAME_1_LEVEL_1",
        currentGame: 1,
        currentLevel: 1,
        lastActivityAt: new Date(),
      },
    });

    return { submission, session: updatedSession };
  });

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
  levelNumber: number
) {
  const session = await prisma.questSession.findUnique({
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
        where: { status: "COMPLETED" },
        select: { gameKey: true, levelNumber: true },
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

  // Compute authoritative progression based on contiguous completions
  let currentSession = session;
  const prog = computeSessionProgression(session, session.levelAttempts);
  if (prog.needsReconciliation) {
    currentSession = await prisma.questSession.update({
      where: { id: sessionId },
      data: {
        currentGame: prog.currentGame,
        currentLevel: prog.currentLevel,
        currentStage: prog.currentStage,
        status: prog.isQuestComplete ? "COMPLETED" : "IN_PROGRESS",
        lastActivityAt: new Date(),
      },
      include: {
        warmUpSubmission: true,
        levelAttempts: {
          where: { status: "COMPLETED" },
        },
      },
    });
  }

  const requestedGameId = GAME_KEY_TO_ID[gameKey];
  const requestedOverallIndex = (requestedGameId - 1) * 3 + levelNumber;
  const authorizedOverallIndex =
    (currentSession.currentGame - 1) * 3 + currentSession.currentLevel;

  // Reject skipping forward beyond authorized stage
  if (requestedOverallIndex > authorizedOverallIndex) {
    throw new ForbiddenError(
      `Level progression violation: Game ${requestedGameId} Level ${levelNumber} is locked. You are on Game ${currentSession.currentGame} Level ${currentSession.currentLevel}.`
    );
  }

  // Find existing in-progress attempt or create a new attempt
  let attempt = await prisma.levelAttempt.findFirst({
    where: {
      questSessionId: sessionId,
      gameKey,
      levelNumber,
      status: "IN_PROGRESS",
    },
    orderBy: { attemptNumber: "desc" },
  });

  if (!attempt) {
    const existingCount = await prisma.levelAttempt.count({
      where: {
        questSessionId: sessionId,
        gameKey,
        levelNumber,
      },
    });

    attempt = await prisma.levelAttempt.create({
      data: {
        questSessionId: sessionId,
        userId,
        gameId: requestedGameId,
        gameKey,
        levelNumber,
        attemptNumber: existingCount + 1,
        status: "IN_PROGRESS",
      },
    });
  }

  return {
    attemptId: attempt.id,
    sessionId: session.id,
    gameKey,
    levelNumber,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
  };
}

export async function completeLevelAttempt(
  userId: string,
  sessionId: string,
  input: CompleteLevelInput
) {
  // Reject placeholder/synthetic completion
  if (
    input.totalTrials !== undefined &&
    input.totalTrials <= 0
  ) {
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

  return prisma.$transaction(
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
      const prog = computeSessionProgression(currentSession, currentSession.levelAttempts);

      const existingCompleted = currentSession.levelAttempts.find(
        (a) => a.gameKey === input.gameKey && a.levelNumber === input.levelNumber
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

      const completedAt = input.completedAt
        ? new Date(input.completedAt)
        : new Date();

      // 1. Idempotent Retry: Level is ALREADY completed
      if (existingCompleted) {
        if (activeAttempt) {
          await tx.levelAttempt.update({
            where: { id: activeAttempt.id },
            data: {
              status: "COMPLETED",
              totalTrials: input.totalTrials ?? null,
              correctTrials: input.correctTrials ?? null,
              accuracy: input.accuracy ?? null,
              durationMs: input.durationMs ?? null,
              averageReactionTimeMs: input.averageReactionTimeMs ?? null,
              metrics: input.metrics || {},
              trialRecords: input.trialRecords || [],
              completedAt,
            },
          });
        }

        // Reconcile session if it had not yet advanced to the next level
        let nextGame = currentSession.currentGame;
        let nextLevel = currentSession.currentLevel;
        let nextStage = currentSession.currentStage;
        let isQuestFinished = false;

        if (requestedIndex >= prog.authorizedIndex) {
          const newHighest = Math.max(prog.highestCompletedIndex, requestedIndex);
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
      // Concurrency guard: Atomically advance session state first.
      const newHighest = Math.max(prog.highestCompletedIndex, requestedIndex);
      let nextGame: number;
      let nextLevel: number;
      let nextStage: string;
      let isQuestFinished = false;

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

      // Persist the completed attempt
      let finalAttemptId: string;
      if (activeAttempt) {
        const updated = await tx.levelAttempt.update({
          where: { id: activeAttempt.id },
          data: {
            status: "COMPLETED",
            totalTrials: input.totalTrials ?? null,
            correctTrials: input.correctTrials ?? null,
            accuracy: input.accuracy ?? null,
            durationMs: input.durationMs ?? null,
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
            accuracy: input.accuracy ?? null,
            durationMs: input.durationMs ?? null,
            averageReactionTimeMs: input.averageReactionTimeMs ?? null,
            metrics: input.metrics || {},
            trialRecords: input.trialRecords || [],
            completedAt,
          },
        });
        finalAttemptId = created.id;
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
}

export async function generateOrGetReport(userId: string, sessionId: string) {
  // Fast path: if report is already stored, return it immediately without fetching attempt records
  const existingReport = await prisma.questReport.findUnique({
    where: { questSessionId: sessionId },
  });

  if (existingReport) {
    if (existingReport.userId !== userId) {
      throw new ForbiddenError("You do not own this quest session");
    }
    return existingReport;
  }

  // Slow path: generate report for the first time with scoped relation fields
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      status: true,
      currentGame: true,
      currentLevel: true,
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
        orderBy: [{ gameId: "asc" }, { levelNumber: "asc" }, { attemptNumber: "desc" }],
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

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  if (session.status !== "COMPLETED") {
    throw new ValidationError(
      `Quest session is in progress (Game ${session.currentGame}, Level ${session.currentLevel}). All 18 levels must be completed before generating a final report.`
    );
  }

  let childProfile = session.childProfile;
  if (!childProfile) {
    childProfile = await prisma.childProfile.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        childName: true,
        age: true,
        selectedClass: true,
        school: true,
      },
    });
  }

  const childName = childProfile?.childName || "Young Explorer";
  const age = childProfile?.age || 7;
  const selectedClass = childProfile?.selectedClass || "Class 1";
  const school = childProfile?.school || null;

  // Exclude synthetic/autoAdvanced/zero-trial attempts from genuine completion metrics
  const isGenuineAttempt = (a: any) =>
    typeof a.totalTrials === "number" &&
    a.totalTrials > 0 &&
    !(a.metrics as any)?.autoAdvanced &&
    !(a.metrics as any)?.skippedByFrontend;

  const rawAttempts = session.levelAttempts.filter(isGenuineAttempt);

  // Deduplicate by gameId-levelNumber (keeping the latest completed attempt)
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
      const attTime = att.completedAt
        ? new Date(att.completedAt).getTime()
        : 0;
      if (att.attemptNumber > existing.attemptNumber || attTime > existingTime) {
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
  const copingStrategy = warmUpAnswers["2"] || "retry";
  const learningStyle = warmUpAnswers["3"] || "both";
  const favoriteSubject = warmUpAnswers["4"] || "numbers";
  const emotionalState = warmUpAnswers["6"] || "happy";

  const growthObservations = {
    copingStrategy,
    learningStyle,
    favoriteSubject,
    emotionalState,
    overallEngagement:
      totalLevelsCompleted >= 18
        ? "Full 18-Level Completion"
        : `${totalLevelsCompleted}/18 Levels Evaluated`,
    summaryNote:
      "Demonstrated steady focus, adaptable problem-solving approach, and positive interaction throughout the cognitive exploration journey.",
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

  try {
    const report = await prisma.questReport.create({
      data: {
        questSessionId: sessionId,
        userId,
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
        schemaVersion: 1,
      },
    });

    return report;
  } catch (err: any) {
    if (err?.code === "P2002") {
      // Concurrently created by parallel request; return existing report
      const existing = await prisma.questReport.findUnique({
        where: { questSessionId: sessionId },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

function formatSessionResponse(session: any) {
  const overallIndex = (session.currentGame - 1) * 3 + session.currentLevel;

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
      session.status === "COMPLETED" ? 18 : overallIndex - 1,
    totalLevels: 18,
    isWarmUpCompleted: Boolean(session.warmUpSubmission),
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    completedAt: session.completedAt,
    completedLevels: session.levelAttempts || [],
    hasReport: Boolean(session.questReport),
  };
}

export async function getResumeState(userId: string, childProfileId?: string) {
  const where: any = {
    userId,
    status: "IN_PROGRESS",
  };

  if (childProfileId) {
    const child = await prisma.childProfile.findUnique({
      where: { id: childProfileId },
    });
    if (!child) {
      throw new NotFoundError("Child profile not found");
    }
    if (child.userId !== userId) {
      throw new ForbiddenError(
        "You do not have access to this child profile",
        "ACCESS_DENIED"
      );
    }
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
      if (seenChildren.has(key)) {
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
  const prog = computeSessionProgression(primarySession, primarySession.levelAttempts);
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
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  if (session.status !== "IN_PROGRESS") {
    throw new ValidationError("Cannot save checkpoint on a closed quest session");
  }

  const attempt = await prisma.levelAttempt.findUnique({
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

  const currentMetrics = (attempt.metrics as Record<string, any>) || {};

  const updatedAttempt = await prisma.levelAttempt.update({
    where: { id: attemptId },
    data: {
      metrics: {
        ...currentMetrics,
        checkpoint,
        checkpointSavedAt: new Date().toISOString(),
      },
    },
  });

  await prisma.questSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });

  return {
    success: true,
    attemptId: updatedAttempt.id,
    checkpointSavedAt: new Date().toISOString(),
  };
}
