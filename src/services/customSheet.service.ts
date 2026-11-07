import { prisma, type Prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { NotFoundError } from "../utils/errors.js";
import type {
  CreateCustomSheetRequestBody,
  ListCustomSheetRequestsQuery,
  UpdateCustomSheetRequestBody,
} from "../validators/customSheet.schema.js";

/**
 * Store a public "Request Custom Sheet" submission.
 * Returns null when the honeypot field was filled (bot) — the caller still
 * answers "success" so bots learn nothing.
 */
export async function createCustomSheetRequest(
  input: CreateCustomSheetRequestBody
) {
  if (input.website && input.website.trim() !== "") {
    logger.warn("custom_sheet_request.honeypot_triggered");
    return null;
  }

  const request = await prisma.customSheetRequest.create({
    data: {
      name: input.name,
      email: input.email,
      requesterRole: input.requesterRole,
      organizationName: input.organizationName ?? null,
      phone: input.phone ?? null,
      gradeLevel: input.gradeLevel,
      sheetType: input.sheetType ?? null,
      details: input.details,
    },
    select: { id: true, createdAt: true },
  });

  logger.info(
    { requestId: request.id, requesterRole: input.requesterRole },
    "custom_sheet_request.created"
  );

  return request;
}

/** Admin: paginated list with status filter and text search. */
export async function listCustomSheetRequests(
  query: ListCustomSheetRequestsQuery
) {
  const { page, limit, status, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.CustomSheetRequestWhereInput = {};

  if (status && status !== "ALL") {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { organizationName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { details: { contains: search, mode: "insensitive" } },
      { id: { contains: search } },
    ];
  }

  const [total, requests] = await Promise.all([
    prisma.customSheetRequest.count({ where }),
    prisma.customSheetRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
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

/** Admin: change status and/or internal note. */
export async function updateCustomSheetRequest(
  adminId: string,
  requestId: string,
  input: UpdateCustomSheetRequestBody
) {
  const existing = await prisma.customSheetRequest.findUnique({
    where: { id: requestId },
    select: { id: true },
  });

  if (!existing) {
    throw new NotFoundError("Custom sheet request not found");
  }

  const data: Prisma.CustomSheetRequestUpdateInput = {
    reviewedById: adminId,
    reviewedAt: new Date(),
  };
  if (input.status !== undefined) data.status = input.status;
  if (input.adminNote !== undefined) {
    data.adminNote = input.adminNote ? input.adminNote : null;
  }

  const updated = await prisma.customSheetRequest.update({
    where: { id: requestId },
    data,
  });

  logger.info(
    { adminId, requestId, status: input.status },
    "custom_sheet_request.updated"
  );

  return updated;
}

/** Number of requests nobody has looked at yet (for the admin tab badge). */
export function countNewCustomSheetRequests() {
  return prisma.customSheetRequest.count({ where: { status: "NEW" } });
}
