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
  generateReportController,
  downloadReportPdfController,
  legacyWarmUpSubmitController,
  legacyStroopLevelSubmitController,
} from "../controllers/quest.controller.js";

const router = Router();

// Resume & Checkpoint Lifecycle
router.get(
  ["/resume-state", "/quest/resume-state"],
  asyncHandler(getResumeStateController)
);
router.patch(
  [
    "/sessions/:sessionId/attempts/:attemptId/checkpoint",
    "/quest/sessions/:sessionId/attempts/:attemptId/checkpoint",
  ],
  asyncHandler(saveCheckpointController)
);

// 1. Session Lifecycle
router.post(
  ["/sessions", "/quest/sessions"],
  asyncHandler(getOrCreateSessionController)
);
router.get(
  ["/sessions/current", "/quest/sessions/current"],
  asyncHandler(getCurrentSessionController)
);
router.get(
  ["/sessions/:sessionId", "/quest/sessions/:sessionId"],
  asyncHandler(getSessionByIdController)
);

// 2. Warm-Up Submission
router.post(
  ["/sessions/:sessionId/warm-up", "/quest/sessions/:sessionId/warm-up"],
  asyncHandler(submitWarmUpController)
);

// 3. Level Attempt Lifecycle
router.post(
  [
    "/sessions/:sessionId/levels/start",
    "/quest/sessions/:sessionId/levels/start",
  ],
  asyncHandler(startLevelController)
);
router.post(
  [
    "/sessions/:sessionId/levels/complete",
    "/quest/sessions/:sessionId/levels/complete",
  ],
  asyncHandler(completeLevelController)
);

// 4. Report Retrieval & Generation
router.get(
  ["/sessions/:sessionId/report", "/quest/sessions/:sessionId/report"],
  asyncHandler(getReportController)
);
router.post(
  ["/sessions/:sessionId/report", "/quest/sessions/:sessionId/report"],
  asyncHandler(generateReportController)
);
router.get(
  ["/sessions/:sessionId/report/pdf", "/quest/sessions/:sessionId/report/pdf"],
  asyncHandler(downloadReportPdfController)
);

// 5. Legacy backward compatibility router
export const legacyRoutes = Router();
legacyRoutes.post(
  "/warm-up/submit",
  requireActive,
  asyncHandler(legacyWarmUpSubmitController)
);
legacyRoutes.post(
  "/games/stroop/level-submit",
  requireActive,
  asyncHandler(legacyStroopLevelSubmitController)
);

export default router;
