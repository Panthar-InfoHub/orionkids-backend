import { Router } from "express";
import { submitOnboardingController } from "../controllers/onboarding.controller.js";
import { requireActive } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/", requireActive, asyncHandler(submitOnboardingController));

export default router;
