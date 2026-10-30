import { prisma } from "../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type { CreateChildInput, UpdateChildInput } from "../validators/child.schema.js";
import { computeSessionProgression } from "./quest.service.js";
import { idempotencyRegistry } from "../utils/idempotency.js";

const CANONICAL_GAMES = [
  { id: 1, key: "stroop", title: "Stroop Colour-Word", totalLevels: 3 },
  { id: 2, key: "card-flip", title: "Cosmic Card Flip", totalLevels: 3 },
  { id: 3, key: "pattern", title: "Pattern Recognition", totalLevels: 3 },
  { id: 4, key: "odd-one-out", title: "Odd One Out", totalLevels: 3 },
  { id: 5, key: "rule-discovery", title: "Rule Discovery", totalLevels: 3 },
  { id: 6, key: "story-sequencing", title: "Story Sequencing", totalLevels: 3 },
];

export async function createChildProfile(
  userId: string,
  input: CreateChildInput,
  idempotencyKey?: string
) {
  const effectiveIdempotencyKey = idempotencyKey || input.idempotencyKey;
  if (effectiveIdempotencyKey) {
    const cached = idempotencyRegistry.get<any>(userId, effectiveIdempotencyKey);
    if (cached) {
      return cached.result;
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "RESTRICTED") {
    throw new ForbiddenError(
      "Your account is restricted",
      "ACCOUNT_RESTRICTED"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Every deliberate onboarding submission creates a distinct, new ChildProfile record
    const childProfile = await tx.childProfile.create({
      data: {
        userId,
        childName: input.childName,
        age: input.age,
        language: input.language,
        school: input.school || null,
        selectedClass: input.selectedClass,
        studentId: input.studentId || null,
        parentEmail: input.parentEmail,
        parentMobile: input.parentMobile,
        isGuardian: input.isGuardian,
      },
    });

    // Create an independent initial quest session specifically bound to this newly created child profile
    const session = await tx.questSession.create({
      data: {
        userId,
        childProfileId: childProfile.id,
        status: "IN_PROGRESS",
        currentStage: "WARM_UP",
        currentGame: 1,
        currentLevel: 1,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        onboardingSubmittedAt: new Date(),
      },
    });

    return {
      ...childProfile,
      initialSession: session,
      initialSessionId: session.id,
    };
  });

  if (effectiveIdempotencyKey) {
    idempotencyRegistry.set(userId, effectiveIdempotencyKey, result, 201);
  }

  return result;
}

export async function listChildren(userId: string) {
  const children = await prisma.childProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      questSessions: {
        orderBy: { startedAt: "desc" },
        include: {
          questReport: {
            select: { id: true, generatedAt: true },
          },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: { id: true, gameKey: true, levelNumber: true },
          },
        },
      },
    },
  });

  return children.map((child) => {
    const sessions = child.questSessions || [];
    const completedSessions = sessions.filter((s) => s.status === "COMPLETED");
    const inProgressSession = sessions.find((s) => s.status === "IN_PROGRESS");

    let progressOverall = 0;
    let completedLevelsCount = 0;
    let currentStage = "NOT_STARTED";
    let currentGame = 1;
    let currentLevel = 1;

    if (inProgressSession) {
      const prog = computeSessionProgression(
        inProgressSession,
        inProgressSession.levelAttempts
      );
      completedLevelsCount = prog.highestCompletedIndex;
      progressOverall = Math.round((completedLevelsCount / 18) * 100);
      currentStage = inProgressSession.currentStage;
      currentGame = prog.currentGame;
      currentLevel = prog.currentLevel;
    } else if (completedSessions.length > 0) {
      completedLevelsCount = 18;
      progressOverall = 100;
      currentStage = "COMPLETED";
      currentGame = 6;
      currentLevel = 3;
    }

    const latestSession = sessions[0];
    const latestActivityAt = latestSession?.lastActivityAt || child.updatedAt;
    const hasReport = sessions.some((s) => Boolean(s.questReport));

    return {
      id: child.id,
      userId: child.userId,
      childName: child.childName,
      age: child.age,
      language: child.language,
      school: child.school,
      selectedClass: child.selectedClass,
      studentId: child.studentId,
      parentEmail: child.parentEmail,
      parentMobile: child.parentMobile,
      isGuardian: child.isGuardian,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      stats: {
        totalQuests: sessions.length,
        completedQuests: completedSessions.length,
        hasInProgressQuest: Boolean(inProgressSession),
        activeSessionId: inProgressSession?.id || null,
        currentStage,
        currentGame,
        currentLevel,
        completedLevelsCount,
        progressOverall,
        hasReport,
        latestActivityAt,
      },
    };
  });
}

export async function getChildProfile(userId: string, childId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childId },
    include: {
      questSessions: {
        orderBy: { startedAt: "desc" },
        include: {
          questReport: { select: { id: true, generatedAt: true } },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: { id: true, gameKey: true, levelNumber: true },
          },
        },
      },
    },
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

  const sessions = child.questSessions || [];
  const completedSessions = sessions.filter((s) => s.status === "COMPLETED");
  const inProgressSession = sessions.find((s) => s.status === "IN_PROGRESS");

  let progressOverall = 0;
  let completedLevelsCount = 0;
  let currentStage = "NOT_STARTED";
  let currentGame = 1;
  let currentLevel = 1;

  if (inProgressSession) {
    const prog = computeSessionProgression(
      inProgressSession,
      inProgressSession.levelAttempts
    );
    completedLevelsCount = prog.highestCompletedIndex;
    progressOverall = Math.round((completedLevelsCount / 18) * 100);
    currentStage = inProgressSession.currentStage;
    currentGame = prog.currentGame;
    currentLevel = prog.currentLevel;
  } else if (completedSessions.length > 0) {
    completedLevelsCount = 18;
    progressOverall = 100;
    currentStage = "COMPLETED";
    currentGame = 6;
    currentLevel = 3;
  }

  const latestSession = sessions[0];
  const latestActivityAt = latestSession?.lastActivityAt || child.updatedAt;
  const hasReport = sessions.some((s) => Boolean(s.questReport));

  return {
    id: child.id,
    userId: child.userId,
    childName: child.childName,
    age: child.age,
    language: child.language,
    school: child.school,
    selectedClass: child.selectedClass,
    studentId: child.studentId,
    parentEmail: child.parentEmail,
    parentMobile: child.parentMobile,
    isGuardian: child.isGuardian,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
    stats: {
      totalQuests: sessions.length,
      completedQuests: completedSessions.length,
      hasInProgressQuest: Boolean(inProgressSession),
      activeSessionId: inProgressSession?.id || null,
      currentStage,
      currentGame,
      currentLevel,
      completedLevelsCount,
      progressOverall,
      hasReport,
      latestActivityAt,
    },
  };
}

export async function updateChildProfile(
  userId: string,
  childId: string,
  input: UpdateChildInput
) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childId },
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

  const updated = await prisma.childProfile.update({
    where: { id: childId },
    data: {
      ...(input.childName !== undefined && { childName: input.childName }),
      ...(input.age !== undefined && { age: input.age }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.school !== undefined && { school: input.school }),
      ...(input.selectedClass !== undefined && { selectedClass: input.selectedClass }),
      ...(input.studentId !== undefined && { studentId: input.studentId }),
      ...(input.parentMobile !== undefined && { parentMobile: input.parentMobile }),
    },
  });

  return updated;
}

export async function getChildProgress(userId: string, childId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childId },
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

  // Find active in-progress session first, or latest completed session
  let session = await prisma.questSession.findFirst({
    where: { childProfileId: childId, status: "IN_PROGRESS" },
    include: {
      warmUpSubmission: true,
      levelAttempts: {
        where: { status: "COMPLETED" },
        orderBy: [{ gameId: "asc" }, { levelNumber: "asc" }, { attemptNumber: "desc" }],
      },
      questReport: true,
    },
    orderBy: { startedAt: "desc" },
  });

  if (!session) {
    session = await prisma.questSession.findFirst({
      where: { childProfileId: childId, status: "COMPLETED" },
      include: {
        warmUpSubmission: true,
        levelAttempts: {
          where: { status: "COMPLETED" },
          orderBy: [{ gameId: "asc" }, { levelNumber: "asc" }, { attemptNumber: "desc" }],
        },
        questReport: true,
      },
      orderBy: { completedAt: "desc" },
    });
  }

  if (!session) {
    // Child has not started any quests yet
    return {
      child: {
        id: child.id,
        childName: child.childName,
        age: child.age,
        selectedClass: child.selectedClass,
        school: child.school,
      },
      hasSession: false,
      status: "NOT_STARTED",
      currentStage: "NOT_STARTED",
      currentGame: 1,
      currentLevel: 1,
      completedLevelsCount: 0,
      totalLevelsCount: 18,
      progressPercentage: 0,
      matrix: CANONICAL_GAMES.map((g) => ({
        ...g,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          status: "LOCKED" as const,
          attempt: null,
        })),
      })),
      recentAttempts: [],
      hasReport: false,
    };
  }

  const prog = computeSessionProgression(session, session.levelAttempts);

  // Group completed attempts by gameKey & levelNumber
  const completedMap = new Map<string, (typeof session.levelAttempts)[0]>();
  for (const att of session.levelAttempts) {
    const key = `${att.gameKey}-${att.levelNumber}`;
    if (!completedMap.has(key)) {
      completedMap.set(key, att);
    }
  }

  const authorizedIndex = prog.isQuestComplete ? 19 : prog.authorizedIndex;

  const matrix = CANONICAL_GAMES.map((game) => {
    const levels = [1, 2, 3].map((lvl) => {
      const overallIndex = (game.id - 1) * 3 + lvl;
      const key = `${game.key}-${lvl}`;
      const completedAttempt = completedMap.get(key) || null;

      let status: "COMPLETED" | "IN_PROGRESS" | "LOCKED" = "LOCKED";
      if (completedAttempt) {
        status = "COMPLETED";
      } else if (
        session!.status === "IN_PROGRESS" &&
        overallIndex === authorizedIndex &&
        Boolean(session!.warmUpSubmission)
      ) {
        status = "IN_PROGRESS";
      }

      return {
        levelNumber: lvl,
        status,
        attempt: completedAttempt
          ? {
              id: completedAttempt.id,
              accuracy: completedAttempt.accuracy,
              durationMs: completedAttempt.durationMs,
              averageReactionTimeMs: completedAttempt.averageReactionTimeMs,
              completedAt: completedAttempt.completedAt,
            }
          : null,
      };
    });

    return {
      ...game,
      levels,
    };
  });

  return {
    child: {
      id: child.id,
      childName: child.childName,
      age: child.age,
      selectedClass: child.selectedClass,
      school: child.school,
    },
    hasSession: true,
    sessionId: session.id,
    status: session.status,
    currentStage: session.currentStage,
    currentGame: prog.currentGame,
    currentLevel: prog.currentLevel,
    completedLevelsCount: prog.highestCompletedIndex,
    totalLevelsCount: 18,
    progressPercentage: Math.round((prog.highestCompletedIndex / 18) * 100),
    matrix,
    recentAttempts: session.levelAttempts.slice(-10),
    hasReport: Boolean(session.questReport),
    reportId: session.questReport?.id || null,
  };
}

export async function getChildQuestSessions(userId: string, childId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childId },
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

  const sessions = await prisma.questSession.findMany({
    where: { childProfileId: childId, userId },
    orderBy: { startedAt: "desc" },
    include: {
      warmUpSubmission: {
        select: { id: true, completedAt: true },
      },
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
        },
      },
    },
  });

  return sessions.map((s) => {
    const prog = computeSessionProgression(s, s.levelAttempts);
    return {
      id: s.id,
      childProfileId: s.childProfileId,
      status: s.status,
      currentStage: s.currentStage,
      currentGame: prog.currentGame,
      currentLevel: prog.currentLevel,
      completedLevelsCount: prog.highestCompletedIndex,
      isWarmUpCompleted: Boolean(s.warmUpSubmission),
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      completedAt: s.completedAt,
      hasReport: Boolean(s.questReport),
      report: s.questReport || null,
    };
  });
}

export async function getChildReports(userId: string, childId: string) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childId },
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

  // Find reports linked directly or via quest session
  const reports = await prisma.questReport.findMany({
    where: {
      userId,
      OR: [
        { childProfileId: childId },
        { questSession: { childProfileId: childId } },
      ],
    },
    orderBy: { generatedAt: "desc" },
  });

  return reports.map((r) => ({
    id: r.id,
    questSessionId: r.questSessionId,
    childProfileId: r.childProfileId || childId,
    childName: r.childName,
    age: r.age,
    selectedClass: r.selectedClass,
    school: r.school,
    overallAccuracy: r.overallAccuracy,
    totalDurationMs: r.totalDurationMs,
    gameSummaries: r.gameSummaries,
    cognitiveFacets: r.cognitiveFacets,
    growthObservations: r.growthObservations,
    schemaVersion: r.schemaVersion,
    generatedAt: r.generatedAt,
  }));
}
