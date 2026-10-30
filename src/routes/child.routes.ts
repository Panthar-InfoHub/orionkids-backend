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
} from "../controllers/child.controller.js";

const router = Router();

// All child routes require an authenticated user
router.use(requireAuth);

router.post("/", asyncHandler(createChildController));
router.get("/", asyncHandler(listChildrenController));
router.get("/:childId", asyncHandler(getChildController));
router.patch("/:childId", asyncHandler(updateChildController));
router.get("/:childId/progress", asyncHandler(getChildProgressController));
router.get("/:childId/quest-sessions", asyncHandler(getChildQuestSessionsController));
router.get("/:childId/reports", asyncHandler(getChildReportsController));

export default router;
