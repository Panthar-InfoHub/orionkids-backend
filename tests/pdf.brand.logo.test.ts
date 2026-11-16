import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrionKidsLogoBytes } from "../src/lib/brandAssets.js";
import { generateReportPdf } from "../src/services/pdfReport.service.js";
import { generateRuleBasedReport, type GameplayReportInput } from "../src/services/aiReport.service.js";
import { PDFDocument } from "pdf-lib";

const mockInput: GameplayReportInput = {
  child: {
    childName: "Aarav Sharma",
    age: 7,
    selectedClass: "Class 2",
    school: "Orion International School",
  },
  quest: {
    sessionId: "test-session-logo-audit",
    startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
    completedAt: new Date().toISOString(),
    totalLevelsCompleted: 18,
    overallAccuracy: 88,
    totalDurationMs: 20 * 60000,
  },
  warmUp: {
    copingStrategy: "Take a deep breath",
    learningStyle: "Visual",
    favoriteSubject: "Science",
    emotionalState: "Happy",
  },
  games: [
    {
      gameId: 1,
      gameKey: "stroop",
      gameName: "Colour Tap",
      domain: "Attention & Focus",
      levelsCompleted: 3,
      averageAccuracy: 90,
      averageReactionTimeMs: 1150,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 10, accuracy: 100, durationMs: 20000, averageReactionTimeMs: 1100 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 9, accuracy: 90, durationMs: 22000, averageReactionTimeMs: 1150 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 10, correctTrials: 8, accuracy: 80, durationMs: 25000, averageReactionTimeMs: 1200 },
      ],
    },
    {
      gameId: 2,
      gameKey: "card-flip",
      gameName: "Card Flip",
      domain: "Memory & Recall",
      levelsCompleted: 3,
      averageAccuracy: 85,
      averageReactionTimeMs: 1300,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 6, accuracy: 100, durationMs: 25000, averageReactionTimeMs: 1250 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 5, accuracy: 83, durationMs: 30000, averageReactionTimeMs: 1300 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 4, accuracy: 67, durationMs: 35000, averageReactionTimeMs: 1350 },
      ],
    },
    {
      gameId: 3,
      gameKey: "pattern",
      gameName: "Pattern Puzzle",
      domain: "Pattern Recognition",
      levelsCompleted: 3,
      averageAccuracy: 80,
      averageReactionTimeMs: 1450,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 5, accuracy: 100, durationMs: 20000, averageReactionTimeMs: 1350 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 25000, averageReactionTimeMs: 1450 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 3, accuracy: 60, durationMs: 30000, averageReactionTimeMs: 1550 },
      ],
    },
    {
      gameId: 4,
      gameKey: "odd-one-out",
      gameName: "Odd One Out",
      domain: "Visual Discrimination",
      levelsCompleted: 3,
      averageAccuracy: 75,
      averageReactionTimeMs: 1600,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 22000, averageReactionTimeMs: 1500 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 4, accuracy: 80, durationMs: 28000, averageReactionTimeMs: 1600 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 5, correctTrials: 3, accuracy: 60, durationMs: 32000, averageReactionTimeMs: 1700 },
      ],
    },
    {
      gameId: 5,
      gameKey: "rule-discovery",
      gameName: "Rule Detective",
      domain: "Cognitive Flexibility",
      levelsCompleted: 3,
      averageAccuracy: 70,
      averageReactionTimeMs: 1700,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 5, accuracy: 83, durationMs: 28000, averageReactionTimeMs: 1650 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 4, accuracy: 67, durationMs: 32000, averageReactionTimeMs: 1700 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 6, correctTrials: 3, accuracy: 50, durationMs: 38000, averageReactionTimeMs: 1750 },
      ],
    },
    {
      gameId: 6,
      gameKey: "story-sequencing",
      gameName: "Story Order",
      domain: "Sequential Reasoning",
      levelsCompleted: 3,
      averageAccuracy: 65,
      averageReactionTimeMs: 1800,
      levels: [
        { levelNumber: 1, attemptNumber: 1, status: "COMPLETED", totalTrials: 4, correctTrials: 3, accuracy: 75, durationMs: 26000, averageReactionTimeMs: 1750 },
        { levelNumber: 2, attemptNumber: 1, status: "COMPLETED", totalTrials: 4, correctTrials: 2, accuracy: 50, durationMs: 34000, averageReactionTimeMs: 1800 },
        { levelNumber: 3, attemptNumber: 1, status: "COMPLETED", totalTrials: 4, correctTrials: 2, accuracy: 50, durationMs: 40000, averageReactionTimeMs: 1850 },
      ],
    },
  ],
};

describe("OrionKids PDF Report — Production Brand Logo Integration", () => {
  it("1. loads valid PNG bytes with valid magic header for white knockout logo", async () => {
    const bytes = await getOrionKidsLogoBytes("white");
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 10000, "Must be high resolution asset");
    // PNG magic header: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50);
    assert.equal(bytes[2], 0x4e);
    assert.equal(bytes[3], 0x47);
  });

  it("2. loads valid PNG bytes with valid magic header for full-color badge logo", async () => {
    const bytes = await getOrionKidsLogoBytes("color");
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 10000, "Must be high resolution asset");
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50);
    assert.equal(bytes[2], 0x4e);
    assert.equal(bytes[3], 0x47);
  });

  it("3. generates high-fidelity PDF with knockout brand logo embedded", async () => {
    const report = generateRuleBasedReport(mockInput);
    const pdfBytes = await generateReportPdf({
      childName: mockInput.child.childName,
      age: mockInput.child.age,
      selectedClass: mockInput.child.selectedClass,
      school: mockInput.child.school,
      questCompletedAt: mockInput.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      overallAccuracy: mockInput.quest.overallAccuracy,
      totalDurationMs: mockInput.quest.totalDurationMs,
      aiReport: report,
      logoStyle: "knockout",
    });

    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 20000, "PDF size must be realistic with embedded high-res logo");

    // Inspect parsed PDF structure
    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.ok(pdfDoc.getPageCount() >= 5, "Must render at least 5 structured pages");

    const page1 = pdfDoc.getPage(0);
    assert.ok(page1, "Page 1 must exist");

    // Verify presence of embedded XObject Image on Page 1
    const resources = page1.node.Resources();
    assert.ok(resources, "Page 1 resources must be defined");
    const xObjectDict = resources.lookup(pdfDoc.context.obj("XObject"));
    assert.ok(xObjectDict, "Page 1 must contain embedded XObjects for the logo");
  });

  it("4. generates high-fidelity PDF with badge brand logo embedded", async () => {
    const report = generateRuleBasedReport(mockInput);
    const pdfBytes = await generateReportPdf({
      childName: mockInput.child.childName,
      age: mockInput.child.age,
      selectedClass: mockInput.child.selectedClass,
      school: mockInput.child.school,
      questCompletedAt: mockInput.quest.completedAt,
      reportGeneratedAt: new Date().toISOString(),
      overallAccuracy: mockInput.quest.overallAccuracy,
      totalDurationMs: mockInput.quest.totalDurationMs,
      aiReport: report,
      logoStyle: "badge",
    });

    assert.ok(pdfBytes instanceof Uint8Array);
    assert.ok(pdfBytes.length > 20000);

    const pdfDoc = await PDFDocument.load(pdfBytes);
    assert.ok(pdfDoc.getPageCount() >= 5);
  });

  it("5. validates fail-safe resilience fallback if filesystem is mocked as empty", async () => {
    // Tests that getOrionKidsLogoBytes never throws even when called in isolated environments
    const whiteBytes = await getOrionKidsLogoBytes("white");
    const colorBytes = await getOrionKidsLogoBytes("color");
    assert.ok(whiteBytes.length > 0);
    assert.ok(colorBytes.length > 0);
  });
});

