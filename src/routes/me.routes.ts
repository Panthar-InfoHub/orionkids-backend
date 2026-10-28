import { Router } from "express";
import { getMeController } from "../controllers/me.controller.js";
import { submitOnboardingController } from "../controllers/onboarding.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", requireAuth, asyncHandler(getMeController));
router.post("/onboarding", requireAuth, asyncHandler(submitOnboardingController));

export default router;
