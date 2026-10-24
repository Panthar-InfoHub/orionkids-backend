import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  createUserSchema,
  userIdParamSchema,
} from "../validators/user.schema.js";
import {
  createUser,
  getUserById,
  listUsers,
} from "../services/user.service.js";

export const listUsersHandler = asyncHandler(async (_req, res) => {
  const users = await listUsers();
  sendSuccess(res, 200, users);
});

export const getUserHandler = asyncHandler(async (req, res) => {
  // A ZodError thrown here becomes a 400 in errorHandler.
  const { id } = userIdParamSchema.parse(req.params);
  const user = await getUserById(id);
  sendSuccess(res, 200, user);
});

export const createUserHandler = asyncHandler(async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const user = await createUser(input);
  sendSuccess(res, 201, user, "User created");
});
