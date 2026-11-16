import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  AiStructuredReportSchema,
  generateRuleBasedReport,
  type GameplayReportInput,
} from "../src/services/aiReport.service.js";
import { generateReportPdf } from "../src/services/pdfReport.service.js";
import { CANONICAL_GAMES } from "../src/config/games.js";

function createMockInput(overrides: Partial<GameplayReportInput> = {}): GameplayReportInput {
  return {
    child: {
      childName: "Ananya Verma",
      age: 7,
      selectedClass: "Class 2",
      school: "Orion Public School",
      ...overrides.child,
    },
    quest: {
      sessionId: `test_p3_session_${Date.now()}`,
      startedAt: new Date(Date.now() - 25 * 60000).toISOString(),
      completedAt: new Date().toISOString(),
      totalLevelsCompleted: 18,
      overallAccuracy: 84.5,
      totalDurationMs: 25 * 60000,
      activeGameplayDurationMs: 22 * 60000,
      hasBreaks: false,
      sessionDurationMinutes: 25,
      isProlongedSession: false,
      ...overrides.quest,
    },
    warmUp: {
      copingStrategy: "take a deep breath",
      learningStyle: "hands-on visual exploration",
      favoriteSubject: "science & art",
      emotionalState: "enthusiastic",
      ...overrides.warmUp,
    },
    games:
      overrides.games ||
      CANONICAL_GAMES.map((cg, idx) => ({
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: idx === 0 ? 90 : idx === 4 ? 65 : 80,
        averageReactionTimeMs: 1250,
        playOrder: idx + 1,
        isFirstGame: idx === 0,
        isLastGame: idx === CANONICAL_GAMES.length - 1,
        firstAttemptAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
        lastAttemptAt: new Date(Date.now() - (6 - idx) * 120000 + 60000).toISOString(),
        activeDurationMs: 60000,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: idx === 4 ? (lvl === 1 ? 8 : lvl === 2 ? 6 : 5) : 8,
          accuracy: idx === 4 ? (lvl === 1 ? 80 : lvl === 2 ? 60 : 50) : 80,
          durationMs: 20000,
          averageReactionTimeMs: 1250,
          startedAt: new Date(Date.now() - (6 - idx) * 120000).toISOString(),
          completedAt: new Date(Date.now() - (6 - idx) * 120000 + 20000).toISOString(),
        })),
      })),
  };
}

describe("Phase 3: Parent-Friendly Assessment Report Test Suite", () => {
  // ---------------------------------------------------------------------------
  // REQUIREMENT 1: "What Does This Mean?" explanation
  // ---------------------------------------------------------------------------
  it("Requirement 1: 'What Does This Mean?' explanation is present, parent-friendly, and free of clinical jargon", () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    assert.ok(report.whatDoesThisMean, "whatDoesThisMean must be present");
    assert.ok(
      report.whatDoesThisMean.includes("obstacle course for the brain") ||
      report.whatDoesThisMean.includes("playful challenges"),
      "Should explain assessment using accessible metaphors"
    );

    // Verify zero clinical jargon
    const clinicalTerms = [
      "executive dysfunction",
      "deficit",
      "pathology",
      "abnormal",
      "psychometric",
      "neuropsychological",
      "clinical impairment",
    ];
    for (const term of clinicalTerms) {
      assert.ok(
        !report.whatDoesThisMean.toLowerCase().includes(term),
        `Must not contain clinical term "${term}"`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 2: Reassuring "Should I Worry?" section
  // ---------------------------------------------------------------------------
  it("Requirement 2: 'Should I Worry?' section provides clear non-diagnostic reassurance and teacher guidance", () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    assert.ok(report.shouldIWorry, "shouldIWorry must be present");
    assert.ok(
      report.shouldIWorry.reassurance.includes("Not at all!"),
      "Must offer warm, clear reassurance"
    );
    assert.ok(
      report.shouldIWorry.reassurance.includes("not a diagnosis"),
      "Must emphasize assessment is not a clinical diagnosis"
    );
    assert.ok(
      Array.isArray(report.shouldIWorry.keyPoints) && report.shouldIWorry.keyPoints.length >= 2,
      "Must provide at least 2 reassuring key points"
    );
    assert.ok(
      report.shouldIWorry.teacherPartnershipGuidance.length > 10,
      "Must provide guidance for teacher partnership"
    );

    // Verify zero deficit labeling
    const combinedWorryText = `${report.shouldIWorry.reassurance} ${report.shouldIWorry.keyPoints.join(" ")}`;
    assert.ok(
      !combinedWorryText.toLowerCase().includes("impaired"),
      "Must not label child as impaired"
    );
    assert.ok(
      !combinedWorryText.toLowerCase().includes("disorder"),
      "Must not label child with a disorder"
    );
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 3: Prominent "Start Here" recommendation
  // ---------------------------------------------------------------------------
  it("Requirement 3: 'Start Here' recommendation identifies first activity with actual evidence link and 10-minute steps", () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    assert.ok(report.startHere, "startHere must be present");
    assert.ok(report.startHere.activityTitle, "Activity title must be present");
    assert.ok(report.startHere.relatedDomain, "Related domain must be present");
    assert.ok(report.startHere.whyThisFirst, "Explanation for why this is first must be present");
    assert.ok(
      report.startHere.evidenceCitation.includes("%") ||
      report.startHere.evidenceCitation.includes("accuracy") ||
      report.startHere.evidenceCitation.includes("level"),
      "Evidence citation must reference actual assessment performance"
    );
    assert.equal(
      report.startHere.quickSteps.length,
      3,
      "Must provide exactly 3 quick actionable steps"
    );
    assert.equal(report.startHere.suggestedDuration, "10 minutes");
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 4: Home activities mapped to observed findings
  // ---------------------------------------------------------------------------
  it("Requirement 4: Every recommended home activity is mapped to an observed gameplay finding and domain", () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    assert.ok(
      report.parentRecommendations.length >= 4,
      "Must generate at least 4 home activities"
    );

    for (const act of report.parentRecommendations) {
      if (typeof act === "string") {
        assert.fail("Activities should be structured objects");
      }
      assert.ok(act.title, "Activity must have a title");
      assert.ok(act.materials && act.materials.length > 0, "Activity must list materials");
      assert.ok(
        act.instructions && act.instructions.length >= 3,
        "Activity must have at least 3 instructional steps"
      );
      assert.ok(act.relatedGameKey, "Activity must map to a relatedGameKey");
      assert.ok(act.relatedDomain, "Activity must map to a relatedDomain");
      assert.ok(act.observedFinding, "Activity must cite observedFinding");
      assert.ok(
        act.observedFinding.includes("Ananya Verma"),
        "Observed finding must personalize to child"
      );
    }
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 5: Unassessed skills exclusion & Card Flip retry callout
  // ---------------------------------------------------------------------------
  it("Requirement 5: Unassessed skills are excluded from home recommendations; Card Flip retry note is populated", () => {
    // Unassessed Card Flip quest session
    const gamesWithoutCardFlip = CANONICAL_GAMES.map((cg) => {
      if (cg.key === "card-flip") {
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          assessmentStatus: "UNASSESSED",
          gameStatus: "UNASSESSED",
          levelsCompleted: 0,
          averageAccuracy: null,
          averageReactionTimeMs: null,
          levels: [],
        };
      }
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 85,
        averageReactionTimeMs: 1200,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 8,
          accuracy: 80,
          durationMs: 20000,
          averageReactionTimeMs: 1200,
        })),
      };
    });

    const input = createMockInput({ games: gamesWithoutCardFlip });
    const report = generateRuleBasedReport(input);

    // Must NOT recommend card-flip in scored parent recommendations
    for (const act of report.parentRecommendations) {
      if (typeof act !== "string") {
        assert.notEqual(
          act.relatedGameKey,
          "card-flip",
          "Unassessed game must not have scored activity recommendation"
        );
      }
    }

    // Must populate cardFlipRetryNote
    assert.ok(report.cardFlipRetryNote, "cardFlipRetryNote must be generated");
    assert.ok(
      report.cardFlipRetryNote.includes("did not explore Cosmic Card Flip"),
      "Note must explain Card Flip was not played"
    );
    assert.ok(
      report.cardFlipRetryNote.includes("picture-matching") ||
      report.cardFlipRetryNote.includes("card games"),
      "Note should warmly suggest home card play"
    );
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 6: Partially assessed games handled accurately
  // ---------------------------------------------------------------------------
  it("Requirement 6: Partially assessed games are handled accurately with actual completed levels cited", () => {
    const gamesWithPartial = CANONICAL_GAMES.map((cg) => {
      if (cg.key === "rule-discovery") {
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          assessmentStatus: "PARTIALLY_ASSESSED",
          gameStatus: "IN_PROGRESS",
          levelsCompleted: 2,
          averageAccuracy: 75,
          averageReactionTimeMs: 1300,
          levels: [
            { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 8, accuracy: 80, durationMs: 20000, averageReactionTimeMs: 1200 },
            { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 7, accuracy: 70, durationMs: 25000, averageReactionTimeMs: 1400 },
            { levelNumber: 3, attemptNumber: 1, status: "SKIPPED", totalTrials: null, correctTrials: null, accuracy: null, durationMs: null, averageReactionTimeMs: null },
          ],
        };
      }
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 88,
        averageReactionTimeMs: 1200,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 9,
          accuracy: 90,
          durationMs: 20000,
          averageReactionTimeMs: 1200,
        })),
      };
    });

    const input = createMockInput({ games: gamesWithPartial });
    const report = generateRuleBasedReport(input);

    // Rule discovery activity cites 2 completed levels
    const rdAct = report.parentRecommendations.find(
      (a) => typeof a !== "string" && a.relatedGameKey === "rule-discovery"
    );
    if (rdAct && typeof rdAct !== "string") {
      assert.ok(
        rdAct.observedFinding?.includes("2 completed levels"),
        "Observed finding must accurately reflect 2 completed levels"
      );
    }
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 7: 5-Page PDF strict page budget enforcement
  // ---------------------------------------------------------------------------
  it("Requirement 7: PDF generator strictly generates a 5-page PDF for standard assessed session", async () => {
    const input = createMockInput();
    const report = generateRuleBasedReport(input);

    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school || "Orion Public School",
      overallAccuracy: input.quest.overallAccuracy,
      totalDurationMs: input.quest.totalDurationMs,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      aiReport: report,
    });

    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.equal(
      pdfDoc.getPageCount(),
      5,
      `Standard PDF must strictly be 5 pages, got ${pdfDoc.getPageCount()}`
    );
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 8: 5-Page PDF with unassessed Card Flip
  // ---------------------------------------------------------------------------
  it("Requirement 8: PDF generator strictly generates a 5-page PDF when Card Flip is unassessed", async () => {
    const gamesWithoutCardFlip = CANONICAL_GAMES.map((cg) => {
      if (cg.key === "card-flip") {
        return {
          gameId: cg.id,
          gameKey: cg.key,
          gameName: cg.name,
          domain: cg.domain,
          assessmentStatus: "UNASSESSED",
          gameStatus: "UNASSESSED",
          levelsCompleted: 0,
          averageAccuracy: null,
          averageReactionTimeMs: null,
          levels: [],
        };
      }
      return {
        gameId: cg.id,
        gameKey: cg.key,
        gameName: cg.name,
        domain: cg.domain,
        assessmentStatus: "ASSESSED",
        gameStatus: "COMPLETED",
        levelsCompleted: 3,
        averageAccuracy: 85,
        averageReactionTimeMs: 1200,
        levels: [1, 2, 3].map((lvl) => ({
          levelNumber: lvl,
          attemptNumber: 1,
          status: "COMPLETED",
          totalTrials: 10,
          correctTrials: 8,
          accuracy: 80,
          durationMs: 20000,
          averageReactionTimeMs: 1200,
        })),
      };
    });

    const input = createMockInput({ games: gamesWithoutCardFlip });
    const report = generateRuleBasedReport(input);

    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school || "Orion Public School",
      overallAccuracy: 85,
      totalDurationMs: input.quest.totalDurationMs,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      aiReport: report,
    });

    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.equal(
      pdfDoc.getPageCount(),
      5,
      `PDF with unassessed Card Flip must strictly be 5 pages, got ${pdfDoc.getPageCount()}`
    );
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 9: 5-Page PDF with partially assessed games
  // ---------------------------------------------------------------------------
  it("Requirement 9: PDF generator strictly generates a 5-page PDF with partially assessed games", async () => {
    const gamesWithPartial = CANONICAL_GAMES.map((cg, idx) => ({
      gameId: cg.id,
      gameKey: cg.key,
      gameName: cg.name,
      domain: cg.domain,
      assessmentStatus: idx === 1 ? "PARTIALLY_ASSESSED" : "ASSESSED",
      gameStatus: idx === 1 ? "IN_PROGRESS" : "COMPLETED",
      levelsCompleted: idx === 1 ? 2 : 3,
      averageAccuracy: 82,
      averageReactionTimeMs: 1250,
      levels: [1, 2, 3].map((lvl) => ({
        levelNumber: lvl,
        attemptNumber: 1,
        status: idx === 1 && lvl === 3 ? "SKIPPED" : "COMPLETED",
        totalTrials: idx === 1 && lvl === 3 ? null : 10,
        correctTrials: idx === 1 && lvl === 3 ? null : 8,
        accuracy: idx === 1 && lvl === 3 ? null : 80,
        durationMs: idx === 1 && lvl === 3 ? null : 20000,
        averageReactionTimeMs: idx === 1 && lvl === 3 ? null : 1250,
      })),
    }));

    const input = createMockInput({ games: gamesWithPartial });
    const report = generateRuleBasedReport(input);

    const pdfBytes = await generateReportPdf({
      childName: input.child.childName,
      age: input.child.age,
      selectedClass: input.child.selectedClass,
      school: input.child.school || "Orion Public School",
      overallAccuracy: 82,
      totalDurationMs: input.quest.totalDurationMs,
      questCompletedAt: input.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      aiReport: report,
    });

    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.equal(
      pdfDoc.getPageCount(),
      5,
      `PDF with partially assessed games must strictly be 5 pages, got ${pdfDoc.getPageCount()}`
    );
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 10: Backward compatibility with legacy report schemas
  // ---------------------------------------------------------------------------
  it("Requirement 10: Legacy report without Phase 3 fields parses cleanly without validation errors", () => {
    const legacyReport = {
      reportTitle: "OrionKids Cognitive Exploration & Gameplay Report",
      childOverview: "A child exploring puzzles",
      questSummary: "Completed 18 levels",
      overallPerformanceSummary: "Dependable performance across activities",
      gameWiseAnalysis: [
        {
          gameKey: "stroop",
          gameName: "Stroop Colour-Word",
          cognitiveDomain: "Focus",
          gameStatus: "COMPLETED",
          levelsCompleted: 3,
          averageAccuracy: 90,
          averageReactionTimeMs: 1200,
          summary: "Great focus shown",
          observedStrengths: ["Stuck with challenge"],
          areasForPractice: ["Pacing"],
        },
      ],
      levelWisePerformance: [],
      observedStrengths: [
        {
          heading: "Focus Strength",
          cognitiveSkill: "Attention",
          observation: "Showed focus",
          performanceEvidence: "90%",
          educationalRelevance: "Great for school",
        },
      ],
      areasForPractice: [
        {
          heading: "Practice Area",
          cognitiveSkill: "Flexibility",
          observedPattern: "Varied pattern",
          performanceEvidence: "80%",
          recommendedApproach: "Family play",
        },
      ],
      progressAndConsistency: "Steady throughout",
      parentRecommendations: [
        {
          title: "Memory Card Pairs",
          description: "Play matching card games at home.",
          activityType: "Family Board Game",
        },
      ],
      dataLimitations: "Educational summary",
      reportGenerationDate: "2026-11-16T10:00:00Z",
    };

    const parsed = AiStructuredReportSchema.parse(legacyReport);
    assert.ok(parsed, "Legacy report must parse cleanly");
    assert.equal(parsed.whatDoesThisMean, undefined);
    assert.equal(parsed.shouldIWorry, undefined);
    assert.equal(parsed.startHere, undefined);
  });
});
