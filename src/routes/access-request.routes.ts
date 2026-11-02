import { Router } from "express";
import {
  submitAccessRequestController,
  getMyAccessRequestController,
} from "../controllers/registration.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/", requireAuth, asyncHandler(submitAccessRequestController));
router.get("/me", requireAuth, asyncHandler(getMyAccessRequestController));

export default router;
