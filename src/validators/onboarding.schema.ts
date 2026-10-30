import { z } from "zod";

export const submitOnboardingSchema = z.object({
  childName: z.string().trim().min(1, "Child name is required").max(100),
  age: z.coerce
    .number()
    .int()
    .min(1, "Age must be at least 1")
    .max(18, "Age must be 18 or under"),
  language: z.string().trim().min(1, "Preferred language is required"),
  school: z.string().trim().max(150).optional().nullable(),
  selectedClass: z.string().trim().min(1, "Class selection is required"),
  studentId: z.string().trim().max(50).optional().nullable(),
  parentEmail: z.string().trim().email("Valid parent email is required"),
  parentMobile: z
    .string()
    .trim()
    .min(7, "Valid parent mobile is required")
    .max(20),
  isGuardian: z.boolean().refine((val) => val === true, {
    message: "Parent or guardian consent is required",
  }),
  idempotencyKey: z.string().trim().max(100).optional(),
});

export type SubmitOnboardingInput = z.infer<typeof submitOnboardingSchema>;
