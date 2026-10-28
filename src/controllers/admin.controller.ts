import type { Request, Response } from "express";
import {
  listUsersQuerySchema,
  updateUserStatusParamsSchema,
  updateUserStatusBodySchema,
} from "../validators/admin.schema.js";
import { listUsers, setUserStatus } from "../services/admin.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function getUsersController(req: Request, res: Response) {
  const query = listUsersQuerySchema.parse(req.query);
  const result = await listUsers(query);
  sendSuccess(res, 200, result.users, undefined, result.meta);
}

export async function updateUserStatusController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const { id } = updateUserStatusParamsSchema.parse(req.params);
  const body = updateUserStatusBodySchema.parse(req.body);

  const updatedUser = await setUserStatus(req.authCtx.userId, id, body);
  sendSuccess(res, 200, updatedUser, "User status updated successfully");
}
