import { Router } from "express";
import {
  getUsersController,
  updateUserStatusController,
} from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Every route in this router is guarded by requireAdmin
router.use(requireAdmin);

router.get("/users", asyncHandler(getUsersController));
router.patch("/users/:id/status", asyncHandler(updateUserStatusController));

export default router;
