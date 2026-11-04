import { Router } from "express";
import {
  getRegistrationStatusController,
  acceptTermsController,
} from "../controllers/registration.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get(
  "/status",
  requireAuth,
  asyncHandler(getRegistrationStatusController)
);
router.post("/accept-terms", requireAuth, asyncHandler(acceptTermsController));

export default router;
