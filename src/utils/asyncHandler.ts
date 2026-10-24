import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so a rejected promise reaches the error handler.
 *
 * Express 5 already forwards async errors on its own, so this is a safety net,
 * not a requirement. It keeps every handler consistent and makes the error
 * path explicit when someone reads the code.
 */
export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
