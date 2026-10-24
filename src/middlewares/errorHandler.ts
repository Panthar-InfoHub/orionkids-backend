import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";
import { isProd } from "../config/env.js";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type { ApiErrorResponse } from "../utils/apiResponse.js";

/** Turns any thrown value into an AppError with the right status code. */
function normalizeError(err: unknown): AppError {
  // 1. Errors we threw on purpose.
  if (err instanceof AppError) return err;

  // 2. Zod validation failures (from schema.parse in a controller).
  if (err instanceof ZodError) {
    return new ValidationError(
      "Invalid request data",
      err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  // 3. Known Prisma errors that map cleanly onto HTTP statuses.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": // unique constraint violation
        return new ConflictError("A record with this value already exists");
      case "P2025": // record to update/delete not found
        return new NotFoundError("Record not found");
    }
  }

  // 4. express.json() errors: malformed JSON or an oversized body.
  if (typeof err === "object" && err !== null && "type" in err) {
    const type = (err as { type?: unknown }).type;
    if (type === "entity.parse.failed") {
      return new ValidationError("Malformed JSON in request body");
    }
    if (type === "entity.too.large") {
      return new AppError("Request body too large", 413, "PAYLOAD_TOO_LARGE");
    }
  }

  // 5. Anything else is a bug.
  const message = err instanceof Error ? err.message : "Unknown error";
  return new AppError(message, 500, "INTERNAL_SERVER_ERROR");
}

/**
 * The single place that turns errors into HTTP responses.
 * Must be registered LAST in app.ts, and must keep all four parameters:
 * that is how Express recognises it as an error handler.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // If the response has already started streaming, Express must close it.
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = normalizeError(err);
  const isServerError = appError.statusCode >= 500;

  const logContext = { err, method: req.method, url: req.originalUrl };
  if (isServerError) {
    logger.error(logContext, appError.message);
  } else {
    logger.warn(logContext, appError.message);
  }

  // Never leak internal error messages to clients in production.
  const message =
    isServerError && isProd
      ? "Something went wrong. Please try again later."
      : appError.message;

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: appError.code,
      message,
      ...(appError.details !== undefined && { details: appError.details }),
    },
  };

  res.status(appError.statusCode).json(body);
};
