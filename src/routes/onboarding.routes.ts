import { Router } from "express";
import { submitOnboardingController } from "../controllers/onboarding.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/", requireAuth, asyncHandler(submitOnboardingController));

export default router;
