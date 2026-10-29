import { Router } from "express";
import { requireActive } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getOrCreateSessionController,
  getCurrentSessionController,
  getResumeStateController,
  saveCheckpointController,
  getSessionByIdController,
  submitWarmUpController,
  startLevelController,
  completeLevelController,
  getReportController,
  legacyWarmUpSubmitController,
  legacyStroopLevelSubmitController,
} from "../controllers/quest.controller.js";

const router = Router();

// Every quest route requires an authenticated, active account (verified by requireActive)
router.use(requireActive);


// Resume & Checkpoint Lifecycle
router.get("/quest/resume-state", asyncHandler(getResumeStateController));
router.patch(
  "/quest/sessions/:sessionId/attempts/:attemptId/checkpoint",
  asyncHandler(saveCheckpointController)
);

// 1. Session Lifecycle
router.post("/quest/sessions", asyncHandler(getOrCreateSessionController));
router.get(
  "/quest/sessions/current",
  asyncHandler(getCurrentSessionController)
);
router.get(
  "/quest/sessions/:sessionId",
  asyncHandler(getSessionByIdController)
);

// 2. Warm-Up Submission
router.post(
  "/quest/sessions/:sessionId/warm-up",
  asyncHandler(submitWarmUpController)
);

// 3. Level Attempt Lifecycle
router.post(
  "/quest/sessions/:sessionId/levels/start",
  asyncHandler(startLevelController)
);
router.post(
  "/quest/sessions/:sessionId/levels/complete",
  asyncHandler(completeLevelController)
);

// 4. Report Retrieval & Generation
router.get(
  "/quest/sessions/:sessionId/report",
  asyncHandler(getReportController)
);

// 5. Legacy backward compatibility endpoints (now fully wired to PostgreSQL persistence)
router.post("/warm-up/submit", asyncHandler(legacyWarmUpSubmitController));
router.post(
  "/games/stroop/level-submit",
  asyncHandler(legacyStroopLevelSubmitController)
);

export default router;
