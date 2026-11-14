import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import { logger } from "../lib/logger.js";
import type {
  AiStructuredReport,
  ObservedStrengthItem,
  AreaForPracticeItem,
  HomeActivityItem,
} from "./aiReport.service.js";

export interface PdfReportData {
  childName: string;
  age: number;
  selectedClass: string;
  school: string | null;
  questCompletedAt: string | null;
  reportGeneratedAt: string;
  overallAccuracy: number;
  totalDurationMs: number;
  aiReport: AiStructuredReport;
}

// ---------------------------------------------------------------------------
// OrionKids Brand Color Palette
// ---------------------------------------------------------------------------
const BRAND_NAVY = rgb(10 / 255, 29 / 255, 61 / 255); // #0A1D3D
const BRAND_GOLD = rgb(255 / 255, 208 / 255, 40 / 255); // #FFD028
const BRAND_CYAN = rgb(0 / 255, 188 / 255, 212 / 255); // #00BCD4
const BRAND_AMBER = rgb(217 / 255, 119 / 255, 6 / 255); // #D97706
const TEXT_DARK = rgb(30 / 255, 41 / 255, 59 / 255); // #1E293B
const TEXT_MUTED = rgb(100 / 255, 116 / 255, 139 / 255); // #64748B
const BG_LIGHT = rgb(248 / 255, 250 / 255, 252 / 255); // #F8FAFC
const BG_CARD = rgb(255 / 255, 255 / 255, 255 / 255);
const BORDER_COLOR = rgb(226 / 255, 232 / 255, 240 / 255); // #E2E8F0
const WHITE = rgb(1, 1, 1);
const SUCCESS_GREEN = rgb(16 / 255, 185 / 255, 129 / 255); // #10B981
const SOFT_AMBER_BG = rgb(254 / 255, 243 / 255, 199 / 255); // #FEF3C7
const SOFT_GREEN_BG = rgb(236 / 255, 253 / 255, 245 / 255); // #ECFDF5

const PAGE_WIDTH = 595.28; // Standard A4 width
const PAGE_HEIGHT = 841.89; // Standard A4 height
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ---------------------------------------------------------------------------
// Typography & Layout Helpers
// ---------------------------------------------------------------------------

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function formatStrength(item: any): {
  heading: string;
  skill: string;
  observation: string;
  evidence: string;
  relevance: string;
} {
  if (typeof item === "string") {
    return {
      heading: "Demonstrated Cognitive Proficiency",
      skill: "Core Cognitive Skill",
      observation: item,
      evidence: item,
      relevance:
        "Supports structured classroom learning, attention, and independent problem-solving.",
    };
  }
  return {
    heading: item.heading || "Demonstrated Cognitive Proficiency",
    skill: item.cognitiveSkill || "Core Cognitive Skill",
    observation: item.observation || "",
    evidence: item.performanceEvidence || "",
    relevance: item.educationalRelevance || "",
  };
}

function formatPracticeArea(item: any): {
  heading: string;
  skill: string;
  pattern: string;
  evidence: string;
  approach: string;
} {
  if (typeof item === "string") {
    return {
      heading: "Area for Playful Growth",
      skill: "Developing Cognitive Skill",
      pattern: item,
      evidence: item,
      approach:
        "Engage in playful, everyday household routines that exercise this skill in a low-pressure environment.",
    };
  }
  return {
    heading: item.heading || "Area for Playful Growth",
    skill: item.cognitiveSkill || "Developing Cognitive Skill",
    pattern: item.observedPattern || "",
    evidence: item.performanceEvidence || "",
    approach: item.recommendedApproach || "",
  };
}

function formatHomeActivity(item: any): {
  title: string;
  skills: string[];
  materials: string[];
  instructions: string[];
  duration: string;
  progression: string;
  opportunity: string;
  tip: string;
} {
  return {
    title: item.title || "Home Exploration Activity",
    skills: Array.isArray(item.skillsPracticed) && item.skillsPracticed.length > 0
      ? item.skillsPracticed
      : ["Cognitive Play", "Creative Thinking"],
    materials: Array.isArray(item.materials) && item.materials.length > 0
      ? item.materials
      : ["Everyday household objects"],
    instructions: Array.isArray(item.instructions) && item.instructions.length > 0
      ? item.instructions
      : [
          item.description ||
            "Engage in hands-on playful problem solving together with your child.",
        ],
    duration: item.suggestedDuration || "10–15 minutes",
    progression: item.difficultyProgression || "",
    opportunity:
      item.learningOpportunity ||
      item.description ||
      "Provides an opportunity to exercise cognitive flexibility and focused attention through play.",
    tip:
      item.parentTip ||
      "Praise curiosity and creative exploration rather than focusing solely on correct answers.",
  };
}

// ---------------------------------------------------------------------------
// Main PDF Report Generation Pipeline
// ---------------------------------------------------------------------------

export async function generateReportPdf(
  data: PdfReportData
): Promise<Uint8Array> {
  const startTime = Date.now();
  logger.info(
    { childName: data.childName, reportGeneratedAt: data.reportGeneratedAt },
    "pdf_report.generation_started"
  );

  try {
    const doc = await PDFDocument.create();
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

    let currentPage: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    const checkPageBreak = (neededHeight: number) => {
      if (y - neededHeight < MARGIN + 35) {
        currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        drawPageHeader();
      }
    };

    const drawPageHeader = () => {
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - 2,
        width: CONTENT_WIDTH,
        height: 1,
        color: BORDER_COLOR,
      });
      currentPage.drawText("OrionKids · Cognitive Assessment Report", {
        x: MARGIN,
        y: y + 4,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      currentPage.drawText(data.childName, {
        x: PAGE_WIDTH - MARGIN - fontBold.widthOfTextAtSize(data.childName, 8),
        y: y + 4,
        size: 8,
        font: fontBold,
        color: BRAND_NAVY,
      });
      y -= 20;
    };

    // =========================================================================
    // PAGE 1: COVER / TOP BRAND HEADER
    // =========================================================================
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 56,
      width: CONTENT_WIDTH,
      height: 56,
      color: BRAND_NAVY,
    });

    // Top gold accent bar
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 4,
      width: CONTENT_WIDTH,
      height: 4,
      color: BRAND_GOLD,
    });

    currentPage.drawText("ORIONKIDS", {
      x: MARGIN + 16,
      y: y - 24,
      size: 16,
      font: fontBold,
      color: BRAND_GOLD,
    });

    currentPage.drawText("COGNITIVE EXPLORATION & PERFORMANCE REPORT", {
      x: MARGIN + 16,
      y: y - 42,
      size: 9,
      font: fontRegular,
      color: WHITE,
    });

    const completionDateStr = data.questCompletedAt
      ? new Date(data.questCompletedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

    currentPage.drawText(`Date: ${completionDateStr}`, {
      x: PAGE_WIDTH - MARGIN - 130,
      y: y - 24,
      size: 9,
      font: fontRegular,
      color: WHITE,
    });

    currentPage.drawText("Authoritative Record", {
      x: PAGE_WIDTH - MARGIN - 130,
      y: y - 42,
      size: 8,
      font: fontBold,
      color: SUCCESS_GREEN,
    });

    y -= 72;

    // =========================================================================
    // CHILD PROFILE CARD
    // =========================================================================
    const cardHeight = 64;
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - cardHeight,
      width: CONTENT_WIDTH,
      height: cardHeight,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 1,
    });

    const durationMin = Math.round(data.totalDurationMs / 60000);

    // Left column: Child metadata
    currentPage.drawText(`Child: ${data.childName}`, {
      x: MARGIN + 16,
      y: y - 20,
      size: 13,
      font: fontBold,
      color: BRAND_NAVY,
    });

    const classInfo = `${data.selectedClass} · Age ${data.age}${data.school ? ` · ${data.school}` : ""}`;
    currentPage.drawText(classInfo, {
      x: MARGIN + 16,
      y: y - 36,
      size: 9,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    currentPage.drawText(`Quest Completed: ${completionDateStr}`, {
      x: MARGIN + 16,
      y: y - 50,
      size: 8,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    // Right column: Key metrics badge
    currentPage.drawText("Overall Accuracy", {
      x: PAGE_WIDTH - MARGIN - 160,
      y: y - 22,
      size: 8,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    currentPage.drawText(`${Math.round(data.overallAccuracy)}%`, {
      x: PAGE_WIDTH - MARGIN - 160,
      y: y - 44,
      size: 18,
      font: fontBold,
      color: BRAND_NAVY,
    });

    currentPage.drawText("Play Duration", {
      x: PAGE_WIDTH - MARGIN - 75,
      y: y - 22,
      size: 8,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    currentPage.drawText(`${durationMin} min`, {
      x: PAGE_WIDTH - MARGIN - 75,
      y: y - 44,
      size: 18,
      font: fontBold,
      color: BRAND_NAVY,
    });

    y -= cardHeight + 18;

    // =========================================================================
    // EXECUTIVE JOURNEY SUMMARY (100–150 words)
    // =========================================================================
    checkPageBreak(80);
    currentPage.drawText("EXECUTIVE JOURNEY SUMMARY", {
      x: MARGIN,
      y,
      size: 11,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    const summaryText =
      data.aiReport.overallPerformanceSummary ||
      data.aiReport.questSummary ||
      "";
    const summaryLines = wrapText(summaryText, fontRegular, 8.5, CONTENT_WIDTH);

    for (const line of summaryLines) {
      checkPageBreak(13);
      currentPage.drawText(line, {
        x: MARGIN,
        y,
        size: 8.5,
        font: fontRegular,
        color: TEXT_DARK,
        lineHeight: 12.5,
      });
      y -= 12.5;
    }

    y -= 12;

    // =========================================================================
    // SIX COGNITIVE DOMAINS SUMMARY TABLE
    // =========================================================================
    checkPageBreak(170);
    currentPage.drawText("SIX COGNITIVE DOMAINS SUMMARY", {
      x: MARGIN,
      y,
      size: 11,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 16;

    // Table Header
    const tableHeaderHeight = 20;
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - tableHeaderHeight,
      width: CONTENT_WIDTH,
      height: tableHeaderHeight,
      color: BRAND_NAVY,
    });

    currentPage.drawText("Game & Domain", {
      x: MARGIN + 10,
      y: y - 14,
      size: 8,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("Levels Done", {
      x: MARGIN + 260,
      y: y - 14,
      size: 8,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("Accuracy", {
      x: MARGIN + 350,
      y: y - 14,
      size: 8,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("Avg Pace", {
      x: MARGIN + 430,
      y: y - 14,
      size: 8,
      font: fontBold,
      color: WHITE,
    });

    y -= tableHeaderHeight;

    const gamesList = data.aiReport.gameWiseAnalysis || [];
    for (let i = 0; i < gamesList.length; i++) {
      const g = gamesList[i];
      if (!g) continue;
      checkPageBreak(24);

      const isEven = i % 2 === 0;
      if (isEven) {
        currentPage.drawRectangle({
          x: MARGIN,
          y: y - 22,
          width: CONTENT_WIDTH,
          height: 22,
          color: BG_LIGHT,
        });
      }

      currentPage.drawRectangle({
        x: MARGIN,
        y: y - 22,
        width: CONTENT_WIDTH,
        height: 0.5,
        color: BORDER_COLOR,
      });

      currentPage.drawText(`${g.gameName}`, {
        x: MARGIN + 10,
        y: y - 11,
        size: 8.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      currentPage.drawText(`(${g.cognitiveDomain})`, {
        x: MARGIN + 10,
        y: y - 20,
        size: 7,
        font: fontOblique,
        color: TEXT_MUTED,
      });

      currentPage.drawText(`${g.levelsCompleted}/3 Levels`, {
        x: MARGIN + 260,
        y: y - 14,
        size: 8,
        font: fontRegular,
        color: TEXT_DARK,
      });

      const accStr =
        g.averageAccuracy !== null ? `${Math.round(g.averageAccuracy)}%` : "—";
      currentPage.drawText(accStr, {
        x: MARGIN + 350,
        y: y - 14,
        size: 8.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      const rtStr = g.averageReactionTimeMs
        ? `${(g.averageReactionTimeMs / 1000).toFixed(1)}s`
        : "—";
      currentPage.drawText(rtStr, {
        x: MARGIN + 430,
        y: y - 14,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      });

      y -= 22;
    }

    y -= 14;

    // =========================================================================
    // 18-LEVEL GAMEPLAY BREAKDOWN MATRIX
    // =========================================================================
    checkPageBreak(115);
    currentPage.drawText("18-LEVEL GAMEPLAY BREAKDOWN", {
      x: MARGIN,
      y,
      size: 11,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 16;

    const levels = data.aiReport.levelWisePerformance || [];
    const colWidth = CONTENT_WIDTH / 6;
    const uniqueGames = [
      "stroop",
      "card-flip",
      "pattern",
      "odd-one-out",
      "rule-discovery",
      "story-sequencing",
    ];
    const gameLabels: Record<string, string> = {
      stroop: "Stroop",
      "card-flip": "Card Flip",
      pattern: "Pattern",
      "odd-one-out": "Odd One",
      "rule-discovery": "Rule Disc.",
      "story-sequencing": "Story Seq.",
    };

    const boxHeight = 68;
    for (let gIdx = 0; gIdx < uniqueGames.length; gIdx++) {
      const gKey = uniqueGames[gIdx];
      if (!gKey) continue;
      const gx = MARGIN + gIdx * colWidth;

      currentPage.drawRectangle({
        x: gx,
        y: y - 16,
        width: colWidth - 4,
        height: 16,
        color: BRAND_NAVY,
      });

      currentPage.drawText(gameLabels[gKey] || gKey, {
        x: gx + 4,
        y: y - 12,
        size: 7.5,
        font: fontBold,
        color: WHITE,
      });

      for (let lvl = 1; lvl <= 3; lvl++) {
        const match = levels.find(
          (l) => l.gameKey === gKey && l.levelNumber === lvl
        );
        const ly = y - 16 - lvl * 16;

        currentPage.drawRectangle({
          x: gx,
          y: ly,
          width: colWidth - 4,
          height: 15,
          color: lvl % 2 === 0 ? BG_LIGHT : WHITE,
          borderColor: BORDER_COLOR,
          borderWidth: 0.5,
        });

        const accText =
          match?.accuracy !== null && match?.accuracy !== undefined
            ? `${match.accuracy}%`
            : "Done";
        currentPage.drawText(`L${lvl}: ${accText}`, {
          x: gx + 4,
          y: ly + 4,
          size: 7,
          font: fontRegular,
          color: TEXT_DARK,
        });
      }
    }

    y -= boxHeight + 20;

    // =========================================================================
    // OBSERVED STRENGTHS SECTION (Detailed, Evidence-Based Cards)
    // =========================================================================
    checkPageBreak(120);
    currentPage.drawText("OBSERVED STRENGTHS & COGNITIVE PROFICIENCIES", {
      x: MARGIN,
      y,
      size: 11,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    const rawStrengths = data.aiReport.observedStrengths || [];
    for (let sIdx = 0; sIdx < rawStrengths.length; sIdx++) {
      const st = formatStrength(rawStrengths[sIdx]);

      const obsLines = wrapText(st.observation, fontRegular, 8, CONTENT_WIDTH - 20);
      const evLines = wrapText(
        `Gameplay Evidence: ${st.evidence}`,
        fontRegular,
        7.5,
        CONTENT_WIDTH - 20
      );
      const relLines = wrapText(
        `Educational Relevance: ${st.relevance}`,
        fontOblique,
        7.5,
        CONTENT_WIDTH - 20
      );

      const itemHeight =
        24 +
        obsLines.length * 11 +
        evLines.length * 10 +
        relLines.length * 10 +
        12;

      checkPageBreak(itemHeight + 8);

      // Card Background with Green Accent
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - itemHeight,
        width: CONTENT_WIDTH,
        height: itemHeight,
        color: BG_LIGHT,
        borderColor: rgb(167 / 255, 243 / 255, 208 / 255), // light emerald
        borderWidth: 1,
      });

      // Left Accent Strip
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - itemHeight,
        width: 3.5,
        height: itemHeight,
        color: SUCCESS_GREEN,
      });

      // Header: Strength Heading + Domain
      currentPage.drawText(st.heading, {
        x: MARGIN + 12,
        y: y - 14,
        size: 9,
        font: fontBold,
        color: SUCCESS_GREEN,
      });

      currentPage.drawText(`· ${st.skill}`, {
        x:
          MARGIN +
          14 +
          fontBold.widthOfTextAtSize(st.heading, 9),
        y: y - 14,
        size: 8,
        font: fontOblique,
        color: TEXT_MUTED,
      });

      let currentTextY = y - 26;

      // Observation Body
      for (const line of obsLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 8,
          font: fontRegular,
          color: TEXT_DARK,
        });
        currentTextY -= 11;
      }

      currentTextY -= 2;

      // Performance Evidence
      for (const line of evLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 7.5,
          font: fontRegular,
          color: BRAND_NAVY,
        });
        currentTextY -= 10;
      }

      // Educational Relevance
      for (const line of relLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 7.5,
          font: fontOblique,
          color: TEXT_MUTED,
        });
        currentTextY -= 10;
      }

      y -= itemHeight + 10;
    }

    y -= 10;

    // =========================================================================
    // AREAS FOR FURTHER PRACTICE (Detailed Growth Cards)
    // =========================================================================
    checkPageBreak(120);
    currentPage.drawText("AREAS FOR PLAYFUL PRACTICE & GROWTH", {
      x: MARGIN,
      y,
      size: 11,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    const rawPractice = data.aiReport.areasForPractice || [];
    for (let pIdx = 0; pIdx < rawPractice.length; pIdx++) {
      const pr = formatPracticeArea(rawPractice[pIdx]);

      const patLines = wrapText(pr.pattern, fontRegular, 8, CONTENT_WIDTH - 20);
      const evLines = wrapText(
        `Recorded Pattern: ${pr.evidence}`,
        fontRegular,
        7.5,
        CONTENT_WIDTH - 20
      );
      const appLines = wrapText(
        `Playful Recommendation: ${pr.approach}`,
        fontRegular,
        7.5,
        CONTENT_WIDTH - 20
      );

      const itemHeight =
        24 +
        patLines.length * 11 +
        evLines.length * 10 +
        appLines.length * 10 +
        12;

      checkPageBreak(itemHeight + 8);

      // Card Background with Amber Accent
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - itemHeight,
        width: CONTENT_WIDTH,
        height: itemHeight,
        color: BG_LIGHT,
        borderColor: rgb(254 / 255, 230 / 255, 138 / 255), // light amber
        borderWidth: 1,
      });

      // Left Accent Strip
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - itemHeight,
        width: 3.5,
        height: itemHeight,
        color: BRAND_AMBER,
      });

      currentPage.drawText(pr.heading, {
        x: MARGIN + 12,
        y: y - 14,
        size: 9,
        font: fontBold,
        color: BRAND_AMBER,
      });

      currentPage.drawText(`· ${pr.skill}`, {
        x:
          MARGIN +
          14 +
          fontBold.widthOfTextAtSize(pr.heading, 9),
        y: y - 14,
        size: 8,
        font: fontOblique,
        color: TEXT_MUTED,
      });

      let currentTextY = y - 26;

      for (const line of patLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 8,
          font: fontRegular,
          color: TEXT_DARK,
        });
        currentTextY -= 11;
      }

      currentTextY -= 2;

      for (const line of evLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 7.5,
          font: fontRegular,
          color: BRAND_NAVY,
        });
        currentTextY -= 10;
      }

      for (const line of appLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: currentTextY,
          size: 7.5,
          font: fontRegular,
          color: BRAND_AMBER,
        });
        currentTextY -= 10;
      }

      y -= itemHeight + 10;
    }

    y -= 14;

    // =========================================================================
    // PAGE 2+: PARENT-FRIENDLY HOME ACTIVITIES (Full Step-by-Step Cards)
    // =========================================================================
    // Always start Parent Guidance with a dedicated section break
    checkPageBreak(160);

    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 32,
      width: CONTENT_WIDTH,
      height: 32,
      color: BRAND_NAVY,
    });

    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 3,
      width: CONTENT_WIDTH,
      height: 3,
      color: BRAND_GOLD,
    });

    currentPage.drawText("PARENT-FRIENDLY HOME ACTIVITIES & PRACTICE ROUTINES", {
      x: MARGIN + 12,
      y: y - 16,
      size: 10,
      font: fontBold,
      color: BRAND_GOLD,
    });

    currentPage.drawText(
      "Screen-free, enjoyable household activities designed to nurture developing skills through everyday family play",
      {
        x: MARGIN + 12,
        y: y - 26,
        size: 7.5,
        font: fontRegular,
        color: WHITE,
      }
    );

    y -= 44;

    const activities = data.aiReport.parentRecommendations || [];
    for (let aIdx = 0; aIdx < activities.length; aIdx++) {
      const act = formatHomeActivity(activities[aIdx]);

      // Pre-wrap all lines to compute exact card height
      const skillsStr = `Skills Practiced: ${act.skills.join(", ")}`;
      const skillsLines = wrapText(skillsStr, fontBold, 8, CONTENT_WIDTH - 24);

      const matStr = `Materials: ${act.materials.join(", ")}`;
      const matLines = wrapText(matStr, fontRegular, 8, CONTENT_WIDTH - 24);

      const instructionStepLines: string[][] = act.instructions.map(
        (step, idx) => wrapText(`${idx + 1}. ${step}`, fontRegular, 8, CONTENT_WIDTH - 30)
      );

      const oppLines = wrapText(
        `Learning Opportunity: ${act.opportunity}`,
        fontRegular,
        7.5,
        CONTENT_WIDTH - 24
      );

      const tipLines = wrapText(
        `Parent Tip: ${act.tip}`,
        fontOblique,
        7.5,
        CONTENT_WIDTH - 32
      );

      // Compute total card height
      let stepsHeight = 0;
      for (const sLines of instructionStepLines) {
        stepsHeight += sLines.length * 10.5 + 3;
      }

      const tipBoxHeight = tipLines.length * 10 + 12;

      const cardTotalHeight =
        26 + // Header with Title & Duration
        skillsLines.length * 11 +
        matLines.length * 11 +
        12 + // Instructions Title
        stepsHeight +
        oppLines.length * 10 +
        tipBoxHeight +
        16; // Margins & Padding

      checkPageBreak(cardTotalHeight + 10);

      // Card Outer Box
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - cardTotalHeight,
        width: CONTENT_WIDTH,
        height: cardTotalHeight,
        color: BG_LIGHT,
        borderColor: BORDER_COLOR,
        borderWidth: 1,
      });

      // Card Header Banner
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - 24,
        width: CONTENT_WIDTH,
        height: 24,
        color: rgb(241 / 255, 245 / 255, 249 / 255), // light slate
      });

      currentPage.drawText(`Activity ${aIdx + 1}: ${act.title}`, {
        x: MARGIN + 12,
        y: y - 16,
        size: 9.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      currentPage.drawText(`Duration: ${act.duration}`, {
        x:
          PAGE_WIDTH -
          MARGIN -
          fontBold.widthOfTextAtSize(`Duration: ${act.duration}`, 8) -
          12,
        y: y - 16,
        size: 8,
        font: fontBold,
        color: BRAND_CYAN,
      });

      let cardY = y - 36;

      // Skills Practiced
      for (const line of skillsLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: cardY,
          size: 8,
          font: fontBold,
          color: BRAND_NAVY,
        });
        cardY -= 11;
      }

      // Materials
      for (const line of matLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: cardY,
          size: 8,
          font: fontRegular,
          color: TEXT_DARK,
        });
        cardY -= 11;
      }

      cardY -= 3;

      // Instructions Title
      currentPage.drawText("Step-by-Step Instructions:", {
        x: MARGIN + 12,
        y: cardY,
        size: 8,
        font: fontBold,
        color: BRAND_NAVY,
      });
      cardY -= 11;

      // Numbered Steps
      for (const sLines of instructionStepLines) {
        for (let lIdx = 0; lIdx < sLines.length; lIdx++) {
          currentPage.drawText(sLines[lIdx]!, {
            x: MARGIN + (lIdx === 0 ? 14 : 22),
            y: cardY,
            size: 8,
            font: fontRegular,
            color: TEXT_DARK,
          });
          cardY -= 10.5;
        }
        cardY -= 2;
      }

      cardY -= 2;

      // Learning Opportunity
      for (const line of oppLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: cardY,
          size: 7.5,
          font: fontRegular,
          color: TEXT_MUTED,
        });
        cardY -= 10;
      }

      cardY -= 4;

      // Parent Tip Callout Box
      currentPage.drawRectangle({
        x: MARGIN + 10,
        y: cardY - tipBoxHeight + 8,
        width: CONTENT_WIDTH - 20,
        height: tipBoxHeight,
        color: SOFT_AMBER_BG,
        borderColor: rgb(253 / 255, 230 / 255, 138 / 255),
        borderWidth: 0.5,
      });

      let tipTextY = cardY - 4;
      for (const line of tipLines) {
        currentPage.drawText(line, {
          x: MARGIN + 16,
          y: tipTextY,
          size: 7.5,
          font: fontOblique,
          color: rgb(146 / 255, 64 / 255, 14 / 255), // dark amber
        });
        tipTextY -= 10;
      }

      y -= cardTotalHeight + 12;
    }

    // =========================================================================
    // IMPORTANT EDUCATIONAL ASSESSMENT DISCLAIMER
    // =========================================================================
    checkPageBreak(65);

    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 50,
      width: CONTENT_WIDTH,
      height: 50,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });

    currentPage.drawText("IMPORTANT EDUCATIONAL ASSESSMENT DISCLAIMER", {
      x: MARGIN + 12,
      y: y - 14,
      size: 7.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    const disclaimerText =
      data.aiReport.dataLimitations ||
      "This report provides educational observations based solely on child digital gameplay across 18 levels. It is designed to encourage learning curiosity, celebrate strengths, and recommend positive everyday play. It is not a clinical assessment, medical diagnosis, or psychological evaluation.";

    const discLines = wrapText(
      disclaimerText,
      fontRegular,
      7,
      CONTENT_WIDTH - 24
    );

    let dy = y - 25;
    for (const dl of discLines.slice(0, 3)) {
      currentPage.drawText(dl, {
        x: MARGIN + 12,
        y: dy,
        size: 7,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      dy -= 9;
    }

    // =========================================================================
    // DYNAMIC PAGE NUMBERING & FOOTERS (All Pages)
    // =========================================================================
    const totalPages = doc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const page = doc.getPage(i);
      const footerText = `Page ${i + 1} of ${totalPages} · OrionKids Cognitive Exploration Platform · Generated on ${new Date(
        data.reportGeneratedAt
      ).toLocaleDateString()}`;

      page.drawText(footerText, {
        x: MARGIN,
        y: MARGIN - 15,
        size: 7.5,
        font: fontRegular,
        color: TEXT_MUTED,
      });
    }

    const pdfBytes = await doc.save();
    const durationMs = Date.now() - startTime;
    logger.info(
      {
        childName: data.childName,
        pageCount: totalPages,
        byteSize: pdfBytes.length,
        durationMs,
      },
      "pdf_report.generation_completed"
    );
    return pdfBytes;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    logger.error(
      {
        childName: data.childName,
        durationMs,
        err: err instanceof Error ? err.message : String(err),
      },
      "pdf_report.generation_failed"
    );
    throw err;
  }
}
