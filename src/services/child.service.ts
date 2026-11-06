import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type {
  CreateChildInput,
  UpdateChildInput,
} from "../validators/child.schema.js";
import { computeSessionProgression } from "./quest.service.js";
import { idempotencyRegistry } from "../utils/idempotency.js";
import { assertChildOwnership } from "../utils/ownership.js";
import {
  collectReportPdfKeys,
  deleteStoredPdfs,
  effectiveEmailStatus,
  resendReportEmail,
} from "./reportDelivery.service.js";
import {
  CANONICAL_GAMES,
  TOTAL_GAMES,
  LEVELS_PER_GAME,
  TOTAL_LEVELS,
} from "../config/games.js";

export async function createChildProfile(
  userId: string,
  input: CreateChildInput,
  idempotencyKey?: string
) {
  const effectiveIdempotencyKey = idempotencyKey || input.idempotencyKey;
  if (effectiveIdempotencyKey) {
    const lock = await idempotencyRegistry.acquireLock<any>(
      userId,
      "createChildProfile",
      effectiveIdempotencyKey
    );
    if (lock.isCached && lock.result) {
      return lock.result;
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
    await idempotencyRegistry.saveResult(
      userId,
      "createChildProfile",
      effectiveIdempotencyKey,
      result,
      201
    );
  }

  logger.info(
    {
      userId,
      childProfileId: result.id,
      childName: result.childName,
      initialSessionId: result.initialSessionId,
    },
    "child.profile_created"
  );

  return result;
}

export async function listChildren(userId: string) {
  const children = await prisma.childProfile.findMany({
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
          lastActivityAt: true,
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
    let hasInProgress = Boolean(inProgressSession);
    let totalCompletedQuests = completedSessions.length;

    if (inProgressSession) {
      const prog = computeSessionProgression(
        inProgressSession,
        inProgressSession.levelAttempts
      );
      if (prog.isQuestComplete || prog.highestCompletedIndex >= 18) {
        hasInProgress = false;
        totalCompletedQuests = Math.max(1, totalCompletedQuests + 1);
        completedLevelsCount = 18;
        progressOverall = 100;
        currentStage = "COMPLETED";
        currentGame = 6;
        currentLevel = 3;
      } else if (
        completedSessions.length > 0 &&
        inProgressSession.levelAttempts.length === 0
      ) {
        hasInProgress = false;
        completedLevelsCount = 18;
        progressOverall = 100;
        currentStage = "COMPLETED";
        currentGame = 6;
        currentLevel = 3;
      } else {
        completedLevelsCount = prog.highestCompletedIndex;
        progressOverall = Math.round((completedLevelsCount / 18) * 100);
        currentStage = inProgressSession.currentStage;
        currentGame = prog.currentGame;
        currentLevel = prog.currentLevel;
      }
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
        completedQuests: totalCompletedQuests,
        hasInProgressQuest: hasInProgress,
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
        select: {
          id: true,
          status: true,
          currentStage: true,
          currentGame: true,
          currentLevel: true,
          lastActivityAt: true,
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
  let hasInProgress = Boolean(inProgressSession);
  let totalCompletedQuests = completedSessions.length;

  if (inProgressSession) {
    const prog = computeSessionProgression(
      inProgressSession,
      inProgressSession.levelAttempts
    );
    if (prog.isQuestComplete || prog.highestCompletedIndex >= 18) {
      hasInProgress = false;
      totalCompletedQuests = Math.max(1, totalCompletedQuests + 1);
      completedLevelsCount = 18;
      progressOverall = 100;
      currentStage = "COMPLETED";
      currentGame = 6;
      currentLevel = 3;
    } else if (
      completedSessions.length > 0 &&
      inProgressSession.levelAttempts.length === 0
    ) {
      hasInProgress = false;
      completedLevelsCount = 18;
      progressOverall = 100;
      currentStage = "COMPLETED";
      currentGame = 6;
      currentLevel = 3;
    } else {
      completedLevelsCount = prog.highestCompletedIndex;
      progressOverall = Math.round((completedLevelsCount / 18) * 100);
      currentStage = inProgressSession.currentStage;
      currentGame = prog.currentGame;
      currentLevel = prog.currentLevel;
    }
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
      completedQuests: totalCompletedQuests,
      hasInProgressQuest: hasInProgress,
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
  await assertChildOwnership(userId, childId);

  const updated = await prisma.childProfile.update({
    where: { id: childId },
    data: {
      ...(input.childName !== undefined && { childName: input.childName }),
      ...(input.age !== undefined && { age: input.age }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.school !== undefined && { school: input.school }),
      ...(input.selectedClass !== undefined && {
        selectedClass: input.selectedClass,
      }),
      ...(input.studentId !== undefined && { studentId: input.studentId }),
      ...(input.parentMobile !== undefined && {
        parentMobile: input.parentMobile,
      }),
    },
  });

  logger.info(
    {
      userId,
      childId,
      updatedFields: Object.keys(input),
    },
    "child.profile_updated"
  );

  return updated;
}

export async function getChildProgress(userId: string, childId: string) {
  // Parallelize child profile ownership check with in-progress quest session lookup
  const [child, inProgressSession] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childId },
      select: {
        id: true,
        userId: true,
        childName: true,
        age: true,
        selectedClass: true,
        school: true,
      },
    }),
    prisma.questSession.findFirst({
      where: { childProfileId: childId, userId, status: "IN_PROGRESS" },
      include: {
        warmUpSubmission: {
          select: { id: true, completedAt: true },
        },
        levelAttempts: {
          where: { status: "COMPLETED" },
          orderBy: [{ completedAt: "desc" }],
          select: {
            id: true,
            gameId: true,
            gameKey: true,
            levelNumber: true,
            accuracy: true,
            durationMs: true,
            averageReactionTimeMs: true,
            completedAt: true,
          },
        },
        questReport: {
          select: { id: true },
        },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "You do not have access to this child profile",
      "ACCESS_DENIED"
    );
  }

  const completedSession = await prisma.questSession.findFirst({
    where: { childProfileId: childId, userId, status: "COMPLETED" },
    include: {
      warmUpSubmission: {
        select: { id: true, completedAt: true },
      },
      levelAttempts: {
        where: { status: "COMPLETED" },
        orderBy: [{ completedAt: "desc" }],
        select: {
          id: true,
          gameId: true,
          gameKey: true,
          levelNumber: true,
          accuracy: true,
          durationMs: true,
          averageReactionTimeMs: true,
          completedAt: true,
        },
      },
      questReport: {
        select: { id: true },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  let session = inProgressSession;

  if (!session) {
    session = completedSession;
  } else if (
    completedSession &&
    inProgressSession?.levelAttempts.length === 0
  ) {
    // If the child completed an authoritative quest session, and inProgressSession is just starting or empty,
    // display the completed session matrix!
    session = completedSession;
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
        !prog.isQuestComplete &&
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
    status: prog.isQuestComplete ? "COMPLETED" : session.status,
    currentStage: prog.currentStage,
    currentGame: prog.currentGame,
    currentLevel: prog.currentLevel,
    completedLevelsCount: prog.highestCompletedIndex,
    totalLevelsCount: 18,
    progressPercentage: Math.round((prog.highestCompletedIndex / 18) * 100),
    matrix,
    recentAttempts: session.levelAttempts.slice(0, 10),
    hasReport: Boolean(session.questReport),
    reportId: session.questReport?.id || null,
  };
}

export async function getChildQuestSessions(userId: string, childId: string) {
  const [child, sessions] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childId },
      select: { id: true, userId: true },
    }),
    prisma.questSession.findMany({
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
            emailStatus: true,
            emailRecipient: true,
            emailSentAt: true,
            emailError: true,
            updatedAt: true,
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
    }),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "You do not have access to this child profile",
      "ACCESS_DENIED"
    );
  }

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
      report: s.questReport
        ? {
            id: s.questReport.id,
            overallAccuracy: s.questReport.overallAccuracy,
            totalDurationMs: s.questReport.totalDurationMs,
            generatedAt: s.questReport.generatedAt,
            emailStatus: effectiveEmailStatus(s.questReport),
            emailRecipient: s.questReport.emailRecipient,
            emailSentAt: s.questReport.emailSentAt,
            emailError: s.questReport.emailError,
          }
        : null,
    };
  });
}

export async function getChildReports(userId: string, childId: string) {
  const [child, reports] = await Promise.all([
    prisma.childProfile.findUnique({
      where: { id: childId },
      select: { id: true, userId: true },
    }),
    prisma.questReport.findMany({
      where: {
        userId,
        OR: [
          { childProfileId: childId },
          { questSession: { childProfileId: childId } },
        ],
      },
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        questSessionId: true,
        childProfileId: true,
        childName: true,
        age: true,
        selectedClass: true,
        school: true,
        overallAccuracy: true,
        totalDurationMs: true,
        gameSummaries: true,
        cognitiveFacets: true,
        growthObservations: true,
        aiReport: true,
        status: true,
        modelName: true,
        schemaVersion: true,
        generatedAt: true,
        emailStatus: true,
        emailRecipient: true,
        emailSentAt: true,
        emailError: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!child) {
    throw new NotFoundError("Child profile not found");
  }

  if (child.userId !== userId) {
    throw new ForbiddenError(
      "You do not have access to this child profile",
      "ACCESS_DENIED"
    );
  }

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
    aiReport: r.aiReport,
    status: r.status,
    modelName: r.modelName,
    schemaVersion: r.schemaVersion,
    generatedAt: r.generatedAt,
    emailStatus: effectiveEmailStatus(r),
    emailRecipient: r.emailRecipient,
    emailSentAt: r.emailSentAt,
    emailError: r.emailError,
  }));
}

export async function listAllParentReports(userId: string) {
  const reports = await prisma.questReport.findMany({
    where: { userId },
    orderBy: { generatedAt: "desc" },
    include: {
      questSession: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          startedAt: true,
        },
      },
      childProfile: {
        select: {
          id: true,
          childName: true,
          selectedClass: true,
          age: true,
        },
      },
    },
  });

  return reports.map((r) => ({
    id: r.id,
    questSessionId: r.questSessionId,
    childProfileId: r.childProfileId || r.childProfile?.id || null,
    childName: r.childName,
    age: r.age,
    selectedClass: r.selectedClass,
    school: r.school,
    overallAccuracy: r.overallAccuracy,
    totalDurationMs: r.totalDurationMs,
    gameSummaries: r.gameSummaries,
    cognitiveFacets: r.cognitiveFacets,
    growthObservations: r.growthObservations,
    aiReport: r.aiReport,
    status: r.status,
    modelName: r.modelName,
    questCompletedAt: r.questSession?.completedAt || null,
    generatedAt: r.generatedAt,
  }));
}

export async function deleteChildProfile(userId: string, childId: string) {
  await assertChildOwnership(userId, childId);

  // This child's reports. (Existing behaviour is kept: report rows are NOT deleted with the child,
  // their childProfileId is just set to null.) Collect them BEFORE the child row disappears.
  const reportWhere = {
    userId,
    OR: [{ childProfileId: childId }, { questSession: { childProfileId: childId } }],
  };
  const pdfKeys = await collectReportPdfKeys(reportWhere);
  const reportIds = (
    await prisma.questReport.findMany({ where: reportWhere, select: { id: true } })
  ).map((r) => r.id);

  await prisma.$transaction(async (tx) => {
    // Emailed links must stop working once the child is deleted
    if (reportIds.length > 0) {
      await tx.reportShareLink.updateMany({
        where: { questReportId: { in: reportIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.questReport.updateMany({
        where: { id: { in: reportIds } },
        data: { pdfStorageKey: null, pdfGeneratedAt: null },
      });
    }
    await tx.childProfile.delete({
      where: { id: childId },
    });
  });

  // Remove the stored PDFs (failures are logged, never block the deletion)
  await deleteStoredPdfs(pdfKeys);

  logger.info({ userId, childId, pdfsRemoved: pdfKeys.length }, "child.profile_deleted");

  return { success: true, message: "Child profile deleted successfully" };
}

/**
 * School/parent account: resend the report email for one of THEIR child's quest sessions.
 */
export async function resendChildReportEmail(
  userId: string,
  childId: string,
  sessionId: string
) {
  await assertChildOwnership(userId, childId);

  const report = await prisma.questReport.findFirst({
    where: {
      questSessionId: sessionId,
      userId,
      OR: [{ childProfileId: childId }, { questSession: { childProfileId: childId } }],
    },
    select: { id: true },
  });

  if (!report) {
    throw new NotFoundError("Quest assessment report not found for this child");
  }

  return resendReportEmail(report.id);
}
