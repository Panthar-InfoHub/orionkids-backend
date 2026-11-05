import type { RequestHandler } from "express";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";

/** Catches any request that matched no route. Mounted after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  logger.warn(
    { method: req.method, url: req.originalUrl },
    `route.not_found: ${req.method} ${req.originalUrl}`
  );
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};
