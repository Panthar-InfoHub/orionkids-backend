import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import type { AiStructuredReport } from "./aiReport.service.js";

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

const BRAND_NAVY = rgb(10 / 255, 29 / 255, 61 / 255); // #0A1D3D
const BRAND_GOLD = rgb(255 / 255, 208 / 255, 40 / 255); // #FFD028
const BRAND_CYAN = rgb(0 / 255, 188 / 255, 212 / 255); // #00BCD4
const TEXT_DARK = rgb(30 / 255, 41 / 255, 59 / 255); // #1E293B
const TEXT_MUTED = rgb(100 / 255, 116 / 255, 139 / 255); // #64748B
const BG_LIGHT = rgb(248 / 255, 250 / 255, 252 / 255); // #F8FAFC
const BORDER_COLOR = rgb(226 / 255, 232 / 255, 240 / 255); // #E2E8F0
const WHITE = rgb(1, 1, 1);
const SUCCESS_GREEN = rgb(16 / 255, 185 / 255, 129 / 255); // #10B981

const PAGE_WIDTH = 595.28; // Standard A4 width
const PAGE_HEIGHT = 841.89; // Standard A4 height
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
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

export async function generateReportPdf(data: PdfReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let currentPage: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const checkPageBreak = (neededHeight: number) => {
    if (y - neededHeight < MARGIN + 40) {
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

  // --- COVER / TOP HEADER ---
  currentPage.drawRectangle({
    x: MARGIN,
    y: y - 56,
    width: CONTENT_WIDTH,
    height: 56,
    color: BRAND_NAVY,
  });

  // Top accent bar
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

  // --- CHILD INFO CARD ---
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

  // Left column: Child details
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

  y -= cardHeight + 20;

  // --- EXECUTIVE SUMMARY SECTION ---
  checkPageBreak(80);
  currentPage.drawText("EXECUTIVE JOURNEY SUMMARY", {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: BRAND_NAVY,
  });
  y -= 14;

  const summaryLines = wrapText(
    data.aiReport.overallPerformanceSummary || data.aiReport.questSummary,
    fontRegular,
    9,
    CONTENT_WIDTH
  );

  for (const line of summaryLines) {
    checkPageBreak(14);
    currentPage.drawText(line, {
      x: MARGIN,
      y,
      size: 9,
      font: fontRegular,
      color: TEXT_DARK,
      lineHeight: 13,
    });
    y -= 13;
  }

  y -= 12;

  // --- 6 GAMES PERFORMANCE TABLE ---
  checkPageBreak(170);
  currentPage.drawText("SIX COGNITIVE DOMAINS SUMMARY", {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: BRAND_NAVY,
  });
  y -= 16;

  // Table header
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

  // Render rows for the 6 games
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

    // Border line under row
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

    const accStr = g.averageAccuracy !== null ? `${Math.round(g.averageAccuracy)}%` : "—";
    currentPage.drawText(accStr, {
      x: MARGIN + 350,
      y: y - 14,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    const rtStr = g.averageReactionTimeMs ? `${(g.averageReactionTimeMs / 1000).toFixed(1)}s` : "—";
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

  // --- 18 LEVELS PROGRESSION BREAKDOWN ---
  checkPageBreak(120);
  currentPage.drawText("18-LEVEL GAMEPLAY BREAKDOWN", {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: BRAND_NAVY,
  });
  y -= 16;

  // Level grid table
  const levels = data.aiReport.levelWisePerformance || [];
  const colWidth = CONTENT_WIDTH / 6;

  // Draw 6 columns for the 6 games, each having 3 level boxes
  const uniqueGames = ["stroop", "card-flip", "pattern", "odd-one-out", "rule-discovery", "story-sequencing"];
  const gameLabels: Record<string, string> = {
    stroop: "Stroop",
    "card-flip": "Card Flip",
    pattern: "Pattern",
    "odd-one-out": "Odd One",
    "rule-discovery": "Rule Disc.",
    "story-sequencing": "Story Seq.",
  };

  const boxHeight = 68;
  checkPageBreak(boxHeight + 20);

  for (let gIdx = 0; gIdx < uniqueGames.length; gIdx++) {
    const gKey = uniqueGames[gIdx];
    if (!gKey) continue;
    const gx = MARGIN + gIdx * colWidth;

    // Header for game column
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

    // 3 level rows inside this column
    for (let lvl = 1; lvl <= 3; lvl++) {
      const match = levels.find((l) => l.gameKey === gKey && l.levelNumber === lvl);
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

      const accText = match?.accuracy !== null && match?.accuracy !== undefined ? `${match.accuracy}%` : "Done";
      currentPage.drawText(`L${lvl}: ${accText}`, {
        x: gx + 4,
        y: ly + 4,
        size: 7,
        font: fontRegular,
        color: TEXT_DARK,
      });
    }
  }

  y -= boxHeight + 16;

  // --- OBSERVED STRENGTHS & AREAS FOR PRACTICE ---
  checkPageBreak(110);
  currentPage.drawText("OBSERVED STRENGTHS & GROWTH OPPORTUNITIES", {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: BRAND_NAVY,
  });
  y -= 14;

  const halfWidth = (CONTENT_WIDTH - 12) / 2;

  // Strengths column
  currentPage.drawRectangle({
    x: MARGIN,
    y: y - 90,
    width: halfWidth,
    height: 90,
    color: BG_LIGHT,
    borderColor: BORDER_COLOR,
    borderWidth: 1,
  });

  currentPage.drawText("Observed Strengths", {
    x: MARGIN + 10,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: SUCCESS_GREEN,
  });

  let sy = y - 30;
  for (const str of (data.aiReport.observedStrengths || []).slice(0, 3)) {
    const lines = wrapText(`• ${str}`, fontRegular, 7.5, halfWidth - 20);
    for (const l of lines.slice(0, 2)) {
      currentPage.drawText(l, {
        x: MARGIN + 10,
        y: sy,
        size: 7.5,
        font: fontRegular,
        color: TEXT_DARK,
      });
      sy -= 10;
    }
    sy -= 2;
  }

  // Growth column
  currentPage.drawRectangle({
    x: MARGIN + halfWidth + 12,
    y: y - 90,
    width: halfWidth,
    height: 90,
    color: BG_LIGHT,
    borderColor: BORDER_COLOR,
    borderWidth: 1,
  });

  currentPage.drawText("Areas for Further Practice", {
    x: MARGIN + halfWidth + 22,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: BRAND_CYAN,
  });

  let py = y - 30;
  for (const str of (data.aiReport.areasForPractice || []).slice(0, 3)) {
    const lines = wrapText(`• ${str}`, fontRegular, 7.5, halfWidth - 20);
    for (const l of lines.slice(0, 2)) {
      currentPage.drawText(l, {
        x: MARGIN + halfWidth + 22,
        y: py,
        size: 7.5,
        font: fontRegular,
        color: TEXT_DARK,
      });
      py -= 10;
    }
    py -= 2;
  }

  y -= 106;

  // --- PARENT RECOMMENDATIONS ---
  checkPageBreak(120);
  currentPage.drawText("PARENT-FRIENDLY HOME ACTIVITIES", {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
    color: BRAND_NAVY,
  });
  y -= 14;

  const recs = data.aiReport.parentRecommendations || [];
  for (const rec of recs.slice(0, 3)) {
    checkPageBreak(38);
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 32,
      width: CONTENT_WIDTH,
      height: 32,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });

    currentPage.drawText(rec.title, {
      x: MARGIN + 10,
      y: y - 12,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    const descLines = wrapText(rec.description, fontRegular, 7.5, CONTENT_WIDTH - 20);
    if (descLines[0]) {
      currentPage.drawText(descLines[0], {
        x: MARGIN + 10,
        y: y - 23,
        size: 7.5,
        font: fontRegular,
        color: TEXT_MUTED,
      });
    }

    y -= 38;
  }

  // --- DISCLAIMER AT BOTTOM ---
  checkPageBreak(50);
  currentPage.drawRectangle({
    x: MARGIN,
    y: y - 36,
    width: CONTENT_WIDTH,
    height: 36,
    color: BG_LIGHT,
    borderColor: BORDER_COLOR,
    borderWidth: 0.5,
  });

  currentPage.drawText("IMPORTANT EDUCATIONAL ASSESSMENT DISCLAIMER", {
    x: MARGIN + 10,
    y: y - 12,
    size: 7,
    font: fontBold,
    color: TEXT_MUTED,
  });

  const discLines = wrapText(
    data.aiReport.dataLimitations ||
      "This report provides educational observations based solely on child digital gameplay across 18 levels. It is designed to encourage learning curiosity and is not a clinical diagnosis or medical evaluation.",
    fontRegular,
    6.5,
    CONTENT_WIDTH - 20
  );

  let dy = y - 22;
  for (const dl of discLines.slice(0, 2)) {
    currentPage.drawText(dl, {
      x: MARGIN + 10,
      y: dy,
      size: 6.5,
      font: fontRegular,
      color: TEXT_MUTED,
    });
    dy -= 8;
  }

  // --- NUMBER ALL PAGES DYNAMICALLY ---
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

  return await doc.save();
}

