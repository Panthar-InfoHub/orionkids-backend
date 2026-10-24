import { z } from "zod";

export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
