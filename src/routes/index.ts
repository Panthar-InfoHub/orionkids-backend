import { Router } from "express";
import meRoutes from "./me.routes.js";
import adminRoutes from "./admin.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import questRoutes, { legacyRoutes } from "./quest.routes.js";
import childRoutes from "./child.routes.js";
import registrationRoutes from "./registration.routes.js";
import accessRequestRoutes from "./access-request.routes.js";
import { requireActive } from "../middlewares/auth.js";

const router = Router();

router.use("/me", meRoutes);
router.use("/registration", registrationRoutes);
router.use("/access-requests", accessRequestRoutes);
router.use("/admin", adminRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/children", childRoutes);
router.use("/quest", requireActive, questRoutes);
router.use("/", legacyRoutes);

export default router;
