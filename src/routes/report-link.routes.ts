import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isTest } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { openReportLinkController } from "../controllers/reportLink.controller.js";

const router = Router();

// Public endpoint: strict per-IP limit to stop link-code guessing
const reportLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests, please try again later",
    },
  },
});

router.get("/:code", reportLinkLimiter, asyncHandler(openReportLinkController));

export default router;
