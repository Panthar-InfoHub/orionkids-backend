import { Router } from "express";
import { requireActive } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

const router = Router();

// Enforce that only authenticated, ACTIVE accounts can submit warm-up or game progress
router.post(
  "/warm-up/submit",
  requireActive,
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      200,
      {
        received: true,
        userId: req.authCtx?.userId,
        nextGameRoute: "/games/stroop",
      },
      "Warm-up answers saved successfully"
    );
  })
);

router.post(
  "/games/stroop/level-submit",
  requireActive,
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      200,
      {
        received: true,
        userId: req.authCtx?.userId,
        nextLevelRoute: "/games/stroop?level=2",
      },
      "Level progress saved successfully"
    );
  })
);

export default router;
