import { Router } from "express";
import {
  getMeController,
  deleteMeController,
} from "../controllers/me.controller.js";
import { submitOnboardingController } from "../controllers/onboarding.controller.js";
import { requireAuth, requireActive } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", requireAuth, asyncHandler(getMeController));
router.delete("/", requireAuth, asyncHandler(deleteMeController));
router.post(
  "/onboarding",
  requireActive,
  asyncHandler(submitOnboardingController)
);

export default router;
