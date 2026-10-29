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

export default router;
