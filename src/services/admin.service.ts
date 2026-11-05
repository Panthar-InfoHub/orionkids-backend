import { prisma, type Prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type {
  ListUsersQuery,
  UpdateUserStatusBody,
  ListQuestSessionsQuery,
  ListLevelAttemptsQuery,
  ListReportsQuery,
} from "../validators/admin.schema.js";
import {
  computeSessionProgression,
  generateOrGetReport,
  getReportPdfBuffer,
} from "./quest.service.js";
import type { ListAccessRequestsQuery } from "../validators/registration.schema.js";
import {
  CANONICAL_GAMES,
  TOTAL_GAMES,
  LEVELS_PER_GAME,
  TOTAL_LEVELS,
} from "../config/games.js";

/**
 * High-level administrative overview and aggregate system metrics.
 * Uses consolidated group-by aggregations to minimize round-trips.
 */
export async function getAdminOverview() {
  const [
    userStatusGroups,
    adminUsers,
    pendingSubmittedUsers,
    totalChildren,
    sessionStatusGroups,
    recentCompletions,
    recentUsers,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({
      where: {
        status: "PENDING",
      },
    }),
    prisma.childProfile.count(),
    prisma.questSession.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.questSession.findMany({
      where: { status: "COMPLETED" },
      take: 6,
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        completedAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        questReport: {
          select: {
            id: true,
            overallAccuracy: true,
            totalDurationMs: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  let totalUsers = 0;
  let activeUsers = 0;
  let restrictedUsers = 0;
  for (const g of userStatusGroups) {
    totalUsers += g._count._all;
    if (g.status === "ACTIVE") activeUsers = g._count._all;
    if (g.status === "RESTRICTED") restrictedUsers = g._count._all;
  }

  let totalSessions = 0;
  let completedSessions = 0;
  let inProgressSessions = 0;
  let abandonedSessions = 0;
  for (const g of sessionStatusGroups) {
    totalSessions += g._count._all;
    if (g.status === "COMPLETED") completedSessions = g._count._all;
    if (g.status === "IN_PROGRESS") inProgressSessions = g._count._all;
    if (g.status === "ABANDONED") abandonedSessions = g._count._all;
  }

  return {
    accounts: {
      total: totalUsers,
      pending: pendingSubmittedUsers,
      active: activeUsers,
      restricted: restrictedUsers,
      admins: adminUsers,
      regularUsers: totalUsers - adminUsers,
    },
    children: {
      total: totalChildren,
    },
    sessions: {
      total: totalSessions,
      completed: completedSessions,
      inProgress: inProgressSessions,
      abandoned: abandonedSessions,
    },
    recentCompletions: recentCompletions.map((s) => ({
      sessionId: s.id,
      userId: s.userId,
      userName: s.user.name,
      userEmail: s.user.email,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      reportId: s.questReport?.id || null,
      overallAccuracy: s.questReport?.overallAccuracy ?? null,
      totalDurationMs: s.questReport?.totalDurationMs ?? null,
    })),
    recentRegistrations: recentUsers,
  };
}

/**
 * Filtered, paginated list of registered users.
 */
export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {};
  if (query.status) {
    where.status = query.status;
  }

  if (query.role) {
    where.role = query.role;
  }

  const search = query.search || query.q;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { id: search },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        restrictedReason: true,
        reviewedAt: true,
        reviewedById: true,
        onboardingSubmittedAt: true,
        createdAt: true,
        updatedAt: true,
        childProfiles: {
          select: {
            id: true,
            childName: true,
            age: true,
            language: true,
            school: true,
            selectedClass: true,
            studentId: true,
            parentEmail: true,
            parentMobile: true,
            isGuardian: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            questSessions: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((u) => ({
      ...u,
      childProfile: u.childProfiles[0] || null,
      childProfiles: u.childProfiles,
      questSessionCount: u._count.questSessions,
    })),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Retrieve comprehensive 360° overview of a single user.
 * Executes 2 concurrent queries instead of 6 sequential round-trips.
 */
export async function getUserDetail(userId: string) {
  const [user, allUserSessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        restrictedReason: true,
        reviewedAt: true,
        reviewedById: true,
        onboardingSubmittedAt: true,
        createdAt: true,
        updatedAt: true,
        childProfiles: {
          select: {
            id: true,
            childName: true,
            age: true,
            language: true,
            school: true,
            selectedClass: true,
            studentId: true,
            parentEmail: true,
            parentMobile: true,
            isGuardian: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        accounts: {
          select: {
            id: true,
            providerId: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.questSession.findMany({
      where: { userId },
      orderBy: { lastActivityAt: "desc" },
      select: {
        id: true,
        status: true,
        currentStage: true,
        currentGame: true,
        currentLevel: true,
        startedAt: true,
        lastActivityAt: true,
        completedAt: true,
        levelAttempts: {
          where: { status: "COMPLETED" },
          select: { gameKey: true, levelNumber: true },
        },
      },
    }),
  ]);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const totalSessions = allUserSessions.length;
  let completedSessions = 0;
  let inProgressSessions = 0;
  let abandonedSessions = 0;
  let totalCompletedLevels = 0;

  for (const s of allUserSessions) {
    if (s.status === "COMPLETED") completedSessions += 1;
    else if (s.status === "IN_PROGRESS") inProgressSessions += 1;
    else if (s.status === "ABANDONED") abandonedSessions += 1;

    const prog = computeSessionProgression(s, s.levelAttempts);
    totalCompletedLevels += prog.highestCompletedIndex;
  }

  const firstSession = allUserSessions[0];
  const latestSession = firstSession
    ? {
        id: firstSession.id,
        status: firstSession.status,
        currentStage: firstSession.currentStage,
        currentGame: firstSession.currentGame,
        currentLevel: firstSession.currentLevel,
        startedAt: firstSession.startedAt,
        lastActivityAt: firstSession.lastActivityAt,
        completedAt: firstSession.completedAt,
      }
    : null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      status: user.status,
      restrictedReason: user.restrictedReason,
      reviewedAt: user.reviewedAt,
      reviewedById: user.reviewedById,
      onboardingSubmittedAt: user.onboardingSubmittedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      childProfile: user.childProfiles[0] || null,
      childProfiles: user.childProfiles,
      accounts: user.accounts.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        createdAt: a.createdAt,
      })),
    },
    stats: {
      childProfileCount: user.childProfiles.length,
      totalSessions,
      completedSessions,
      inProgressSessions,
      abandonedSessions,
      totalCompletedLevels,
      latestActivityAt: latestSession?.lastActivityAt || user.updatedAt,
      latestSession,
    },
  };
}

/**
 * Retrieve child profile(s) scoped to a parent account with comprehensive quest analytics.
 * Parallelizes user validation and child listing with scoped relation loading.
 */
export async function getUserChildren(userId: string) {
  const [user, children] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    }),
    prisma.childProfile.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: {
        questSessions: {
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            status: true,
            currentStage: true,
            currentGame: true,
            currentLevel: true,
            startedAt: true,
            lastActivityAt: true,
            completedAt: true,
            questReport: { select: { id: true } },
            levelAttempts: {
              where: { status: "COMPLETED" },
              select: { gameKey: true, levelNumber: true },
            },
          },
        },
      },
    }),
  ]);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  return children.map((c) => {
    const sessions = c.questSessions || [];
    const inProgress = sessions.find((s) => s.status === "IN_PROGRESS");
    const completed = sessions.filter((s) => s.status === "COMPLETED");
    const latest = sessions[0];

    let sessionStatus:
      "IN_PROGRESS" | "COMPLETED" | "NOT_STARTED" | "ABANDONED" = "NOT_STARTED";
    let completedLevels = 0;

    if (inProgress) {
      sessionStatus = "IN_PROGRESS";
      const prog = computeSessionProgression(
        inProgress,
        inProgress.levelAttempts
      );
      completedLevels = prog.highestCompletedIndex;
    } else if (completed.length > 0) {
      sessionStatus = "COMPLETED";
      completedLevels = 18;
    } else if (sessions.length > 0 && latest) {
      sessionStatus = latest.status as any;
    }

    return {
      id: c.id,
      userId: c.userId,
      childName: c.childName,
      age: c.age,
      language: c.language,
      school: c.school,
      selectedClass: c.selectedClass,
      studentId: c.studentId,
      parentEmail: c.parentEmail,
      parentMobile: c.parentMobile,
      isGuardian: c.isGuardian,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      totalSessions: sessions.length,
      sessionStatus,
      completedLevels,
      latestActivityAt: latest?.lastActivityAt || c.updatedAt,
      hasReport: sessions.some((s) => Boolean(s.questReport)),
      reportId:
        sessions.find((s) => Boolean(s.questReport))?.questReport?.id || null,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        currentStage: s.currentStage,
        currentGame: s.currentGame,
        currentLevel: s.currentLevel,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        hasReport: Boolean(s.questReport),
      })),
    };
  });
}

/**
 * Retrieve all quest sessions for a specific user with pagination, child metadata, and status filtering.
 */
export async function getUserQuestSessions(
  userId: string,
  query: ListQuestSessionsQuery
) {
  const where: Prisma.QuestSessionWhereInput = { userId };
  if (query.status) {
    where.status = query.status;
  }

  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const [user, [sessions, total]] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    }),
    Promise.all([
      prisma.questSession.findMany({
        where,
        skip,
        take,
        orderBy: { startedAt: "desc" },
        include: {
          childProfile: {
            select: {
              id: true,
              childName: true,
              selectedClass: true,
            },
          },
          warmUpSubmission: {
            select: {
              id: true,
              completedAt: true,
            },
          },
          questReport: {
            select: {
              id: true,
              generatedAt: true,
              overallAccuracy: true,
              totalDurationMs: true,
            },
          },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: {
              gameKey: true,
              levelNumber: true,
              status: true,
            },
          },
          _count: {
            select: {
              levelAttempts: true,
            },
          },
        },
      }),
      prisma.questSession.count({ where }),
    ]),
  ]);

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const formattedSessions = sessions.map((s) => {
    const prog = computeSessionProgression(s, s.levelAttempts);
    return {
      id: s.id,
      userId: s.userId,
      childProfileId: s.childProfileId || null,
      childName: s.childProfile?.childName || null,
      status: s.status,
      currentStage: s.currentStage,
      currentGame: s.currentGame,
      currentLevel: s.currentLevel,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      completedAt: s.completedAt,
      abandonedAt: s.abandonedAt,
      warmUpCompleted: Boolean(s.warmUpSubmission),
      completedLevelsCount: prog.highestCompletedIndex,
      totalLevels: 18,
      hasReport: Boolean(s.questReport),
      report: s.questReport
        ? {
            id: s.questReport.id,
            generatedAt: s.questReport.generatedAt,
            overallAccuracy: s.questReport.overallAccuracy,
            totalDurationMs: s.questReport.totalDurationMs,
          }
        : null,
      totalAttemptsCount: s._count.levelAttempts,
    };
  });

  return {
    sessions: formattedSessions,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Retrieve comprehensive progression matrix, checkpoints, and attempt history for a specific quest session.
 * Excludes large raw trialRecords and metrics arrays from this summary inspection endpoint.
 */
export async function getUserQuestSessionDetail(
  userId: string,
  sessionId: string
) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    include: {
      childProfile: {
        select: {
          id: true,
          childName: true,
          age: true,
          selectedClass: true,
        },
      },
      warmUpSubmission: true,
      questReport: true,
      levelAttempts: {
        orderBy: [{ startedAt: "asc" }, { attemptNumber: "asc" }],
        select: {
          id: true,
          gameKey: true,
          levelNumber: true,
          attemptNumber: true,
          status: true,
          totalTrials: true,
          accuracy: true,
          durationMs: true,
          metrics: true,
          trialRecords: true,
          completedAt: true,
          startedAt: true,
        },
      },
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  const completedAttempts = session.levelAttempts.filter(
    (a) => a.status === "COMPLETED"
  );
  const prog = computeSessionProgression(session, completedAttempts);

  // Group attempts by gameKey & levelNumber
  const attemptsByGameAndLevel = new Map<
    string,
    typeof session.levelAttempts
  >();
  for (const attempt of session.levelAttempts) {
    const key = `${attempt.gameKey}-${attempt.levelNumber}`;
    if (!attemptsByGameAndLevel.has(key)) {
      attemptsByGameAndLevel.set(key, []);
    }
    attemptsByGameAndLevel.get(key)!.push(attempt);
  }

  // Construct authoritative 6-game progression matrix
  const gamesProgress = CANONICAL_GAMES.map((game) => {
    let completedLevelsForGame = 0;

    const levels = [1, 2, 3].map((levelNumber) => {
      const key = `${game.gameKey}-${levelNumber}`;
      const levelAttempts = attemptsByGameAndLevel.get(key) || [];

      const completedAttempt = levelAttempts.find(
        (a) => a.status === "COMPLETED"
      );
      const inProgressAttempt = levelAttempts.find(
        (a) => a.status === "IN_PROGRESS"
      );

      const isCompleted = Boolean(completedAttempt);
      if (isCompleted) {
        completedLevelsForGame += 1;
      }

      // Check if this level is currently in-progress or authorized
      const levelGlobalIndex = (game.gameId - 1) * 3 + levelNumber;
      const isAuthorizedStage =
        !isCompleted &&
        session.status === "IN_PROGRESS" &&
        levelGlobalIndex === prog.authorizedIndex;

      let levelStatus: "COMPLETED" | "IN_PROGRESS" | "LOCKED" = "LOCKED";
      if (isCompleted) {
        levelStatus = "COMPLETED";
      } else if (
        (inProgressAttempt || isAuthorizedStage) &&
        session.status === "IN_PROGRESS" &&
        !prog.isQuestComplete
      ) {
        levelStatus = "IN_PROGRESS";
      }

      // Calculate best metrics strictly from valid completed attempts
      const completedAttemptsForLevel = levelAttempts.filter(
        (a) => a.status === "COMPLETED"
      );
      const accuracies = completedAttemptsForLevel
        .map((a) => a.accuracy)
        .filter((acc): acc is number => typeof acc === "number");
      const bestAccuracy =
        accuracies.length > 0 ? Math.max(...accuracies) : null;

      const completedDurations = completedAttemptsForLevel
        .filter((a) => typeof a.durationMs === "number")
        .map((a) => a.durationMs as number);
      const bestDurationMs =
        completedDurations.length > 0 ? Math.min(...completedDurations) : null;

      // Exclude technical duplicate attempts from total attempts count
      const isTechnicalDuplicate = (a: (typeof levelAttempts)[0]) => {
        if ((a.metrics as any)?.technicalDuplicate) return true;
        if (!isCompleted) return false;
        if (a.status === "COMPLETED") return false;
        const noTrials = !a.totalTrials || a.totalTrials === 0;
        const noAccuracy = a.accuracy === null;
        const noDuration = !a.durationMs || a.durationMs === 0;
        const noCheckpoint = !(a.metrics as any)?.checkpoint;
        return noTrials && noAccuracy && noDuration && noCheckpoint;
      };
      const genuineAttempts = levelAttempts.filter(
        (a) => !isTechnicalDuplicate(a)
      );

      return {
        levelNumber,
        status: levelStatus,
        totalAttempts: genuineAttempts.length,
        bestAccuracy,
        bestDurationMs,
        completedAt: completedAttempt?.completedAt || null,
        latestAttemptId:
          genuineAttempts[genuineAttempts.length - 1]?.id || null,
      };
    });

    return {
      gameId: game.gameId,
      gameKey: game.gameKey,
      name: game.name,
      completedLevels: completedLevelsForGame,
      totalLevels: 3,
      isGameCompleted: completedLevelsForGame === 3,
      levels,
    };
  });

  return {
    session: {
      id: session.id,
      userId: session.userId,
      childProfileId: session.childProfileId || null,
      childName: session.childProfile?.childName || null,
      status: session.status,
      currentStage: session.currentStage,
      currentGame: session.currentGame,
      currentLevel: session.currentLevel,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      completedAt: session.completedAt,
      abandonedAt: session.abandonedAt,
      completedLevelsCount: prog.highestCompletedIndex,
      totalLevels: 18,
      isQuestComplete: prog.isQuestComplete,
    },
    warmUp: session.warmUpSubmission
      ? {
          id: session.warmUpSubmission.id,
          completedAt: session.warmUpSubmission.completedAt,
          answers: session.warmUpSubmission.answers,
        }
      : null,
    report: session.questReport
      ? {
          id: session.questReport.id,
          generatedAt: session.questReport.generatedAt,
          overallAccuracy: session.questReport.overallAccuracy,
          totalDurationMs: session.questReport.totalDurationMs,
        }
      : null,
    progression: {
      highestCompletedIndex: prog.highestCompletedIndex,
      authorizedCurrentGame: prog.currentGame,
      authorizedCurrentLevel: prog.currentLevel,
      isQuestComplete: prog.isQuestComplete,
      games: gamesProgress,
    },
    attemptsSummary: {
      totalAttempts: session.levelAttempts.length,
      completedAttempts: completedAttempts.length,
      inProgressAttempts: session.levelAttempts.filter(
        (a) => a.status === "IN_PROGRESS"
      ).length,
      abandonedAttempts: session.levelAttempts.filter(
        (a) => a.status === "ABANDONED"
      ).length,
    },
  };
}

/**
 * Retrieve level attempts and raw gameplay telemetry for a quest session.
 * Parallelizes ownership verification and paginated attempt queries.
 */
export async function getUserSessionAttempts(
  userId: string,
  sessionId: string,
  query: ListLevelAttemptsQuery
) {
  const where: Prisma.LevelAttemptWhereInput = { questSessionId: sessionId };
  if (query.gameKey) {
    where.gameKey = query.gameKey;
  }
  if (query.levelNumber) {
    where.levelNumber = query.levelNumber;
  }
  if (query.status) {
    where.status = query.status;
  }

  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const [session, [attempts, total]] = await Promise.all([
    prisma.questSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, status: true },
    }),
    Promise.all([
      prisma.levelAttempt.findMany({
        where,
        skip,
        take,
        orderBy: [{ startedAt: "asc" }, { attemptNumber: "asc" }],
        select: {
          id: true,
          questSessionId: true,
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
          trialRecords: true,
          startedAt: true,
          completedAt: true,
        },
      }),
      prisma.levelAttempt.count({ where }),
    ]),
  ]);

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  const completedAttempts = await prisma.levelAttempt.findMany({
    where: { questSessionId: sessionId, status: "COMPLETED" },
    select: { gameKey: true, levelNumber: true },
  });
  const completedKeys = new Set(
    completedAttempts.map((c) => `${c.gameKey}-${c.levelNumber}`)
  );

  const formattedAttempts = attempts.map((a) => {
    let status = a.status;
    if (a.status === "IN_PROGRESS") {
      if (
        session.status === "COMPLETED" ||
        completedKeys.has(`${a.gameKey}-${a.levelNumber}`)
      ) {
        status = "ABANDONED" as const;
      }
    }

    const hasCompletedForLevel = completedKeys.has(
      `${a.gameKey}-${a.levelNumber}`
    );
    const noTrials = !a.totalTrials || a.totalTrials === 0;
    const noAccuracy = a.accuracy === null;
    const noDuration = !a.durationMs || a.durationMs === 0;
    const noCheckpoint = !(a.metrics as any)?.checkpoint;
    const noRecords = !(a.trialRecords as any)?.length;

    const isTechnicalDuplicate =
      Boolean((a.metrics as any)?.technicalDuplicate) ||
      (hasCompletedForLevel &&
        status !== "COMPLETED" &&
        noTrials &&
        noAccuracy &&
        noDuration &&
        noCheckpoint &&
        noRecords);

    return {
      ...a,
      status,
      isTechnicalDuplicate,
    };
  });

  return {
    attempts: formattedAttempts,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Retrieve the saved report for a session in a strictly read-only manner.
 * Never silently fabricates reports or mutates records.
 */
export async function getUserSessionReport(userId: string, sessionId: string) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      status: true,
      currentGame: true,
      currentLevel: true,
      questReport: true,
    },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  if (session.questReport) {
    return {
      hasReport: true,
      report: session.questReport,
    };
  }

  if (session.status !== "COMPLETED") {
    return {
      hasReport: false,
      reason: "QUEST_IN_PROGRESS",
      message: `Quest session is currently in progress (Game ${session.currentGame}, Level ${session.currentLevel}). All 18 levels must be completed before a report is available.`,
      report: null,
    };
  }

  return {
    hasReport: false,
    reason: "NOT_YET_GENERATED",
    message:
      "Quest is completed, but final assessment report has not yet been generated.",
    report: null,
  };
}

/**
 * Approve or restrict an account.
 */
export async function setUserStatus(
  adminId: string,
  targetUserId: string,
  input: UpdateUserStatusBody
) {
  if (adminId === targetUserId) {
    throw new ForbiddenError(
      "You cannot change your own account status",
      "FORBIDDEN"
    );
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    const targetUser = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, status: true },
    });

    if (!targetUser) {
      throw new NotFoundError("User not found");
    }

    if (targetUser.role === "ADMIN") {
      throw new ForbiddenError(
        "Cannot change the account status of another administrator",
        "FORBIDDEN"
      );
    }

    const user = await tx.user.update({
      where: { id: targetUserId },
      data: {
        status: input.status,
        restrictedReason: input.status === "RESTRICTED" ? input.reason : null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        status: true,
        restrictedReason: true,
        reviewedAt: true,
        reviewedById: true,
        onboardingSubmittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (input.status === "ACTIVE") {
      await tx.accessRequest.updateMany({
        where: {
          userId: targetUserId,
          status: "PENDING",
        },
        data: {
          status: "APPROVED",
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
    }

    if (input.status === "RESTRICTED") {
      await tx.session.deleteMany({
        where: { userId: targetUserId },
      });
    }

    return user;
  });

  logger.info(
    { adminId, targetId: targetUserId, status: input.status },
    "admin.user_status_changed"
  );

  return updatedUser;
}

/**
 * Retrieve comprehensive details for a single child profile scoped to a parent.
 */
export async function getUserChildDetail(
  userId: string,
  childProfileId: string
) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childProfileId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      questSessions: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          currentStage: true,
          currentGame: true,
          currentLevel: true,
          startedAt: true,
          lastActivityAt: true,
          completedAt: true,
          questReport: { select: { id: true } },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: { gameKey: true, levelNumber: true },
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
      "Child profile does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  const sessions = child.questSessions || [];
  const inProgressList = sessions.filter((s) => s.status === "IN_PROGRESS");
  const inProgress = inProgressList[0];
  const completed = sessions.filter((s) => s.status === "COMPLETED");
  const abandoned = sessions.filter((s) => s.status === "ABANDONED");
  const latest = sessions[0];

  let sessionStatus: "IN_PROGRESS" | "COMPLETED" | "NOT_STARTED" | "ABANDONED" =
    "NOT_STARTED";
  let completedLevels = 0;

  if (inProgress) {
    sessionStatus = "IN_PROGRESS";
    const prog = computeSessionProgression(
      inProgress,
      inProgress.levelAttempts
    );
    completedLevels = prog.highestCompletedIndex;
  } else if (completed.length > 0) {
    sessionStatus = "COMPLETED";
    completedLevels = 18;
  } else if (sessions.length > 0 && latest) {
    sessionStatus = latest.status as any;
  }

  return {
    id: child.id,
    userId: child.userId,
    parentName: child.user.name,
    parentEmail: child.parentEmail || child.user.email,
    childName: child.childName,
    age: child.age,
    language: child.language,
    school: child.school,
    selectedClass: child.selectedClass,
    studentId: child.studentId,
    parentMobile: child.parentMobile,
    isGuardian: child.isGuardian,
    createdAt: child.createdAt,
    updatedAt: child.updatedAt,
    stats: {
      totalSessions: sessions.length,
      completedSessions: completed.length,
      inProgressSessions: inProgressList.length,
      abandonedSessions: abandoned.length,
      completedLevels,
      sessionStatus,
      latestActivityAt: latest?.lastActivityAt || child.updatedAt,
      hasReport: sessions.some((s) => Boolean(s.questReport)),
      reportId:
        sessions.find((s) => Boolean(s.questReport))?.questReport?.id || null,
    },
  };
}

/**
 * Retrieve quest sessions strictly filtered by child profile ID and scoped to the parent.
 * Parallelizes ownership checks and paginated session listing.
 */
export async function getUserChildQuestSessions(
  userId: string,
  childProfileId: string,
  query: ListQuestSessionsQuery
) {
  const where: Prisma.QuestSessionWhereInput = {
    userId,
    childProfileId,
  };

  if (query.status) {
    where.status = query.status;
  }

  const skip = (query.page - 1) * query.limit;
  const take = query.limit;

  const [child, [sessions, total]] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childProfileId },
      select: { id: true, userId: true },
    }),
    Promise.all([
      prisma.questSession.findMany({
        where,
        skip,
        take,
        orderBy: { startedAt: "desc" },
        include: {
          childProfile: {
            select: {
              id: true,
              childName: true,
              selectedClass: true,
            },
          },
          warmUpSubmission: {
            select: {
              id: true,
              completedAt: true,
            },
          },
          questReport: {
            select: {
              id: true,
              generatedAt: true,
              overallAccuracy: true,
              totalDurationMs: true,
            },
          },
          levelAttempts: {
            where: { status: "COMPLETED" },
            select: { gameKey: true, levelNumber: true },
          },
          _count: {
            select: { levelAttempts: true },
          },
        },
      }),
      prisma.questSession.count({ where }),
    ]),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "Child profile does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  const formattedSessions = sessions.map((s) => {
    const prog = computeSessionProgression(s, s.levelAttempts);

    return {
      id: s.id,
      userId: s.userId,
      childProfileId: s.childProfileId || null,
      childName: s.childProfile?.childName || null,
      status: s.status,
      currentStage: s.currentStage,
      currentGame: s.currentGame,
      currentLevel: s.currentLevel,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      completedAt: s.completedAt,
      abandonedAt: s.abandonedAt,
      warmUpCompleted: Boolean(s.warmUpSubmission),
      completedLevelsCount: prog.highestCompletedIndex,
      totalLevels: 18,
      hasReport: Boolean(s.questReport),
      report: s.questReport
        ? {
            id: s.questReport.id,
            generatedAt: s.questReport.generatedAt,
            overallAccuracy: s.questReport.overallAccuracy,
            totalDurationMs: s.questReport.totalDurationMs,
          }
        : null,
      totalAttemptsCount: s._count.levelAttempts,
    };
  });

  return {
    sessions: formattedSessions,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/**
 * Retrieve comprehensive progression matrix for a single quest session,
 * strictly verifying that it belongs to both the user and the specified child profile.
 */
export async function getUserChildQuestSessionDetail(
  userId: string,
  childProfileId: string,
  sessionId: string
) {
  const child = await prisma.childProfile.findUnique({
    where: { id: childProfileId },
    select: { id: true, userId: true },
  });

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "Child profile does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  const detail = await getUserQuestSessionDetail(userId, sessionId);

  if (detail.session.childProfileId !== childProfileId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified child profile",
      "FORBIDDEN"
    );
  }

  return detail;
}

/**
 * Retrieve level attempts for a quest session strictly verifying ownership of child and user.
 * Runs ownership checks in parallel.
 */
export async function getUserChildSessionAttempts(
  userId: string,
  childProfileId: string,
  sessionId: string,
  query: ListLevelAttemptsQuery
) {
  const [child, session] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childProfileId },
      select: { id: true, userId: true },
    }),
    prisma.questSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, childProfileId: true },
    }),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "Child profile does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  if (session.childProfileId !== childProfileId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified child profile",
      "FORBIDDEN"
    );
  }

  return getUserSessionAttempts(userId, sessionId, query);
}

/**
 * Retrieve assessment report for a quest session strictly verifying ownership of child and user.
 * Runs ownership checks in parallel.
 */
export async function getUserChildSessionReport(
  userId: string,
  childProfileId: string,
  sessionId: string
) {
  const [child, session] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childProfileId },
      select: { id: true, userId: true },
    }),
    prisma.questSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, childProfileId: true },
    }),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "Child profile does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.userId !== userId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified user",
      "FORBIDDEN"
    );
  }

  if (session.childProfileId !== childProfileId) {
    throw new ForbiddenError(
      "Quest session does not belong to the specified child profile",
      "FORBIDDEN"
    );
  }

  return getUserSessionReport(userId, sessionId);
}

/**
 * Direct lookup for an individual quest session for admin inspection.
 */
export async function getAdminQuestSessionDetail(sessionId: string) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  return getUserQuestSessionDetail(session.userId, sessionId);
}

/**
 * Paginated list of access requests for administrative review.
 */
export async function listAccessRequests(query: ListAccessRequestsQuery) {
  const { page, limit, status, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.AccessRequestWhereInput = {};

  if (status && status !== "ALL") {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { userId: { contains: search, mode: "insensitive" } },
      {
        user: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const [total, requests] = await Promise.all([
    prisma.accessRequest.count({ where }),
    prisma.accessRequest.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: true,
            status: true,
            termsAccepted: true,
            termsVersion: true,
            termsAcceptedAt: true,
            createdAt: true,
            onboardingSubmittedAt: true,
            _count: {
              select: { childProfiles: true },
            },
          },
        },
      },
    }),
  ]);

  return {
    requests,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Approve an access request atomically and set target user to ACTIVE.
 */
export async function approveAccessRequest(adminId: string, requestId: string) {
  const request = await prisma.accessRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });

  if (!request) {
    throw new NotFoundError("Access request not found");
  }

  if (request.userId === adminId) {
    throw new ForbiddenError(
      "You cannot approve your own access request",
      "FORBIDDEN"
    );
  }

  if (request.status !== "PENDING") {
    throw new ForbiddenError(
      `Access request is already ${request.status.toLowerCase()}`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.accessRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: request.userId },
      data: {
        status: "ACTIVE",
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        reviewedAt: true,
        reviewedById: true,
      },
    });

    return { request: updatedRequest, user: updatedUser };
  });

  logger.info(
    { adminId, targetUserId: request.userId, requestId },
    "Access request approved by admin"
  );

  return result;
}

/**
 * Reject an access request with an optional reason.
 */
export async function rejectAccessRequest(
  adminId: string,
  requestId: string,
  reason?: string
) {
  const request = await prisma.accessRequest.findUnique({
    where: { id: requestId },
    include: { user: true },
  });

  if (!request) {
    throw new NotFoundError("Access request not found");
  }

  if (request.userId === adminId) {
    throw new ForbiddenError(
      "You cannot reject your own access request",
      "FORBIDDEN"
    );
  }

  if (request.status !== "PENDING") {
    throw new ForbiddenError(
      `Access request is already ${request.status.toLowerCase()}`,
      "REQUEST_ALREADY_REVIEWED"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.accessRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        rejectionReason: reason || null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: request.userId },
      data: {
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        reviewedAt: true,
        reviewedById: true,
      },
    });

    return { request: updatedRequest, user: updatedUser };
  });

  logger.info(
    { adminId, targetUserId: request.userId, requestId, reason },
    "Access request rejected by admin"
  );

  return result;
}

/**
 * Admin operation to explicitly regenerate a report for a completed quest session using OpenAI.
 */
export async function adminRegenerateReport(sessionId: string) {
  const session = await prisma.questSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, status: true },
  });

  if (!session) {
    throw new NotFoundError("Quest session not found");
  }

  if (session.status !== "COMPLETED") {
    throw new ForbiddenError(
      "Cannot generate a report for an in-progress session. All 18 levels must be completed.",
      "QUEST_INCOMPLETE"
    );
  }

  const report = await generateOrGetReport(
    session.userId,
    sessionId,
    true,
    true
  );

  logger.info(
    { sessionId, targetUserId: session.userId, reportId: report.id },
    "admin.report_regenerate_completed"
  );

  return report;
}

/**
 * Admin operation to download the PDF for any child's completed quest report.
 */
export async function adminGetReportPdf(
  sessionId: string
): Promise<Uint8Array> {
  return await getReportPdfBuffer("", sessionId, true);
}

/**
 * Admin operation to list and filter reports across all children and parents.
 */
export async function listAllQuestReports(query: ListReportsQuery) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(50, Math.max(1, query.limit || 10));
  const skip = (page - 1) * limit;

  const where: Prisma.QuestReportWhereInput = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.childProfileId) {
    where.childProfileId = query.childProfileId;
  }

  if (query.search) {
    const s = query.search.trim();
    where.OR = [
      { childName: { contains: s, mode: "insensitive" } },
      { user: { name: { contains: s, mode: "insensitive" } } },
      { user: { email: { contains: s, mode: "insensitive" } } },
    ];
  }

  const [reports, total] = await Promise.all([
    prisma.questReport.findMany({
      where,
      skip,
      take: limit,
      orderBy: { generatedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        questSession: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
        },
        childProfile: {
          select: {
            id: true,
            childName: true,
            age: true,
            selectedClass: true,
          },
        },
      },
    }),
    prisma.questReport.count({ where }),
  ]);

  return {
    reports: reports.map((r) => ({
      id: r.id,
      questSessionId: r.questSessionId,
      userId: r.userId,
      parentName: r.user.name,
      parentEmail: r.user.email,
      childProfileId: r.childProfileId,
      childName: r.childName,
      age: r.age,
      selectedClass: r.selectedClass,
      school: r.school,
      overallAccuracy: r.overallAccuracy,
      totalDurationMs: r.totalDurationMs,
      status: r.status,
      modelName: r.modelName,
      schemaVersion: r.schemaVersion,
      generatedAt: r.generatedAt,
      questCompletedAt: r.questSession?.completedAt || null,
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
