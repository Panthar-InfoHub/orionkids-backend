import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type {
  ListUsersQuery,
  UpdateUserStatusBody,
  ListQuestSessionsQuery,
  ListLevelAttemptsQuery,
} from "../validators/admin.schema.js";
import { computeSessionProgression } from "./quest.service.js";

export const CANONICAL_GAMES = [
  { gameId: 1, gameKey: "stroop", name: "Stroop Colour-Word" },
  { gameId: 2, gameKey: "card-flip", name: "Card Flip Memory" },
  { gameId: 3, gameKey: "pattern", name: "Pattern Recognition" },
  { gameId: 4, gameKey: "odd-one-out", name: "Odd One Out" },
  { gameId: 5, gameKey: "rule-discovery", name: "Rule Discovery" },
  { gameId: 6, gameKey: "story-sequencing", name: "Story Sequencing" },
] as const;

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
        onboardingSubmittedAt: { not: null },
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
  const where: any = {};
  if (query.status) {
    where.status = query.status;
    if (query.status === "PENDING") {
      where.onboardingSubmittedAt = { not: null };
    }
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

    let sessionStatus: "IN_PROGRESS" | "COMPLETED" | "NOT_STARTED" | "ABANDONED" = "NOT_STARTED";
    let completedLevels = 0;

    if (inProgress) {
      sessionStatus = "IN_PROGRESS";
      const prog = computeSessionProgression(inProgress, inProgress.levelAttempts);
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
      reportId: sessions.find((s) => Boolean(s.questReport))?.questReport?.id || null,
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
  const where: any = { userId };
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
          accuracy: true,
          durationMs: true,
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
  const attemptsByGameAndLevel = new Map<string, typeof session.levelAttempts>();
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
      } else if (inProgressAttempt || isAuthorizedStage) {
        levelStatus = "IN_PROGRESS";
      }

      // Calculate best metrics
      const accuracies = levelAttempts
        .map((a) => a.accuracy)
        .filter((acc): acc is number => typeof acc === "number");
      const bestAccuracy = accuracies.length > 0 ? Math.max(...accuracies) : null;

      const completedDurations = levelAttempts
        .filter((a) => a.status === "COMPLETED" && typeof a.durationMs === "number")
        .map((a) => a.durationMs as number);
      const bestDurationMs =
        completedDurations.length > 0 ? Math.min(...completedDurations) : null;

      return {
        levelNumber,
        status: levelStatus,
        totalAttempts: levelAttempts.length,
        bestAccuracy,
        bestDurationMs,
        completedAt: completedAttempt?.completedAt || null,
        latestAttemptId: levelAttempts[levelAttempts.length - 1]?.id || null,
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
  const where: any = { questSessionId: sessionId };
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
      select: { id: true, userId: true },
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

  return {
    attempts,
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
export async function getUserSessionReport(
  userId: string,
  sessionId: string
) {
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
    message: "Quest is completed, but final assessment report has not yet been generated.",
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
export async function getUserChildDetail(userId: string, childProfileId: string) {
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
  const inProgress = sessions.find((s) => s.status === "IN_PROGRESS");
  const completed = sessions.filter((s) => s.status === "COMPLETED");
  const abandoned = sessions.filter((s) => s.status === "ABANDONED");
  const latest = sessions[0];

  let sessionStatus: "IN_PROGRESS" | "COMPLETED" | "NOT_STARTED" | "ABANDONED" = "NOT_STARTED";
  let completedLevels = 0;

  if (inProgress) {
    sessionStatus = "IN_PROGRESS";
    const prog = computeSessionProgression(inProgress, inProgress.levelAttempts);
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
      inProgressSessions: inProgress ? 1 : 0,
      abandonedSessions: abandoned.length,
      completedLevels,
      sessionStatus,
      latestActivityAt: latest?.lastActivityAt || child.updatedAt,
      hasReport: sessions.some((s) => Boolean(s.questReport)),
      reportId: sessions.find((s) => Boolean(s.questReport))?.questReport?.id || null,
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
  const where: any = {
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
