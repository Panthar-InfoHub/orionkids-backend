import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import type { CreateUserInput } from "../validators/user.schema.js";

export async function listUsers() {
  return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export async function createUser(input: CreateUserInput) {
  // A duplicate email throws Prisma P2002, which errorHandler turns into 409.
  return prisma.user.create({ data: input });
}
