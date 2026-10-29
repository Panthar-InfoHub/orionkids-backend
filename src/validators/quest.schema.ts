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
  completedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export const startLevelSchema = z.object({
  gameKey: gameKeysEnum,
  levelNumber: z.number().int().min(1).max(3),
});

export const completeLevelSchema = z.object({
  gameKey: gameKeysEnum,
  levelNumber: z.number().int().min(1).max(3),
  attemptNumber: z.number().int().positive().optional().default(1),
  totalTrials: z.number().int().nonnegative().optional(),
  correctTrials: z.number().int().nonnegative().optional(),
  accuracy: z.number().min(0).max(100).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  averageReactionTimeMs: z.number().int().nonnegative().optional(),
  metrics: z.record(z.string(), z.any()).optional().default({}),
  trialRecords: z.array(z.any()).optional().default([]),
  completedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type CompleteLevelInput = z.infer<typeof completeLevelSchema>;
