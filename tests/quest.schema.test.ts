import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gameKeysEnum,
  startLevelSchema,
  completeLevelSchema,
  legacyStroopSubmitSchema,
} from "../src/validators/quest.schema.js";

describe("Quest Validation Schemas", () => {
  describe("gameKeysEnum", () => {
    it("accepts valid game keys", () => {
      assert.equal(gameKeysEnum.parse("stroop"), "stroop");
      assert.equal(gameKeysEnum.parse("card-flip"), "card-flip");
      assert.equal(gameKeysEnum.parse("pattern"), "pattern");
      assert.equal(gameKeysEnum.parse("odd-one-out"), "odd-one-out");
      assert.equal(gameKeysEnum.parse("rule-discovery"), "rule-discovery");
      assert.equal(gameKeysEnum.parse("story-sequencing"), "story-sequencing");
    });

    it("rejects unknown game keys", () => {
      assert.throws(() => gameKeysEnum.parse("invalid-game"));
    });
  });

  describe("startLevelSchema", () => {
    it("accepts valid level start payload", () => {
      const parsed = startLevelSchema.parse({
        gameKey: "stroop",
        levelNumber: 1,
      });
      assert.equal(parsed.gameKey, "stroop");
      assert.equal(parsed.levelNumber, 1);
    });

    it("rejects levelNumber out of range (< 1 or > 3)", () => {
      assert.throws(() =>
        startLevelSchema.parse({ gameKey: "stroop", levelNumber: 0 })
      );
      assert.throws(() =>
        startLevelSchema.parse({ gameKey: "stroop", levelNumber: 4 })
      );
      assert.throws(() =>
        startLevelSchema.parse({ gameKey: "stroop", levelNumber: 1.5 })
      );
    });
  });

  describe("completeLevelSchema", () => {
    it("accepts valid level completion payload", () => {
      const parsed = completeLevelSchema.parse({
        gameKey: "stroop",
        levelNumber: 2,
        totalTrials: 8,
        correctTrials: 7,
        accuracy: 87.5,
        durationMs: 15400,
        averageReactionTimeMs: 1450,
      });
      assert.equal(parsed.gameKey, "stroop");
      assert.equal(parsed.levelNumber, 2);
      assert.equal(parsed.correctTrials, 7);
    });

    it("rejects negative numbers for trials and durations", () => {
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          totalTrials: -1,
        })
      );
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          durationMs: -500,
        })
      );
    });

    it("rejects accuracy out of 0-100 range or non-finite", () => {
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          accuracy: -5,
        })
      );
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          accuracy: 105,
        })
      );
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          accuracy: NaN,
        })
      );
    });

    it("rejects when correctTrials exceeds totalTrials", () => {
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          totalTrials: 5,
          correctTrials: 10,
        })
      );
    });

    it("rejects excessive trial records array (> 100 items)", () => {
      const oversized = Array.from({ length: 150 }, (_, i) => ({ trialId: i }));
      assert.throws(() =>
        completeLevelSchema.parse({
          gameKey: "stroop",
          levelNumber: 1,
          trialRecords: oversized,
        })
      );
    });
  });

  describe("legacyStroopSubmitSchema", () => {
    it("accepts valid legacy Stroop level submission", () => {
      const parsed = legacyStroopSubmitSchema.parse({
        level: 1,
        totalTrials: 8,
        correctTrials: 8,
        accuracy: 100,
        durationMs: 12400,
        averageReactionTimeMs: 1550,
        trials: [{ trialId: 1, isCorrect: true }],
      });
      assert.equal(parsed.level, 1);
      assert.equal(parsed.totalTrials, 8);
    });

    it("rejects placeholder/zero trials (totalTrials <= 0)", () => {
      assert.throws(() =>
        legacyStroopSubmitSchema.parse({
          level: 1,
          totalTrials: 0,
          correctTrials: 0,
          accuracy: 0,
        })
      );
    });

    it("rejects when correctTrials exceeds totalTrials", () => {
      assert.throws(() =>
        legacyStroopSubmitSchema.parse({
          level: 1,
          totalTrials: 5,
          correctTrials: 6,
          accuracy: 80,
        })
      );
    });

    it("rejects invalid level (< 1 or > 3)", () => {
      assert.throws(() =>
        legacyStroopSubmitSchema.parse({
          level: 4,
          totalTrials: 8,
          correctTrials: 8,
          accuracy: 100,
        })
      );
    });
  });
});
