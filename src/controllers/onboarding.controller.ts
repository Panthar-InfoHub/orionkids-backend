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
  const headerKey = req.headers["x-idempotency-key"];
  const idempotencyKey =
    typeof headerKey === "string" && headerKey.trim().length > 0
      ? headerKey.trim()
      : validated.idempotencyKey;

  const result = await submitUserOnboarding(
    req.authCtx.userId,
    validated,
    idempotencyKey
  );

  sendSuccess(
    res,
    200,
    result,
    "Onboarding submitted successfully"
  );
}
