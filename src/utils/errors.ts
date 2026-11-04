export const ErrorCodes = {
  // Auth & Access
  UNAUTHORIZED: "UNAUTHORIZED",
  ACCOUNT_PENDING: "ACCOUNT_PENDING",
  ACCOUNT_RESTRICTED: "ACCOUNT_RESTRICTED",
  FORBIDDEN: "FORBIDDEN",
  ACCESS_DENIED: "ACCESS_DENIED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",

  // Business state & workflow conflicts
  SESSION_CLOSED: "SESSION_CLOSED",
  WARMUP_REQUIRED: "WARMUP_REQUIRED",
  WARMUP_ALREADY_COMPLETED: "WARMUP_ALREADY_COMPLETED",
  CHILD_PROFILE_REQUIRED: "CHILD_PROFILE_REQUIRED",
  REQUEST_ALREADY_REVIEWED: "REQUEST_ALREADY_REVIEWED",
  USER_RESTRICTED: "USER_RESTRICTED",
  CANNOT_RESTRICT_ADMIN: "CANNOT_RESTRICT_ADMIN",
  CANNOT_MODIFY_SELF: "CANNOT_MODIFY_SELF",
  FOREIGN_KEY_VIOLATION: "FOREIGN_KEY_VIOLATION",
  MALFORMED_IDENTIFIER: "MALFORMED_IDENTIFIER",
  PRISMA_VALIDATION_ERROR: "PRISMA_VALIDATION_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | string;

/**
 * Base class for every error we throw on purpose.
 * Its `message` is safe to show to the client; the error handler sends it as-is.
 * Anything that is NOT an AppError is treated as an unexpected bug (500).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = ErrorCodes.INTERNAL_SERVER_ERROR,
    details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to do this",
    code = "FORBIDDEN"
  ) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists", code = "CONFLICT") {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}
