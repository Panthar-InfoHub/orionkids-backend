import { z } from "zod";

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(["PENDING", "ACTIVE", "RESTRICTED"]).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

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
