import type { Request, Response } from "express";
import { submitOnboardingSchema } from "../validators/onboarding.schema.js";
import { submitUserOnboarding } from "../services/onboarding.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function submitOnboardingController(req: Request, res: Response) {
  if (!req.authCtx) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHENTICATED");
  }

  const validated = submitOnboardingSchema.parse(req.body);
  const result = await submitUserOnboarding(req.authCtx.userId, validated);

  sendSuccess(res, 200, result, "Onboarding submitted successfully and pending approval");
}
