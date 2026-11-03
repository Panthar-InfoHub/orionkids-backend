import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createChildController,
  listChildrenController,
  getChildController,
  updateChildController,
  getChildProgressController,
  getChildQuestSessionsController,
  getChildReportsController,
  listAllParentReportsController,
  downloadChildSessionReportPdfController,
} from "../controllers/child.controller.js";

const router = Router();

// All child routes require an authenticated user
router.use(requireAuth);

router.get("/reports/all", asyncHandler(listAllParentReportsController));
router.post("/", asyncHandler(createChildController));
router.get("/", asyncHandler(listChildrenController));
router.get("/:childId", asyncHandler(getChildController));
router.patch("/:childId", asyncHandler(updateChildController));
router.get("/:childId/progress", asyncHandler(getChildProgressController));
router.get("/:childId/quest-sessions", asyncHandler(getChildQuestSessionsController));
router.get("/:childId/reports", asyncHandler(getChildReportsController));
router.get("/:childId/quest-sessions/:sessionId/report/pdf", asyncHandler(downloadChildSessionReportPdfController));

export default router;
