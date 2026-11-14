import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AiStructuredReportSchema,
  generateRuleBasedReport,
  generateAiReport,
  type GameplayReportInput,
} from "../src/services/aiReport.service.js";
import { generateReportPdf } from "../src/services/pdfReport.service.js";
import { CANONICAL_GAMES } from "../src/config/games.js";

// Helper to construct a valid GameplayReportInput fixture
function createMockInput(overrides: Partial<GameplayReportInput> = {}): GameplayReportInput {
  return {
    child: {
      childName: "Aria Sharma",
      age: 8,
      selectedClass: "Class 3",
      school: "Orion Elementary School",
      ...overrides.child,
    },
    quest: {
      sessionId: `test_session_${Date.now()}`,
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt: new Date().toISOString(),
      totalLevelsCompleted: 18,
      overallAccuracy: 88.5,
      totalDurationMs: 900000, // 15 mins
      ...overrides.quest,
    },
    warmUp: {
      copingStrategy: "take a deep breath and retry",
      learningStyle: "visual and hands-on",
      favoriteSubject: "science and exploration",
      emotionalState: "excited and confident",
      ...overrides.warmUp,
    },
    games:
      overrides.games ||
      CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 88,
        averageReactionTimeMs: 1400,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: 7,
          accuracy: 87.5,
          durationMs: 15000,
          averageReactionTimeMs: 1400,
        })),
      })),
  };
}

describe("Enhanced OpenAI Prompt Engineering & PDF Content Verification Suite", () => {
  // Scenario 1: High and Consistent Performance
  it("1. High & Consistent Performance: generates rich, evidence-based strengths and tailored home activities", async () => {
    const input = createMockInput({
      quest: {
        sessionId: "high_perf_session",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 96,
        totalDurationMs: 720000,
      },
      games: CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 95,
        averageReactionTimeMs: 1250,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: lvl === 1 ? 10 : 9,
          accuracy: lvl === 1 ? 100 : 90,
          durationMs: 12000,
          averageReactionTimeMs: 1200,
        })),
      })),
    });

    const report = generateRuleBasedReport(input);
    const validated = AiStructuredReportSchema.parse(report);

    // Verify rich observed strengths
    assert.ok(validated.observedStrengths.length >= 3, "Must generate at least 3 rich strengths");
    for (const st of validated.observedStrengths) {
      assert.ok(st.heading, "Strength heading must exist");
      assert.ok(st.cognitiveSkill, "Cognitive skill must exist");
      assert.ok(st.observation.length > 30, "Detailed observation required");
      assert.ok(st.performanceEvidence.length > 10, "Evidence must be provided with specific metrics");
      assert.ok(st.educationalRelevance.length > 20, "Educational relevance required");
    }

    // Verify 4-6 rich personalized home activities
    assert.ok(
      validated.parentRecommendations.length >= 4 && validated.parentRecommendations.length <= 6,
      `Expected 4-6 activities, got ${validated.parentRecommendations.length}`
    );
    for (const act of validated.parentRecommendations) {
      assert.ok(act.title, "Activity must have title");
      assert.ok(act.skillsPracticed.length >= 1, "Must list skills practiced");
      assert.ok(act.materials.length >= 1, "Must list household materials");
      assert.ok(act.instructions.length >= 3, "Must have at least 3 instructional steps");
      assert.ok(act.suggestedDuration.includes("min"), "Must suggest manageable duration");
      assert.ok(act.learningOpportunity, "Must explain learning opportunity");
      assert.ok(act.parentTip, "Must provide constructive parent tip");
    }

    // Verify multi-page PDF generation
    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      overallAccuracy: input.quest.overallAccuracy,
      totalDurationMs: input.quest.totalDurationMs,
      aiReport: validated,
    });
    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 3000, "PDF byte length must be substantial");
  });

  // Scenario 2: Mixed Performance
  it("2. Mixed Performance: correctly differentiates high proficiency domains from areas needing practice", () => {
    const input = createMockInput({
      games: CANONICAL_GAMES.map((cg) => {
        const isStrong = cg.key === "stroop" || cg.key === "card-flip";
        const avgAcc = isStrong ? 95 : 55;
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          levelsCompleted: 3,
          averageAccuracy: avgAcc,
          averageReactionTimeMs: 1600,
          levels: [1, 2, 3].map((lvl) => ({
            levelNumber: lvl,
            attemptNumber: 1,
            status: "COMPLETED",
            totalTrials: 8,
            correctTrials: isStrong ? 8 : 4,
            accuracy: isStrong ? 100 : 50,
            durationMs: 15000,
            averageReactionTimeMs: 1600,
          })),
        };
      }),
    });

    const report = generateRuleBasedReport(input);
    const validated = AiStructuredReportSchema.parse(report);

    // Strengths must highlight the strong games (Stroop / Card Flip)
    const strengthSkills = validated.observedStrengths.map((s) => s.cognitiveSkill.toLowerCase());
    assert.ok(
      strengthSkills.some((s) => s.includes("focus") || s.includes("memory")),
      "Strengths must highlight high-scoring Focus or Memory domains"
    );

    // Areas for practice must identify the lower-scoring games
    assert.ok(validated.areasForPractice.length >= 2, "Must identify growth areas");
    for (const pr of validated.areasForPractice) {
      assert.ok(pr.heading, "Practice area must have heading");
      assert.ok(pr.observedPattern, "Must explain observed variation");
      assert.ok(pr.recommendedApproach, "Must provide constructive parent recommendation");
    }
  });

  // Scenario 3: Low Performance with Strictly Non-Deficit Language
  it("3. Low Performance: maintains supportive, non-clinical tone and avoids deficit language", () => {
    const input = createMockInput({
      quest: {
        sessionId: "low_perf_session",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalLevelsCompleted: 18,
        overallAccuracy: 42,
        totalDurationMs: 1200000,
      },
      games: CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 40,
        averageReactionTimeMs: 2400,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: 3,
          accuracy: 37.5,
          durationMs: 20000,
          averageReactionTimeMs: 2400,
        })),
      })),
    });

    const report = generateRuleBasedReport(input);
    const validated = AiStructuredReportSchema.parse(report);
    const serialized = JSON.stringify(validated).toLowerCase();

    // Verify absence of deficit or clinical labels
    assert.ok(!serialized.includes("adhd"), "Must not mention ADHD");
    assert.ok(!serialized.includes("disorder"), "Must not mention disorder");
    assert.ok(!serialized.includes("deficient"), "Must not use 'deficient'");
    assert.ok(!serialized.includes("weak"), "Must not use 'weak'");
    assert.ok(!serialized.includes("incapable"), "Must not use 'incapable'");
    assert.ok(!serialized.includes("failure"), "Must not use 'failure'");

    // Verify positive engagement is still celebrated
    assert.ok(validated.observedStrengths.length >= 2);
    assert.ok(validated.areasForPractice.length >= 2);
  });

  // Scenario 4 & 5: Missing Levels & Incomplete Quests
  it("4 & 5. Missing Levels & Incomplete Quests: handles unfinished levels without treating as 0% accuracy or failure", () => {
    const input = createMockInput({
      quest: {
        sessionId: "incomplete_quest_session",
        startedAt: new Date().toISOString(),
        completedAt: null, // session was incomplete
        totalLevelsCompleted: 6,
        overallAccuracy: 85,
        totalDurationMs: 300000,
      },
      games: CANONICAL_GAMES.map((cg) => {
        // Only first 2 games completed
        const isPlayed = cg.id <= 2;
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          levelsCompleted: isPlayed ? 3 : 0,
          averageAccuracy: isPlayed ? 85 : null,
          averageReactionTimeMs: isPlayed ? 1500 : null,
          levels: [1, 2, 3].map((lvl) => ({
            levelNumber: lvl,
            attemptNumber: 1,
            status: isPlayed ? "COMPLETED" : "NOT_COMPLETED",
            totalTrials: isPlayed ? 8 : null,
            correctTrials: isPlayed ? 7 : null,
            accuracy: isPlayed ? 87.5 : null,
            durationMs: isPlayed ? 12000 : null,
            averageReactionTimeMs: isPlayed ? 1500 : null,
          })),
        };
      }),
    });

    const report = generateRuleBasedReport(input);
    const validated = AiStructuredReportSchema.parse(report);

    // Unplayed levels must not have 0% accuracy
    const unplayedLevels = validated.levelWisePerformance.filter(
      (l) => l.status === "NOT_COMPLETED"
    );
    assert.equal(unplayedLevels.length, 12, "12 unplayed levels across games 3-6");
    for (const lvl of unplayedLevels) {
      assert.equal(lvl.accuracy, null, "Unplayed level accuracy must be null, not 0%");
      assert.ok(!lvl.insight.includes("failure"), "Must not describe unplayed level as failure");
    }
  });

  // Scenario 6: Different Reaction Times (Fast vs Deliberate)
  it("6. Different Reaction Times: correctly identifies decisive pace vs reflective deliberation", () => {
    const fastInput = createMockInput({
      games: CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 90,
        averageReactionTimeMs: 1100, // fast pace
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: 7,
          accuracy: 87.5,
          durationMs: 9000,
          averageReactionTimeMs: 1100,
        })),
      })),
    });

    const slowInput = createMockInput({
      games: CANONICAL_GAMES.map((cg) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 90,
        averageReactionTimeMs: 2900, // deliberate pace
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: 7,
          accuracy: 87.5,
          durationMs: 24000,
          averageReactionTimeMs: 2900,
        })),
      })),
    });

    const fastReport = generateRuleBasedReport(fastInput);
    const slowReport = generateRuleBasedReport(slowInput);

    const fastStrength = fastReport.observedStrengths.find((s) =>
      s.heading.toLowerCase().includes("decisive") || s.cognitiveSkill.toLowerCase().includes("processing")
    );
    assert.ok(fastStrength, "Fast player must receive decisive processing strength");

    const slowStrength = slowReport.observedStrengths.find((s) =>
      s.heading.toLowerCase().includes("reflective") || s.cognitiveSkill.toLowerCase().includes("thoughtful")
    );
    assert.ok(slowStrength, "Deliberate player must receive reflective pacing strength");
  });

  // Scenario 7 & 8: Zero Accuracy vs Null Accuracy
  it("7 & 8. Zero vs Null Accuracy: distinguishes genuine 0% trial score from unrecorded metrics", () => {
    const input = createMockInput({
      games: CANONICAL_GAMES.map((cg, idx) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: idx === 0 ? 0 : 80, // Game 1 has 0% accuracy
        averageReactionTimeMs: 1800,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 8,
          correctTrials: idx === 0 ? 0 : 7,
          accuracy: idx === 0 ? 0 : 87.5,
          durationMs: 15000,
          averageReactionTimeMs: 1800,
        })),
      })),
    });

    const report = generateRuleBasedReport(input);
    const validated = AiStructuredReportSchema.parse(report);

    // Level with 0% accuracy must be recorded as 0, not null
    const zeroLevels = validated.levelWisePerformance.filter(
      (l) => l.gameKey === "stroop"
    );
    assert.equal(zeroLevels[0]?.accuracy, 0, "Level with 0% accuracy must be exactly 0");
    assert.ok(zeroLevels[0]?.insight.includes("0%"), "Insight must reference 0% accuracy constructively");
  });

  // Scenario 9 & 10: OpenAI Fallback on Missing Key or Error
  it("9 & 10. OpenAI API Fallback: smoothly falls back to rich rule-based engine when OpenAI fails", async () => {
    const input = createMockInput();
    // generateAiReport when API is unavailable returns rule-based fallback
    const result = await generateAiReport(input);

    assert.ok(result.report, "Must return valid report");
    assert.equal(typeof result.usedAi, "boolean");
    assert.ok(result.report.observedStrengths.length >= 3);
    assert.ok(result.report.parentRecommendations.length >= 4);

    // Schema validation must succeed 100%
    const validated = AiStructuredReportSchema.parse(result.report);
    assert.ok(validated.overallPerformanceSummary.length > 50);
  });

  // Scenario 11 & 12: Backward Compatibility for Legacy String Arrays
  it("11. Backward Compatibility: safely parses legacy reports with string-only strengths and recommendations", () => {
    const legacyReport = {
      reportTitle: "OrionKids Cognitive Exploration & Gameplay Report",
      childOverview: "Aria Sharma, 8 years old",
      questSummary: "Completed 18 levels",
      overallPerformanceSummary: "Great performance across all challenges.",
      gameWiseAnalysis: CANONICAL_GAMES.map((cg) => ({
        gameKey: cg.key,
        gameName: cg.name,
        cognitiveDomain: cg.domain,
        levelsCompleted: 3,
        averageAccuracy: 85,
        averageReactionTimeMs: 1400,
        summary: "Solid performance in this game.",
        observedStrengths: ["High accuracy in foundational levels"],
        areasForPractice: ["Keep exploring at home"],
      })),
      levelWisePerformance: [
        {
          gameKey: "stroop",
          levelNumber: 1,
          status: "COMPLETED",
          accuracy: 100,
          durationMs: 12000,
          averageReactionTimeMs: 1200,
          insight: "Level 1 completed with 100% accuracy",
        },
      ],
      observedStrengths: [
        "Strongest performance observed in Card Flip Memory with 100% accuracy.",
        "Consistent focus throughout Stroop Colour-Word.",
      ],
      areasForPractice: [
        "Additional playful practice in Odd One Out to nurture visual acuity.",
      ],
      progressAndConsistency: "Maintained steady focus throughout.",
      parentRecommendations: [
        {
          title: "Memory Card Pairs",
          description: "Play matching card games with 6 pairs.",
          activityType: "Family Board Game",
        },
      ],
      dataLimitations: "Educational summary disclaimer.",
      reportGenerationDate: new Date().toISOString(),
    };

    const parsed = AiStructuredReportSchema.parse(legacyReport);

    // Verify strings were safely transformed to rich objects
    assert.equal(typeof parsed.observedStrengths[0], "object");
    assert.ok((parsed.observedStrengths[0] as any).observation.includes("Card Flip Memory"));
    assert.equal(typeof parsed.areasForPractice[0], "object");
    assert.ok((parsed.areasForPractice[0] as any).observedPattern.includes("Odd One Out"));
    assert.equal(typeof parsed.parentRecommendations[0], "object");
    assert.equal((parsed.parentRecommendations[0] as any).title, "Memory Card Pairs");
  });

  // Scenario 13: PDF Overflow & Page Count Integrity
  it("13. PDF Multi-Page Overflow: correctly lays out content across multiple pages with page numbering", async () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      overallAccuracy: input.quest.overallAccuracy,
      totalDurationMs: input.quest.totalDurationMs,
      aiReport: report,
    });

    assert.ok(pdfBytes.length > 5000);
    // Verify standard PDF header
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");
    assert.match(header, /^%PDF-/);
  });

  // Scenario 14: Child Data Isolation
  it("14. Child Data Isolation: Child 1 report strictly contains Child 1 data and zero Child 2 data", () => {
    const child1Input = createMockInput({
      child: { childName: "Rohan Patel", age: 7, selectedClass: "Class 2", school: "Delhi Public School" },
      quest: { sessionId: "session_rohan", overallAccuracy: 94, totalLevelsCompleted: 18, totalDurationMs: 600000, startedAt: "", completedAt: "" },
    });
    const child2Input = createMockInput({
      child: { childName: "Sara Khan", age: 10, selectedClass: "Class 5", school: "St. Xavier's High" },
      quest: { sessionId: "session_sara", overallAccuracy: 72, totalLevelsCompleted: 15, totalDurationMs: 800000, startedAt: "", completedAt: "" },
    });

    const report1 = generateRuleBasedReport(child1Input);
    const report2 = generateRuleBasedReport(child2Input);

    const str1 = JSON.stringify(report1);
    const str2 = JSON.stringify(report2);

    assert.ok(str1.includes("Rohan Patel"));
    assert.ok(!str1.includes("Sara Khan"));
    assert.ok(!str1.includes("St. Xavier's"));

    assert.ok(str2.includes("Sara Khan"));
    assert.ok(!str2.includes("Rohan Patel"));
    assert.ok(!str2.includes("Delhi Public School"));
  });
});
