import { z } from "zod";

export const gameKeysEnum = z.enum([
  "stroop",
  "card-flip",
  "pattern",
  "odd-one-out",
  "rule-discovery",
  "story-sequencing",
]);

export type GameKey = z.infer<typeof gameKeysEnum>;

export const GAME_KEY_TO_ID: Record<GameKey, number> = {
  stroop: 1,
  "card-flip": 2,
  pattern: 3,
  "odd-one-out": 4,
  "rule-discovery": 5,
  "story-sequencing": 6,
};

export const GAME_ID_TO_KEY: Record<number, GameKey> = {
  1: "stroop",
  2: "card-flip",
  3: "pattern",
  4: "odd-one-out",
  5: "rule-discovery",
  6: "story-sequencing",
};

export const warmUpAnswersSchema = z.object({
  answers: z.record(z.string().or(z.number()), z.string().min(1)),
  completedAt: z
    .string()
    .datetime()
    .optional()
    .default(() => new Date().toISOString()),
});

export const startLevelSchema = z.object({
  gameKey: gameKeysEnum,
  levelNumber: z.number().int().min(1).max(3),
});

export const completeLevelSchema = z
  .object({
    gameKey: gameKeysEnum,
    levelNumber: z.number().int().min(1).max(3),
    attemptNumber: z.number().int().positive().optional().default(1),
    totalTrials: z.number().int().nonnegative().max(100).optional(),
    correctTrials: z.number().int().nonnegative().max(100).optional(),
    accuracy: z.number().min(0).max(100).finite().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    averageReactionTimeMs: z.number().int().nonnegative().optional(),
    metrics: z.record(z.string(), z.any()).optional().default({}),
    trialRecords: z.array(z.any()).max(100).optional().default([]),
    completedAt: z
      .string()
      .datetime()
      .optional()
      .default(() => new Date().toISOString()),
  })
  .refine(
    (data) => {
      if (
        typeof data.totalTrials === "number" &&
        typeof data.correctTrials === "number"
      ) {
        return data.correctTrials <= data.totalTrials;
      }
      return true;
    },
    {
      message: "correctTrials cannot exceed totalTrials",
      path: ["correctTrials"],
    }
  );

export type CompleteLevelInput = z.infer<typeof completeLevelSchema>;

export const legacyStroopSubmitSchema = z
  .object({
    level: z.coerce.number().int().min(1).max(3),
    sessionId: z.string().trim().min(1).optional(),
    totalTrials: z.coerce
      .number()
      .int()
      .positive("totalTrials must be greater than 0")
      .max(100),
    correctTrials: z.coerce.number().int().nonnegative().max(100),
    accuracy: z.coerce.number().min(0).max(100).finite(),
    durationMs: z.coerce.number().int().nonnegative().optional(),
    averageReactionTimeMs: z.coerce.number().int().nonnegative().optional(),
    trials: z
      .array(z.any())
      .max(100)
      .optional()
      .default([]),
    completedAt: z.string().optional(),
  })
  .refine(
    (data) => data.correctTrials <= data.totalTrials,
    {
      message: "correctTrials cannot exceed totalTrials",
      path: ["correctTrials"],
    }
  );

export type LegacyStroopSubmitInput = z.infer<typeof legacyStroopSubmitSchema>;


export const saveCheckpointSchema = z.object({
  checkpoint: z.record(z.string(), z.any()),
});

export type SaveCheckpointInput = z.infer<typeof saveCheckpointSchema>;
