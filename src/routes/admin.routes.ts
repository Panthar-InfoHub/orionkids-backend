import { Router } from "express";
import {
  getOverviewController,
  getUsersController,
  getUserDetailController,
  getUserChildrenController,
  getUserQuestSessionsController,
  getUserQuestSessionDetailController,
  getUserSessionAttemptsController,
  getUserSessionReportController,
  updateUserStatusController,
  getUserChildDetailController,
  getUserChildQuestSessionsController,
  getUserChildQuestSessionDetailController,
  getUserChildSessionAttemptsController,
  getUserChildSessionReportController,
  getAdminQuestSessionDetailController,
  listAccessRequestsController,
  approveAccessRequestController,
  rejectAccessRequestController,
  adminRegenerateReportController,
  adminDownloadReportPdfController,
  adminListReportsController,
  getAdminSessionReportController,
  adminResendReportEmailController,
  adminUpdateChildParentEmailController,
} from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Every admin route is strictly guarded by requireAdmin
router.use(requireAdmin);

// Admin overview aggregates
router.get("/overview", asyncHandler(getOverviewController));

// User listing and search
router.get("/users", asyncHandler(getUsersController));

// User status modification
router.patch("/users/:id/status", asyncHandler(updateUserStatusController));

// User 360° detail
router.get("/users/:userId", asyncHandler(getUserDetailController));

// Scoped child profiles
router.get("/users/:userId/children", asyncHandler(getUserChildrenController));

// Scoped quest sessions
router.get(
  "/users/:userId/quest-sessions",
  asyncHandler(getUserQuestSessionsController)
);

// Scoped single quest session breakdown
router.get(
  "/users/:userId/quest-sessions/:sessionId",
  asyncHandler(getUserQuestSessionDetailController)
);

// Scoped level attempts and telemetry
router.get(
  "/users/:userId/quest-sessions/:sessionId/attempts",
  asyncHandler(getUserSessionAttemptsController)
);

// Scoped quest assessment report
router.get(
  "/users/:userId/quest-sessions/:sessionId/report",
  asyncHandler(getUserSessionReportController)
);

// Child profile detail
router.get(
  "/users/:userId/children/:childProfileId",
  asyncHandler(getUserChildDetailController)
);

// Child-specific quest sessions
router.get(
  "/users/:userId/children/:childProfileId/quest-sessions",
  asyncHandler(getUserChildQuestSessionsController)
);

// Child-specific single quest session breakdown
router.get(
  "/users/:userId/children/:childProfileId/quest-sessions/:sessionId",
  asyncHandler(getUserChildQuestSessionDetailController)
);

// Child-specific level attempts and telemetry
router.get(
  "/users/:userId/children/:childProfileId/quest-sessions/:sessionId/attempts",
  asyncHandler(getUserChildSessionAttemptsController)
);

// Child-specific quest assessment report
router.get(
  "/users/:userId/children/:childProfileId/quest-sessions/:sessionId/report",
  asyncHandler(getUserChildSessionReportController)
);

// Direct single quest session breakdown by session ID
router.get(
  "/quest-sessions/:sessionId",
  asyncHandler(getAdminQuestSessionDetailController)
);
router.get(
  "/quest-sessions/:sessionId/report",
  asyncHandler(getAdminSessionReportController)
);
router.post(
  "/quest-sessions/:sessionId/regenerate-report",
  asyncHandler(adminRegenerateReportController)
);
router.get(
  "/quest-sessions/:sessionId/report/pdf",
  asyncHandler(adminDownloadReportPdfController)
);
router.post(
  "/quest-sessions/:sessionId/report/resend-email",
  asyncHandler(adminResendReportEmailController)
);

// Correct a child's parent email (admin only; does not send anything by itself)
router.patch(
  "/users/:userId/children/:childProfileId/parent-email",
  asyncHandler(adminUpdateChildParentEmailController)
);

// Reports administration across all children and users
router.get("/reports", asyncHandler(adminListReportsController));

// Access requests administration
router.get("/access-requests", asyncHandler(listAccessRequestsController));
router.patch(
  "/access-requests/:requestId/approve",
  asyncHandler(approveAccessRequestController)
);
router.patch(
  "/access-requests/:requestId/reject",
  asyncHandler(rejectAccessRequestController)
);

export default router;
