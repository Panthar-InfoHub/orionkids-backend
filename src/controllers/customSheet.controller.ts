import type { Request, Response } from "express";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";
import {
  createCustomSheetRequestBodySchema,
  listCustomSheetRequestsQuerySchema,
  customSheetRequestIdParamSchema,
  updateCustomSheetRequestBodySchema,
} from "../validators/customSheet.schema.js";
import {
  createCustomSheetRequest,
  listCustomSheetRequests,
  updateCustomSheetRequest,
} from "../services/customSheet.service.js";

const RECEIVED_MESSAGE =
  "Thank you! Your custom sheet request has been received. Our team will get back to you by email.";

/** Public: submit the "Request Custom Sheet" form (no login). */
export async function createCustomSheetRequestController(
  req: Request,
  res: Response
) {
  const body = createCustomSheetRequestBodySchema.parse(req.body);
  const created = await createCustomSheetRequest(body);

  // Honeypot hits get the same answer as real submissions
  sendSuccess(res, 201, { id: created?.id ?? null }, RECEIVED_MESSAGE);
}

/** Admin: list requests. */
export async function adminListCustomSheetRequestsController(
  req: Request,
  res: Response
) {
  const query = listCustomSheetRequestsQuerySchema.parse(req.query);
  const result = await listCustomSheetRequests(query);
  sendSuccess(
    res,
    200,
    result.requests,
    "Custom sheet requests retrieved",
    result.meta
  );
}

/** Admin: update status / internal note. */
export async function adminUpdateCustomSheetRequestController(
  req: Request,
  res: Response
) {
  const adminId = req.authCtx?.userId;
  if (!adminId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }
  const { requestId } = customSheetRequestIdParamSchema.parse(req.params);
  const body = updateCustomSheetRequestBodySchema.parse(req.body);

  const updated = await updateCustomSheetRequest(adminId, requestId, body);
  sendSuccess(res, 200, updated, "Custom sheet request updated");
}
