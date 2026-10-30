import { z } from "zod";
import { gameKeysEnum } from "./quest.schema.js";

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["PENDING", "ACTIVE", "RESTRICTED"]).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  search: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;

export const userSessionParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  sessionId: z.string().min(1, "Session ID is required"),
});

export type UserSessionParams = z.infer<typeof userSessionParamsSchema>;

export const listQuestSessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "ABANDONED"]).optional(),
});

export type ListQuestSessionsQuery = z.infer<
  typeof listQuestSessionsQuerySchema
>;

export const listLevelAttemptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  gameKey: gameKeysEnum.optional(),
  levelNumber: z.coerce.number().int().min(1).max(3).optional(),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "ABANDONED"]).optional(),
});

export type ListLevelAttemptsQuery = z.infer<
  typeof listLevelAttemptsQuerySchema
>;

export const updateUserStatusParamsSchema = z.object({
  id: z.string().min(1, "User ID is required"),
});

export type UpdateUserStatusParams = z.infer<
  typeof updateUserStatusParamsSchema
>;

export const updateUserStatusBodySchema = z
  .object({
    status: z.enum(["ACTIVE", "RESTRICTED"]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (data) =>
      data.status !== "RESTRICTED" ||
      (typeof data.reason === "string" && data.reason.length >= 3),
    {
      message:
        "Reason is required (3-500 characters) when restricting an account",
      path: ["reason"],
    }
  );

export type UpdateUserStatusBody = z.infer<typeof updateUserStatusBodySchema>;


export const userChildParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  childProfileId: z.string().min(1, "Child Profile ID is required"),
});

export type UserChildParams = z.infer<typeof userChildParamsSchema>;

export const userChildSessionParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  childProfileId: z.string().min(1, "Child Profile ID is required"),
  sessionId: z.string().min(1, "Session ID is required"),
});

export type UserChildSessionParams = z.infer<typeof userChildSessionParamsSchema>;

export const sessionIdParamSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
});

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;
