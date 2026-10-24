import type { RequestHandler } from "express";
import { NotFoundError } from "../utils/errors.js";

/** Catches any request that matched no route. Mounted after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};
