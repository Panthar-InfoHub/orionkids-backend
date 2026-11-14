import fs from "fs";
import { generateRuleBasedReport, type GameplayReportInput } from "../src/services/aiReport.service.js";
import { generateReportPdf } from "../src/services/pdfReport.service.js";

const input: GameplayReportInput = {
  child: {
    childName: "Ananya Verma",
    age: 6,
    selectedClass: "Class 1",
    school: "Orion Public School",
  },
  quest: {
    sessionId: "sample-session-123",
    startedAt: new Date(Date.now() - 18 * 60000).toISOString(),
    completedAt: new Date().toISOString(),
    totalLevelsCompleted: 18,
    overallAccuracy: 82,
    totalDurationMs: 18 * 60000,
  },
  warmUp: {
    copingStrategy: "Take a deep breath",
    learningStyle: "Visual",
    favoriteSubject: "Art",
    emotionalState: "Happy",
  },
  games: [
    {
      gameId: 1,
      gameKey: "stroop",
      gameName: "Colour Tap",
      domain: "Attention & Focus",
      levelsCompleted: 3,
      averageAccuracy: 89,
      averageReactionTimeMs: 1200,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 10, accuracy: 100, durationMs: 25000, averageReactionTimeMs: 1100 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 9, accuracy: 90, durationMs: 28000, averageReactionTimeMs: 1250 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 8, accuracy: 80, durationMs: 32000, averageReactionTimeMs: 1300 },
      ],
    },
    {
      gameId: 2,
      gameKey: "card-flip",
      gameName: "Card Flip",
      domain: "Memory & Recall",
      levelsCompleted: 3,
      averageAccuracy: 84,
      averageReactionTimeMs: 1400,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 4, correctTrials: 4, accuracy: 100, durationMs: 20000, averageReactionTimeMs: 1300 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 5, accuracy: 83, durationMs: 35000, averageReactionTimeMs: 1450 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 8, correctTrials: 6, accuracy: 75, durationMs: 45000, averageReactionTimeMs: 1500 },
      ],
    },
    {
      gameId: 3,
      gameKey: "pattern",
      gameName: "Pattern Puzzle",
      domain: "Pattern Recognition",
      levelsCompleted: 3,
      averageAccuracy: 78,
      averageReactionTimeMs: 1600,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 5, accuracy: 100, durationMs: 22000, averageReactionTimeMs: 1400 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 28000, averageReactionTimeMs: 1650 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 3, accuracy: 60, durationMs: 36000, averageReactionTimeMs: 1800 },
      ],
    },
    {
      gameId: 4,
      gameKey: "odd-one-out",
      gameName: "Odd One Out",
      domain: "Visual Discrimination",
      levelsCompleted: 3,
      averageAccuracy: 73,
      averageReactionTimeMs: 1750,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 24000, averageReactionTimeMs: 1600 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 30000, averageReactionTimeMs: 1750 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 3, accuracy: 60, durationMs: 38000, averageReactionTimeMs: 1900 },
      ],
    },
    {
      gameId: 5,
      gameKey: "rule-discovery",
      gameName: "Rule Detective",
      domain: "Cognitive Flexibility",
      levelsCompleted: 3,
      averageAccuracy: 67,
      averageReactionTimeMs: 1900,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 5, accuracy: 83, durationMs: 30000, averageReactionTimeMs: 1800 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 4, accuracy: 67, durationMs: 38000, averageReactionTimeMs: 1950 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 3, accuracy: 50, durationMs: 45000, averageReactionTimeMs: 2100 },
      ],
    },
    {
      gameId: 6,
      gameKey: "story-sequencing",
      gameName: "Story Order",
      domain: "Sequential Reasoning",
      levelsCompleted: 3,
      averageAccuracy: 60,
      averageReactionTimeMs: 2100,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 3, correctTrials: 3, accuracy: 100, durationMs: 25000, averageReactionTimeMs: 1900 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 4, correctTrials: 2, accuracy: 50, durationMs: 40000, averageReactionTimeMs: 2100 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 1, accuracy: 20, durationMs: 50000, averageReactionTimeMs: 2300 },
      ],
    },
  ],
};

async function main() {
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

  fs.writeFileSync("/home/dev/codes/orionkids-frontend/sample_after.pdf", Buffer.from(pdfBytes));
  console.log("Wrote /home/dev/codes/orionkids-frontend/sample_after.pdf");
}

main().catch(console.error);
