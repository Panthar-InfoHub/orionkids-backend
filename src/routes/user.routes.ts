import { Router } from "express";
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
} from "../controllers/user.controller.js";

const router = Router();

router.get("/", listUsersHandler);
router.get("/:id", getUserHandler);
router.post("/", createUserHandler);

export default router;
