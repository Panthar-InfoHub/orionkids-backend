import { z } from "zod";

/**
 * Allowed values for the public "Request Custom Sheet" form.
 * These mirror the labels used on the frontend Printables page
 * (lib/api/printables.ts → PRINTABLE_GRADES / PRINTABLE_CATEGORIES).
 */
export const CUSTOM_SHEET_GRADE_LEVELS = [
  "Pre-K & K (Ages 4-5)",
  "Class 1-2 (Ages 6-7)",
  "Class 3-4 (Ages 8-9)",
  "Class 5+ (Ages 10+)",
] as const;

export const CUSTOM_SHEET_TYPES = [
  "Puzzles & Crosswords",
  "Coloring & Doodles",
  "Thinking & Focus Mats",
  "Cut & Fold Crafts",
  "Teacher Organizers",
  "Other",
] as const;

export const CUSTOM_SHEET_ROLES = ["PARENT", "TEACHER", "SCHOOL"] as const;

export const CUSTOM_SHEET_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "COMPLETED",
  "DECLINED",
] as const;

/** Optional free-text field: trims, and turns "" into undefined. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createCustomSheetRequestBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your name")
    .max(100, "Name must be at most 100 characters"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email is too long")
    .email("Please enter a valid email address"),
  requesterRole: z.enum(CUSTOM_SHEET_ROLES, {
    message: "Please tell us whether you are a parent, teacher or school",
  }),
  organizationName: optionalText(150, "School / organisation name"),
  phone: z
    .string()
    .trim()
    .max(20, "Phone number is too long")
    .regex(/^[+\d][\d\s-]{6,19}$/, "Please enter a valid phone number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  gradeLevel: z.enum(CUSTOM_SHEET_GRADE_LEVELS, {
    message: "Please choose a grade level",
  }),
  sheetType: z
    .enum(CUSTOM_SHEET_TYPES)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  details: z
    .string()
    .trim()
    .min(10, "Please describe the sheet you need (at least 10 characters)")
    .max(2000, "Description must be at most 2000 characters"),
  /**
   * Honeypot: hidden from humans in the UI. Bots that fill every field
   * put something here, and the request is silently dropped.
   */
  website: z.string().max(500).optional(),
});

export type CreateCustomSheetRequestBody = z.infer<
  typeof createCustomSheetRequestBodySchema
>;

export const listCustomSheetRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum([...CUSTOM_SHEET_STATUSES, "ALL"]).optional(),
  search: z.string().trim().max(100).optional(),
});

export type ListCustomSheetRequestsQuery = z.infer<
  typeof listCustomSheetRequestsQuerySchema
>;

export const customSheetRequestIdParamSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
});

export const updateCustomSheetRequestBodySchema = z
  .object({
    status: z.enum(CUSTOM_SHEET_STATUSES).optional(),
    // null or "" clears the note
    adminNote: z
      .string()
      .trim()
      .max(2000, "Note must be at most 2000 characters")
      .nullable()
      .optional(),
  })
  .refine((d) => d.status !== undefined || d.adminNote !== undefined, {
    message: "Nothing to update",
  });

export type UpdateCustomSheetRequestBody = z.infer<
  typeof updateCustomSheetRequestBodySchema
>;
