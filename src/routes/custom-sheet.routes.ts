import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isTest } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createCustomSheetRequestController } from "../controllers/customSheet.controller.js";

const router = Router();

// Public form (no login): strict per-IP limit against spam
const customSheetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_REQUESTS",
      message:
        "You have sent several requests recently. Please try again in an hour.",
    },
  },
});

router.post(
  "/",
  customSheetLimiter,
  asyncHandler(createCustomSheetRequestController)
);

export default router;
