import { Router } from "express";
import meRoutes from "./me.routes.js";
import adminRoutes from "./admin.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import questRoutes from "./quest.routes.js";

const router = Router();

router.use("/me", meRoutes);
router.use("/admin", adminRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/", questRoutes);

export default router;
