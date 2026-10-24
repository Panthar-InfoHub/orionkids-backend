import type { Response } from "express";

export interface ApiSuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Send a successful JSON response in the standard envelope.
 *
 * @param meta optional extras such as pagination ({ page, limit, total }).
 */
export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  message?: string,
  meta?: Record<string, unknown>
): void {
  const body: ApiSuccessResponse<T> = {
    success: true,
    ...(message !== undefined && { message }),
    data,
    ...(meta !== undefined && { meta }),
  };

  res.status(statusCode).json(body);
}
