import { Router } from "express";
import userRoutes from "./user.routes.js";

const router = Router();

router.use("/users", userRoutes);
// Each new feature adds one line here:
// router.use("/products", productRoutes);

export default router;
