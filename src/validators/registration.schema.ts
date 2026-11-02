import { z } from "zod";

export const CURRENT_TERMS_VERSION = "v1.0";
export const CURRENT_PRIVACY_POLICY_VERSION = "v1.0";

export const acceptTermsBodySchema = z.object({
  agree: z.literal(true, {
    message: "You must accept the terms and conditions to proceed.",
  }),
  termsVersion: z.string().optional().default(CURRENT_TERMS_VERSION),
  privacyPolicyVersion: z.string().optional().default(CURRENT_PRIVACY_POLICY_VERSION),
});

export const submitAccessRequestBodySchema = z.object({
  notes: z.string().max(500, "Notes cannot exceed 500 characters").optional(),
});

export const listAccessRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("ALL"),
  search: z.string().trim().optional(),
});

export const requestIdParamSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
});

export const rejectAccessRequestBodySchema = z.object({
  reason: z.string().trim().max(500, "Rejection reason cannot exceed 500 characters").optional(),
});

export type AcceptTermsBody = z.infer<typeof acceptTermsBodySchema>;
export type SubmitAccessRequestBody = z.infer<typeof submitAccessRequestBodySchema>;
export type ListAccessRequestsQuery = z.infer<typeof listAccessRequestsQuerySchema>;
