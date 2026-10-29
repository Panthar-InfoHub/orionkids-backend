import { prisma } from "../lib/prisma.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import type { GameKey, CompleteLevelInput } from "../validators/quest.schema.js";
import { GAME_KEY_TO_ID, GAME_ID_TO_KEY } from "../validators/quest.schema.js";

export async function getOrCreateActiveSession(userId: string) {
  // Check if there is an in-progress session
  let session = await prisma.questSession.findFirst({
    where: {
      userId,
      status: "IN_PROGRESS",
    },
    include: {
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
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
      },
      include: {
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

export async function getCurrentSession(userId: string) {
  // 1. Check in-progress session
  const activeSession = await prisma.questSession.findFirst({
    where: {
      userId,
      status: "IN_PROGRESS",
    },
    include: {
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
    return formatSessionResponse(activeSession);
  }

  // 2. Otherwise get most recent completed session
  const latestCompleted = await prisma.questSession.findFirst({
    where: {
      userId,
      status: "COMPLETED",
    },
    include: {
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
    throw new ValidationError("This quest session is already completed or abandoned");
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
    nextGameRoute: "/games/stroop?game=1&level=1",
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
    include: { warmUpSubmission: true },
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
    throw new ValidationError("Warm-up questionnaire must be completed before starting levels");
  }

  const requestedGameId = GAME_KEY_TO_ID[gameKey];
  const requestedOverallIndex = (requestedGameId - 1) * 3 + levelNumber;
  const authorizedOverallIndex = (session.currentGame - 1) * 3 + session.currentLevel;

  // Reject skipping forward beyond authorized stage
  if (requestedOverallIndex > authorizedOverallIndex) {
    throw new ForbiddenError(
      `Level progression violation: Game ${requestedGameId} Level ${levelNumber} is locked. You are on Game ${session.currentGame} Level ${session.currentLevel}.`
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
    startedAt: attempt.startedAt,
  };
}

export async function completeLevelAttempt(
  userId: string,
  sessionId: string,
  input: CompleteLevelInput
) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    include: {
      warmUpSubmission: true,
      levelAttempts: {
        where: {
          gameKey: input.gameKey,
          levelNumber: input.levelNumber,
          status: "COMPLETED",
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
    throw new ValidationError("Quest session is closed");
  }

  const requestedGameId = GAME_KEY_TO_ID[input.gameKey];
  const requestedIndex = (requestedGameId - 1) * 3 + input.levelNumber;
  const authorizedIndex = (session.currentGame - 1) * 3 + session.currentLevel;

  if (requestedIndex > authorizedIndex) {
    throw new ForbiddenError("Cannot complete a level ahead of current authorized stage");
  }

  // Idempotency check: if this specific level is already completed, return success without double-advancing
  const alreadyCompleted = session.levelAttempts.find(
    (a) => a.gameKey === input.gameKey && a.levelNumber === input.levelNumber
  );

  if (alreadyCompleted && requestedIndex < authorizedIndex) {
    return {
      success: true,
      message: "Level was already recorded",
      levelAttemptId: alreadyCompleted.id,
      sessionId: session.id,
      nextStage: session.currentStage,
      currentGame: session.currentGame,
      currentLevel: session.currentLevel,
      isQuestComplete: false,
    };
  }

  return prisma.$transaction(async (tx) => {
    let attempt = await tx.levelAttempt.findFirst({
      where: {
        questSessionId: sessionId,
        gameKey: input.gameKey,
        levelNumber: input.levelNumber,
        status: "IN_PROGRESS",
      },
      orderBy: { attemptNumber: "desc" },
    });

    const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();

    if (attempt) {
      attempt = await tx.levelAttempt.update({
        where: { id: attempt.id },
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
    } else {
      const existingCount = await tx.levelAttempt.count({
        where: {
          questSessionId: sessionId,
          gameKey: input.gameKey,
          levelNumber: input.levelNumber,
        },
      });

      attempt = await tx.levelAttempt.create({
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
    }

    let nextGame = session.currentGame;
    let nextLevel = session.currentLevel;
    let nextStage = session.currentStage;
    let isQuestFinished = false;

    if (requestedIndex === authorizedIndex) {
      if (session.currentGame === 6 && session.currentLevel === 3) {
        nextStage = "COMPLETED";
        isQuestFinished = true;
      } else if (session.currentLevel < 3) {
        nextLevel = session.currentLevel + 1;
        nextStage = `GAME_${nextGame}_LEVEL_${nextLevel}`;
      } else {
        nextGame = session.currentGame + 1;
        nextLevel = 1;
        nextStage = `GAME_${nextGame}_LEVEL_1`;
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
      message: "Level attempt completed and recorded",
      levelAttemptId: attempt.id,
      sessionId,
      nextStage,
      currentGame: nextGame,
      currentLevel: nextLevel,
      isQuestComplete: isQuestFinished,
    };
  });
}

export async function generateOrGetReport(userId: string, sessionId: string) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    include: {
      questReport: true,
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        orderBy: [{ gameId: "asc" }, { levelNumber: "asc" }],
      },
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError("You do not own this quest session");
  }

  if (session.questReport) {
    return session.questReport;
  }

  const childProfile = await prisma.childProfile.findUnique({
    where: { userId },
  });

  const childName = childProfile?.childName || "Young Explorer";
  const age = childProfile?.age || 7;
  const selectedClass = childProfile?.selectedClass || "Class 1";
  const school = childProfile?.school || null;

  const attempts = session.levelAttempts;
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
          (accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length) * 10
        ) / 10
      : 85.0;

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
        : 80;

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

  const warmUpAnswers = (session.warmUpSubmission?.answers as Record<string, string>) || {};
  const copingStrategy = warmUpAnswers["2"] || "retry";
  const learningStyle = warmUpAnswers["3"] || "both";
  const favoriteSubject = warmUpAnswers["4"] || "numbers";
  const emotionalState = warmUpAnswers["6"] || "happy";

  const growthObservations = {
    copingStrategy,
    learningStyle,
    favoriteSubject,
    emotionalState,
    overallEngagement: totalLevelsCompleted >= 18 ? "Full 18-Level Completion" : `${totalLevelsCompleted}/18 Levels Evaluated`,
    summaryNote:
      "Demonstrated steady focus, adaptable problem-solving approach, and positive interaction throughout the cognitive exploration journey.",
  };

  const cognitiveFacets = {
    focusInhibition: {
      name: "Focus & Interference Resistance",
      score: gameSummaries["stroop"]?.averageAccuracy || 88,
      domain: "Selective attention & impulse control (Stroop colour-word task)",
    },
    workingMemory: {
      name: "Visual Working Memory",
      score: gameSummaries["card-flip"]?.averageAccuracy || 82,
      domain: "Short-term spatial recall & pair association (Card flip memory match)",
    },
    patternReasoning: {
      name: "Pattern Induction & Extrapolation",
      score: gameSummaries["pattern"]?.averageAccuracy || 90,
      domain: "Rule abstraction & sequence prediction (Pattern recognition)",
    },
    visualDiscrimination: {
      name: "Visual Feature Acuity",
      score: gameSummaries["odd-one-out"]?.averageAccuracy || 85,
      domain: "Categorization & invariant feature analysis (Odd one out)",
    },
    conceptualFlexibility: {
      name: "Hypothesis Testing & Flexibility",
      score: gameSummaries["rule-discovery"]?.averageAccuracy || 84,
      domain: "Inductive reasoning & rule discovery under changing criteria",
    },
    temporalSequencing: {
      name: "Temporal & Narrative Sequencing",
      score: gameSummaries["story-sequencing"]?.averageAccuracy || 92,
      domain: "Logical timeline reconstruction & causal reasoning",
    },
  };

  const report = await prisma.questReport.create({
    data: {
      questSessionId: sessionId,
      userId,
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
}

function formatSessionResponse(session: any) {
  const overallIndex = (session.currentGame - 1) * 3 + session.currentLevel;

  return {
    id: session.id,
    userId: session.userId,
    status: session.status,
    currentStage: session.currentStage,
    currentGame: session.currentGame,
    currentLevel: session.currentLevel,
    currentProgressIndex: session.status === "COMPLETED" ? 18 : overallIndex - 1,
    totalLevels: 18,
    isWarmUpCompleted: Boolean(session.warmUpSubmission),
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    completedAt: session.completedAt,
    completedLevels: session.levelAttempts || [],
    hasReport: Boolean(session.questReport),
  };
}
