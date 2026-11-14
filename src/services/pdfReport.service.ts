import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFPage,
  type PDFFont,
  type Color,
  type RGB,
} from "pdf-lib";
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
// OrionKids Reference Brand Color Palette
// ---------------------------------------------------------------------------
const BRAND_NAVY = rgb(15 / 255, 31 / 255, 56 / 255); // #0F1F38 (deep rich navy)
const BRAND_GOLD = rgb(251 / 255, 191 / 255, 36 / 255); // #FBBF24 (sun dot, warm gold)
const BRAND_CYAN = rgb(0 / 255, 188 / 255, 212 / 255); // #00BCD4
const BRAND_AMBER = rgb(234 / 255, 88 / 255, 12 / 255); // #EA580C (Area of Improvement)
const BRAND_BLUE = rgb(2 / 255, 132 / 255, 199 / 255); // #0284C7 (Steady)
const BRAND_GREEN = rgb(22 / 255, 163 / 255, 74 / 255); // #16A34A (Strong)
const TEXT_DARK = rgb(30 / 255, 41 / 255, 59 / 255); // #1E293B (headings, bold text)
const TEXT_BODY = rgb(51 / 255, 65 / 255, 85 / 255); // #334155 (main body copy)
const TEXT_MUTED = rgb(100 / 255, 116 / 255, 139 / 255); // #64748B (subtitles, metadata)
const BG_LIGHT_BLUE = rgb(240 / 255, 244 / 255, 250 / 255); // #F0F4FA (metadata bar)
const BG_CARD_GREY = rgb(244 / 255, 247 / 255, 252 / 255); // #F4F7FC (summary cards)
const BG_CARD_MINT = rgb(240 / 255, 253 / 255, 244 / 255); // #F0FDF4 (strengths cards)
const BORDER_CARD_MINT = rgb(187 / 255, 247 / 255, 208 / 255); // #BBF7D0
const BG_CARD_PEACH = rgb(255 / 255, 247 / 255, 237 / 255); // #FFF7ED (practice cards)
const BORDER_CARD_PEACH = rgb(254 / 255, 215 / 255, 170 / 255); // #FED7AA
const BG_TIP_AMBER = rgb(254 / 255, 243 / 255, 199 / 255); // #FEF3C7 (parent tips)
const BORDER_TIP_AMBER = rgb(253 / 255, 230 / 255, 138 / 255); // #FDE68A
const BORDER_LIGHT = rgb(226 / 255, 232 / 255, 240 / 255); // #E2E8F0 (dividers, table lines)
const WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 595.28; // Standard A4 width
const PAGE_HEIGHT = 841.89; // Standard A4 height
const MARGIN = 38;
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

/**
 * Draws smooth anti-aliased rounded rectangles in PDF coordinate space.
 */
function drawRoundedRect(
  page: PDFPage,
  opts: {
    x: number;
    y: number; // bottom-left y
    width: number;
    height: number;
    radius?: number;
    color?: Color;
    borderColor?: Color;
    borderWidth?: number;
  }
) {
  const {
    x,
    y,
    width: w,
    height: h,
    radius: r = 8,
    color,
    borderColor,
    borderWidth,
  } = opts;
  const rad = Math.min(r, w / 2, h / 2);
  const path = `M ${rad} 0 L ${w - rad} 0 Q ${w} 0 ${w} ${-rad} L ${w} ${-(h - rad)} Q ${w} ${-h} ${w - rad} ${-h} L ${rad} ${-h} Q 0 ${-h} 0 ${-(h - rad)} L 0 ${-rad} Q 0 0 ${rad} 0 Z`;
  page.drawSvgPath(path, {
    x,
    y: y,
    color,
    borderColor,
    borderWidth,
  });
}

/**
 * Draws status badges matching the reference design pills (Strong, Steady, Area of Improvement).
 */
function drawPill(
  page: PDFPage,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: Color;
    label: string;
    font: PDFFont;
    fontSize?: number;
    textColor?: Color;
  }
) {
  const {
    x,
    y,
    width: w,
    height: h,
    color,
    label,
    font,
    fontSize = 7.5,
    textColor = WHITE,
  } = opts;
  drawRoundedRect(page, {
    x,
    y,
    width: w,
    height: h,
    radius: h / 2,
    color,
  });
  const textW = font.widthOfTextAtSize(label, fontSize);
  page.drawText(label, {
    x: x + (w - textW) / 2,
    y: y + (h - fontSize) / 2 + 1,
    size: fontSize,
    font,
    color: textColor,
  });
}

/**
 * Draws the reference normal distribution bell curve with 3 shaded zones, marker pin, and legend.
 */
function drawBellCurve(
  page: PDFPage,
  fontRegular: PDFFont,
  fontBold: PDFFont,
  opts: {
    x0: number;
    y0: number;
    width: number;
    height: number;
    scorePercent: number;
    childName: string;
  }
) {
  const { x0, y0, width, height, scorePercent, childName } = opts;
  const x1 = x0 + width;
  const xMid = x0 + width / 2;
  const sigma = width / 5.5;

  function getCurveHeight(x: number) {
    const z = (x - xMid) / sigma;
    return height * Math.exp(-0.5 * z * z);
  }

  const xSplit1 = x0 + width * 0.4; // ~50th percentile boundary
  const xSplit2 = x0 + width * 0.7; // ~75th percentile boundary

  function buildRegionPath(fromX: number, toX: number) {
    const steps = 30;
    let path = `M ${fromX - x0} 0`;
    for (let i = 0; i <= steps; i++) {
      const curX = fromX + (toX - fromX) * (i / steps);
      const h = -getCurveHeight(curX);
      path += ` L ${curX - x0} ${h}`;
    }
    path += ` L ${toX - x0} 0 Z`;
    return path;
  }

  // Draw 3 shaded regions under curve
  // 1. Area of Improvement (Peach)
  page.drawSvgPath(buildRegionPath(x0, xSplit1), {
    x: x0,
    y: y0,
    color: rgb(254 / 255, 237 / 255, 214 / 255), // Peach
  });
  // 2. Steady (Light Blue)
  page.drawSvgPath(buildRegionPath(xSplit1, xSplit2), {
    x: x0,
    y: y0,
    color: rgb(224 / 255, 238 / 255, 252 / 255), // Blue
  });
  // 3. Strong (Soft Green)
  page.drawSvgPath(buildRegionPath(xSplit2, x1), {
    x: x0,
    y: y0,
    color: rgb(219 / 255, 242 / 255, 228 / 255), // Green
  });

  // Baseline
  page.drawLine({
    start: { x: x0 - 8, y: y0 },
    end: { x: x1 + 8, y: y0 },
    thickness: 1.2,
    color: BRAND_NAVY,
  });

  // Curve stroke line
  const curveSteps = 60;
  let curvePath = `M 0 ${-getCurveHeight(x0)}`;
  for (let i = 1; i <= curveSteps; i++) {
    const curX = x0 + width * (i / curveSteps);
    curvePath += ` L ${curX - x0} ${-getCurveHeight(curX)}`;
  }
  page.drawSvgPath(curvePath, {
    x: x0,
    y: y0,
    borderColor: BRAND_NAVY,
    borderWidth: 1.5,
  });

  // Child score marker
  const scoreFraction = Math.max(0.05, Math.min(0.95, scorePercent / 100));
  const scoreX = x0 + width * scoreFraction;
  const scoreH = getCurveHeight(scoreX);
  const scoreY = y0 + scoreH;

  // Dashed vertical line
  page.drawLine({
    start: { x: scoreX, y: y0 },
    end: { x: scoreX, y: scoreY },
    thickness: 1.2,
    color: BRAND_NAVY,
    dashArray: [3, 2],
  });

  // Pin dot
  page.drawCircle({
    x: scoreX,
    y: scoreY,
    size: 4,
    color: BRAND_NAVY,
  });

  // Label above/beside pin: e.g. "Ananya: 82%"
  const firstName = childName.split(" ")[0] || "Child";
  const labelText = `${firstName}: ${Math.round(scorePercent)}%`;
  const labelW = fontBold.widthOfTextAtSize(labelText, 8);
  let labelX = scoreX - labelW / 2;
  let labelY = scoreY + 6;

  if (scoreFraction > 0.65) {
    labelX = Math.min(x1 - labelW, scoreX + 6);
    labelY = scoreY - 2;
  } else if (scoreFraction < 0.35) {
    labelX = Math.max(x0, scoreX - labelW - 6);
    labelY = scoreY - 2;
  } else {
    labelX = Math.max(x0, Math.min(x1 - labelW, scoreX - labelW / 2));
    labelY = scoreY + 6;
  }

  page.drawText(labelText, {
    x: labelX,
    y: labelY,
    size: 8,
    font: fontBold,
    color: BRAND_NAVY,
  });

  // Bottom Ticks and labels
  const ticks = [
    { label: "5%", x: x0 + width * 0.05 },
    { label: "25%", x: x0 + width * 0.25 },
    { label: "50%", x: x0 + width * 0.5 },
    { label: "75%", x: x0 + width * 0.75 },
    { label: "95%", x: x0 + width * 0.95 },
  ];
  for (const t of ticks) {
    const tw = fontRegular.widthOfTextAtSize(t.label, 6.5);
    page.drawText(t.label, {
      x: t.x - tw / 2,
      y: y0 - 10,
      size: 6.5,
      font: fontRegular,
      color: TEXT_MUTED,
    });
  }

  // Legend
  const legendY = y0 - 22;
  page.drawText("Area of Improvement", {
    x: x0 + 15,
    y: legendY,
    size: 7.5,
    font: fontBold,
    color: BRAND_AMBER,
  });
  const leg2 = "Steady";
  page.drawText(leg2, {
    x: x0 + width * 0.48 - fontBold.widthOfTextAtSize(leg2, 7.5) / 2,
    y: legendY,
    size: 7.5,
    font: fontBold,
    color: BRAND_BLUE,
  });
  const leg3 = "Strong";
  page.drawText(leg3, {
    x: x1 - fontBold.widthOfTextAtSize(leg3, 7.5) - 15,
    y: legendY,
    size: 7.5,
    font: fontBold,
    color: BRAND_GREEN,
  });
}

/**
 * Draws the reference 3-segment horizontal progress bar with circular navy score pin.
 */
function drawSkillsBar(
  page: PDFPage,
  fontBold: PDFFont,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
  }
) {
  const { x, y, width: w, height: h, score } = opts;
  const gap = 3;
  const segW = (w - gap * 2) / 3;
  const rad = h / 2;

  // Segment 1 (Peach - Improvement)
  drawRoundedRect(page, {
    x,
    y,
    width: segW,
    height: h,
    radius: rad,
    color: rgb(254 / 255, 226 / 255, 199 / 255), // #FEE2C7
  });

  // Segment 2 (Blue - Steady)
  drawRoundedRect(page, {
    x: x + segW + gap,
    y,
    width: segW,
    height: h,
    radius: rad,
    color: rgb(224 / 255, 238 / 255, 252 / 255), // #E0EEFC
  });

  // Segment 3 (Green - Strong)
  drawRoundedRect(page, {
    x: x + (segW + gap) * 2,
    y,
    width: segW,
    height: h,
    radius: rad,
    color: rgb(219 / 255, 242 / 255, 228 / 255), // #DBF2E4
  });

  // Circular navy score pin
  const clampedScore = Math.max(5, Math.min(95, score));
  const pinX = x + w * (clampedScore / 100);
  const pinY = y + h / 2;

  page.drawCircle({
    x: pinX,
    y: pinY,
    size: 7.5,
    color: BRAND_NAVY,
  });

  const scoreText = String(Math.round(score));
  const textW = fontBold.widthOfTextAtSize(scoreText, 7);
  page.drawText(scoreText, {
    x: pinX - textW / 2,
    y: pinY - 2.5,
    size: 7,
    font: fontBold,
    color: WHITE,
  });
}

/**
 * Draws the 3-circle Venn diagram (Family, School, Community overlapping on Child)
 */
function drawVennDiagram(
  page: PDFPage,
  fontBold: PDFFont,
  opts: {
    cx: number;
    cy: number;
    radius: number;
  }
) {
  const { cx, cy, radius } = opts;
  const d = radius * 0.75;

  // Top Circle: Family (warm yellow)
  page.drawCircle({
    x: cx,
    y: cy + d * 0.65,
    size: radius,
    color: rgb(253 / 255, 224 / 255, 71 / 255),
    opacity: 0.65,
  });

  // Bottom-Left Circle: School (cyan/teal)
  page.drawCircle({
    x: cx - d * 0.7,
    y: cy - d * 0.45,
    size: radius,
    color: rgb(103 / 255, 232 / 255, 249 / 255),
    opacity: 0.65,
  });

  // Bottom-Right Circle: Community (coral/rose)
  page.drawCircle({
    x: cx + d * 0.7,
    y: cy - d * 0.45,
    size: radius,
    color: rgb(253 / 255, 164 / 255, 175 / 255),
    opacity: 0.65,
  });

  // Labels
  const famText = "Family";
  page.drawText(famText, {
    x: cx - fontBold.widthOfTextAtSize(famText, 8.5) / 2,
    y: cy + d * 0.85,
    size: 8.5,
    font: fontBold,
    color: BRAND_NAVY,
  });

  const schText = "School";
  page.drawText(schText, {
    x: cx - d * 0.85 - fontBold.widthOfTextAtSize(schText, 8.5) / 2,
    y: cy - d * 0.55,
    size: 8.5,
    font: fontBold,
    color: BRAND_NAVY,
  });

  const comText = "Community";
  page.drawText(comText, {
    x: cx + d * 0.85 - fontBold.widthOfTextAtSize(comText, 8.5) / 2,
    y: cy - d * 0.55,
    size: 8.5,
    font: fontBold,
    color: BRAND_NAVY,
  });

  const childText = "Child";
  page.drawText(childText, {
    x: cx - fontBold.widthOfTextAtSize(childText, 9.5) / 2,
    y: cy - 2,
    size: 9.5,
    font: fontBold,
    color: BRAND_NAVY,
  });
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
        "Engage in playful, everyday household routines that exercise this skill in an encouraging, low-pressure environment.",
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
    skills:
      Array.isArray(item.skillsPracticed) && item.skillsPracticed.length > 0
        ? item.skillsPracticed
        : ["Cognitive Play", "Creative Thinking"],
    materials:
      Array.isArray(item.materials) && item.materials.length > 0
        ? item.materials
        : ["Everyday household objects"],
    instructions:
      Array.isArray(item.instructions) && item.instructions.length > 0
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
      currentPage.drawLine({
        start: { x: MARGIN, y: y + 8 },
        end: { x: PAGE_WIDTH - MARGIN, y: y + 8 },
        thickness: 0.5,
        color: BORDER_LIGHT,
      });
      currentPage.drawText("OrionKids · Thinking Skills Report", {
        x: MARGIN,
        y: y + 12,
        size: 7.5,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      const rightText = `${data.childName} · ${data.selectedClass}`;
      currentPage.drawText(rightText, {
        x: PAGE_WIDTH - MARGIN - fontBold.widthOfTextAtSize(rightText, 7.5),
        y: y + 12,
        size: 7.5,
        font: fontBold,
        color: BRAND_NAVY,
      });
      y -= 14;
    };

    // =========================================================================
    // PAGE 1: HEADER BANNER (Matching Reference Style)
    // =========================================================================
    const headerHeight = 58;
    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - headerHeight,
      width: CONTENT_WIDTH,
      height: headerHeight,
      radius: 12,
      color: BRAND_NAVY,
    });

    // Left: Sun / Circle Logo & Brand Name
    currentPage.drawCircle({
      x: MARGIN + 22,
      y: y - 28,
      size: 7,
      color: BRAND_GOLD,
    });

    currentPage.drawText("ORIONKIDS", {
      x: MARGIN + 36,
      y: y - 24,
      size: 16,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("Where Every Kid Is a Star", {
      x: MARGIN + 36,
      y: y - 40,
      size: 8.5,
      font: fontRegular,
      color: rgb(203 / 255, 213 / 255, 225 / 255),
    });

    // Right: Document Title & Subtitle
    const titleRight1 = "Thinking Skills Report";
    currentPage.drawText(titleRight1, {
      x: PAGE_WIDTH - MARGIN - 18 - fontBold.widthOfTextAtSize(titleRight1, 13),
      y: y - 24,
      size: 13,
      font: fontBold,
      color: WHITE,
    });

    const titleRight2 = "For parents and families";
    currentPage.drawText(titleRight2, {
      x:
        PAGE_WIDTH -
        MARGIN -
        18 -
        fontRegular.widthOfTextAtSize(titleRight2, 8.5),
      y: y - 40,
      size: 8.5,
      font: fontRegular,
      color: rgb(203 / 255, 213 / 255, 225 / 255),
    });

    y -= headerHeight + 10;

    // =========================================================================
    // METADATA STRIP (Matching Reference Style)
    // =========================================================================
    const metaHeight = 28;
    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - metaHeight,
      width: CONTENT_WIDTH,
      height: metaHeight,
      radius: 7,
      color: BG_LIGHT_BLUE,
    });

    const completionDateStr = data.questCompletedAt
      ? new Date(data.questCompletedAt).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
      : new Date().toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

    const metaY = y - 18;
    let metaX = MARGIN + 14;

    // Item 1: Child
    currentPage.drawText("Child", {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });
    metaX += fontBold.widthOfTextAtSize("Child ", 8.5);
    currentPage.drawText(data.childName, {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontRegular,
      color: BRAND_NAVY,
    });
    metaX += fontRegular.widthOfTextAtSize(data.childName, 8.5) + 32;

    // Item 2: Class
    currentPage.drawText("Class", {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });
    metaX += fontBold.widthOfTextAtSize("Class ", 8.5);
    currentPage.drawText(data.selectedClass, {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontRegular,
      color: BRAND_NAVY,
    });
    metaX += fontRegular.widthOfTextAtSize(data.selectedClass, 8.5) + 32;

    // Item 3: Age
    currentPage.drawText("Age", {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });
    metaX += fontBold.widthOfTextAtSize("Age ", 8.5);
    const ageStr = `${data.age} years`;
    currentPage.drawText(ageStr, {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontRegular,
      color: BRAND_NAVY,
    });
    metaX += fontRegular.widthOfTextAtSize(ageStr, 8.5) + 32;

    // Item 4: Session
    currentPage.drawText("Session", {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });
    metaX += fontBold.widthOfTextAtSize("Session ", 8.5);
    currentPage.drawText(completionDateStr, {
      x: metaX,
      y: metaY,
      size: 8.5,
      font: fontRegular,
      color: BRAND_NAVY,
    });

    y -= metaHeight + 12;

    // =========================================================================
    // "ABOUT THIS REPORT" CARD
    // =========================================================================
    const firstName = data.childName.split(" ")[0] || "Your child";
    const aboutIntroText = `${firstName} played six short games that look at how children focus, remember, reason and plan. This report shows where ${firstName} shines, where thinking skills are still growing, and simple ways family, school and community can help. It reflects one play session and is not a diagnosis or a label.`;

    const aboutLines = wrapText(aboutIntroText, fontRegular, 8.5, CONTENT_WIDTH - 24);
    const aboutCardHeight = 22 + aboutLines.length * 12 + 6;

    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - aboutCardHeight,
      width: CONTENT_WIDTH,
      height: aboutCardHeight,
      radius: 9,
      color: BG_CARD_GREY,
    });

    currentPage.drawText("About this report", {
      x: MARGIN + 12,
      y: y - 16,
      size: 9.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    let aboutTextY = y - 30;
    for (const line of aboutLines) {
      currentPage.drawText(line, {
        x: MARGIN + 12,
        y: aboutTextY,
        size: 8.5,
        font: fontRegular,
        color: TEXT_BODY,
      });
      aboutTextY -= 12;
    }

    y -= aboutCardHeight + 14;

    // =========================================================================
    // "OVERALL RESULT" & VISUAL BELL CURVE
    // =========================================================================
    currentPage.drawText("Overall result", {
      x: MARGIN,
      y,
      size: 13,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    const overallScore = Math.round(data.overallAccuracy);
    const durationMin = Math.round(data.totalDurationMs / 60000);

    // Left Column: Big % Metric
    const scoreY = y - 38;
    currentPage.drawText(`${overallScore}%`, {
      x: MARGIN + 2,
      y: scoreY,
      size: 34,
      font: fontBold,
      color: BRAND_NAVY,
    });

    currentPage.drawText("overall accuracy", {
      x: MARGIN + 2,
      y: scoreY - 12,
      size: 9,
      font: fontBold,
      color: BRAND_NAVY,
    });

    currentPage.drawText("across 18 quest levels", {
      x: MARGIN + 2,
      y: scoreY - 23,
      size: 7.5,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    currentPage.drawText(`Duration: ${durationMin} min`, {
      x: MARGIN + 2,
      y: scoreY - 34,
      size: 7.5,
      font: fontRegular,
      color: TEXT_MUTED,
    });

    // Right Column: Bell Curve
    const curveWidth = 330;
    const curveHeight = 52;
    const curveX = PAGE_WIDTH - MARGIN - curveWidth - 8;
    const curveBaseY = y - 56;

    drawBellCurve(currentPage, fontRegular, fontBold, {
      x0: curveX,
      y0: curveBaseY,
      width: curveWidth,
      height: curveHeight,
      scorePercent: overallScore,
      childName: data.childName,
    });

    y -= 88;

    // Explanatory paragraph underneath bell curve
    const overallExplText = `A composite accuracy of ${overallScore}% indicates dependable engagement across cognitive challenges. Scores above 75% reflect strong mastery, while 50% to 75% indicate steady developmental progress. A score simply shows where play and practice will help most.`;
    const explLines = wrapText(overallExplText, fontRegular, 7.5, CONTENT_WIDTH);
    for (const el of explLines) {
      currentPage.drawText(el, {
        x: MARGIN,
        y,
        size: 7.5,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      y -= 10.5;
    }

    y -= 8;

    // =========================================================================
    // "SUMMARY" CARD (Executive Journey Summary)
    // =========================================================================
    const summaryText =
      data.aiReport.overallPerformanceSummary ||
      data.aiReport.questSummary ||
      "";
    const summaryLines = wrapText(summaryText, fontRegular, 8.5, CONTENT_WIDTH - 24);
    const summaryCardHeight = 22 + summaryLines.length * 12 + 6;

    checkPageBreak(summaryCardHeight + 10);

    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - summaryCardHeight,
      width: CONTENT_WIDTH,
      height: summaryCardHeight,
      radius: 9,
      color: BG_CARD_GREY,
    });

    currentPage.drawText("Summary", {
      x: MARGIN + 12,
      y: y - 16,
      size: 9.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    let sumY = y - 30;
    for (const line of summaryLines) {
      currentPage.drawText(line, {
        x: MARGIN + 12,
        y: sumY,
        size: 8.5,
        font: fontRegular,
        color: TEXT_BODY,
      });
      sumY -= 12;
    }

    y -= summaryCardHeight + 14;

    // =========================================================================
    // "SIX COGNITIVE DOMAINS SUMMARY" (Detailed Table with Status, Levels, Accuracy, Avg Pace)
    // =========================================================================
    checkPageBreak(200);
    currentPage.drawText("Six Cognitive Domains Summary", {
      x: MARGIN,
      y,
      size: 13,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    // Table Header
    currentPage.drawRectangle({
      x: MARGIN,
      y: y - 18,
      width: CONTENT_WIDTH,
      height: 18,
      color: BRAND_NAVY,
    });

    currentPage.drawText("ACTIVITY & FOCUS AREA", {
      x: MARGIN + 8,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("STATUS", {
      x: MARGIN + 185,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("LEVELS", {
      x: MARGIN + 295,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("ACCURACY", {
      x: MARGIN + 380,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: WHITE,
    });

    currentPage.drawText("AVG PACE", {
      x: MARGIN + 445,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: WHITE,
    });

    y -= 20;

    const gamesList = data.aiReport.gameWiseAnalysis || [];
    for (let i = 0; i < gamesList.length; i++) {
      const g = gamesList[i];
      if (!g) continue;
      checkPageBreak(26);

      const clampedLevels = Math.min(3, Math.max(0, g.levelsCompleted));
      const isSkipped =
        g.gameStatus === "SKIPPED" ||
        (clampedLevels < 3 && g.averageAccuracy === null);
      const isNotAttempted = clampedLevels === 0 && !isSkipped;

      const isEven = i % 2 === 0;
      currentPage.drawRectangle({
        x: MARGIN,
        y: y - 24,
        width: CONTENT_WIDTH,
        height: 24,
        color: isEven ? rgb(248 / 255, 250 / 255, 252 / 255) : WHITE,
        borderColor: BORDER_LIGHT,
        borderWidth: 0.5,
      });

      // Activity Name + Cognitive Domain
      currentPage.drawText(g.gameName, {
        x: MARGIN + 8,
        y: y - 10,
        size: 8.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      currentPage.drawText(`(${g.cognitiveDomain})`, {
        x: MARGIN + 8,
        y: y - 20,
        size: 7,
        font: fontRegular,
        color: TEXT_MUTED,
      });

      // Status Column
      let statusStr = "Completed";
      let statusColor = BRAND_GREEN;
      if (isSkipped) {
        statusStr = "Skipped by child";
        statusColor = rgb(217 / 255, 119 / 255, 6 / 255); // amber
      } else if (isNotAttempted) {
        statusStr = "Not Attempted";
        statusColor = TEXT_MUTED;
      }

      currentPage.drawText(statusStr, {
        x: MARGIN + 185,
        y: y - 14,
        size: 8,
        font: fontBold,
        color: statusColor,
      });

      // Levels Column
      const levelsStr = isSkipped
        ? `${clampedLevels}/3 (Skipped)`
        : `${clampedLevels}/3 Levels`;
      currentPage.drawText(levelsStr, {
        x: MARGIN + 295,
        y: y - 14,
        size: 8,
        font: fontRegular,
        color: TEXT_DARK,
      });

      // Accuracy Column
      const accStr =
        !isSkipped && g.averageAccuracy !== null
          ? `${Math.round(g.averageAccuracy)}%`
          : "—";
      currentPage.drawText(accStr, {
        x: MARGIN + 380,
        y: y - 14,
        size: 8.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      // Avg Pace Column
      const paceStr =
        !isSkipped &&
        typeof g.averageReactionTimeMs === "number" &&
        g.averageReactionTimeMs > 0
          ? `${(g.averageReactionTimeMs / 1000).toFixed(1)}s`
          : "—";
      currentPage.drawText(paceStr, {
        x: MARGIN + 445,
        y: y - 14,
        size: 8,
        font: fontRegular,
        color: TEXT_DARK,
      });

      y -= 26;
    }

    y -= 8;

    // Dedicated note for skipped games
    const skippedGames = gamesList.filter(
      (g) =>
        g.gameStatus === "SKIPPED" ||
        (g.averageAccuracy === null && Math.min(3, Math.max(0, g.levelsCompleted)) < 3)
    );
    for (const sg of skippedGames) {
      const calloutText = `Activity Note: ${sg.gameName} was skipped during this quest session, so no performance score is available for this game. Skipping an activity is completely normal when a child feels tired or prefers different puzzle styles, and does not indicate any cognitive deficit.`;
      const noteLines = wrapText(calloutText, fontRegular, 7.5, CONTENT_WIDTH - 24);
      const calloutH = noteLines.length * 10 + 10;
      checkPageBreak(calloutH + 4);

      currentPage.drawRectangle({
        x: MARGIN,
        y: y - calloutH,
        width: CONTENT_WIDTH,
        height: calloutH,
        color: BG_TIP_AMBER,
        borderColor: BORDER_TIP_AMBER,
        borderWidth: 0.5,
      });

      let noteY = y - 9;
      for (const line of noteLines) {
        currentPage.drawText(line, {
          x: MARGIN + 12,
          y: noteY,
          size: 7.5,
          font: fontRegular,
          color: rgb(146 / 255, 64 / 255, 14 / 255),
        });
        noteY -= 10;
      }
      y -= calloutH + 8;
    }

    y -= 10;

    // =========================================================================
    // "18-LEVEL GAMEPLAY BREAKDOWN" MATRIX
    // =========================================================================
    checkPageBreak(115);
    currentPage.drawText("18-Level Gameplay Breakdown", {
      x: MARGIN,
      y,
      size: 12,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 14;

    const levels = data.aiReport.levelWisePerformance || [];
    const colWidth = (CONTENT_WIDTH - 15) / 6;
    const uniqueGames = [
      "stroop",
      "card-flip",
      "pattern",
      "odd-one-out",
      "rule-discovery",
      "story-sequencing",
    ];
    const gameLabels: Record<string, string> = {
      stroop: "Colour Tap",
      "card-flip": "Card Flip",
      pattern: "Pattern",
      "odd-one-out": "Odd One",
      "rule-discovery": "Rule Disc.",
      "story-sequencing": "Story Seq.",
    };

    const boxHeight = 62;
    for (let gIdx = 0; gIdx < uniqueGames.length; gIdx++) {
      const gKey = uniqueGames[gIdx];
      if (!gKey) continue;
      const gx = MARGIN + gIdx * (colWidth + 3);

      // Header block with rounded top
      drawRoundedRect(currentPage, {
        x: gx,
        y: y - 16,
        width: colWidth,
        height: 16,
        radius: 4,
        color: BRAND_NAVY,
      });

      const label = gameLabels[gKey] || gKey;
      currentPage.drawText(label, {
        x: gx + 4,
        y: y - 12,
        size: 7,
        font: fontBold,
        color: WHITE,
      });

      // Level rows
      for (let lvl = 1; lvl <= 3; lvl++) {
        const match = levels.find(
          (l) => l.gameKey === gKey && l.levelNumber === lvl
        );
        const ly = y - 16 - lvl * 15;

        drawRoundedRect(currentPage, {
          x: gx,
          y: ly,
          width: colWidth,
          height: 14,
          radius: 2,
          color: lvl % 2 === 0 ? BG_CARD_GREY : WHITE,
          borderColor: BORDER_LIGHT,
          borderWidth: 0.5,
        });

        const accText =
          match?.status === "SKIPPED"
            ? "Skipped"
            : match?.accuracy !== null && match?.accuracy !== undefined
            ? `${match.accuracy}%`
            : match?.status === "NOT_ATTEMPTED" || !match
            ? "—"
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

    y -= boxHeight + 18;

    // =========================================================================
    // PAGE 2+: OBSERVED STRENGTHS (Matching Reference Style)
    // =========================================================================
    checkPageBreak(140);
    currentPage.drawText("Strengths", {
      x: MARGIN,
      y,
      size: 14,
      font: fontBold,
      color: BRAND_GREEN,
    });
    y -= 14;

    const rawStrengths = data.aiReport.observedStrengths || [];
    for (let sIdx = 0; sIdx < rawStrengths.length; sIdx++) {
      const st = formatStrength(rawStrengths[sIdx]);

      const obsLines = wrapText(st.observation, fontRegular, 8.5, CONTENT_WIDTH - 28);
      const evLines = wrapText(st.evidence, fontRegular, 8, CONTENT_WIDTH - 140);
      const relLines = wrapText(st.relevance, fontRegular, 8, CONTENT_WIDTH - 140);

      const subSectionHeight =
        16 +
        Math.max(1, evLines.length) * 11 +
        Math.max(1, relLines.length) * 11 +
        6;

      const cardHeight =
        28 + // Header
        obsLines.length * 12 +
        8 + // gap
        subSectionHeight +
        12;

      checkPageBreak(cardHeight + 10);

      // Card Background (Soft Mint)
      drawRoundedRect(currentPage, {
        x: MARGIN,
        y: y - cardHeight,
        width: CONTENT_WIDTH,
        height: cardHeight,
        radius: 11,
        color: BG_CARD_MINT,
        borderColor: BORDER_CARD_MINT,
        borderWidth: 0.8,
      });

      // Card Header Left: Skill / Heading
      currentPage.drawText(st.heading, {
        x: MARGIN + 14,
        y: y - 18,
        size: 10.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      currentPage.drawText(st.skill, {
        x: MARGIN + 14,
        y: y - 30,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      });

      // Card Header Right: Strong Badge Pill
      const pillW = 70;
      drawPill(currentPage, {
        x: PAGE_WIDTH - MARGIN - pillW - 14,
        y: y - 26,
        width: pillW,
        height: 17,
        color: BRAND_GREEN,
        label: "Strong",
        font: fontBold,
        fontSize: 7.5,
      });

      // Body Observation
      let curY = y - 44;
      for (const line of obsLines) {
        currentPage.drawText(line, {
          x: MARGIN + 14,
          y: curY,
          size: 8.5,
          font: fontRegular,
          color: TEXT_DARK,
        });
        curY -= 12;
      }

      curY -= 4;

      // "Keep it growing" sub-section header
      currentPage.drawText("Keep it growing", {
        x: MARGIN + 14,
        y: curY,
        size: 8,
        font: fontBold,
        color: BRAND_NAVY,
      });
      curY -= 12;

      // Row 1: Gameplay Evidence
      currentPage.drawText("Gameplay evidence", {
        x: MARGIN + 14,
        y: curY,
        size: 7.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      for (let l = 0; l < evLines.length; l++) {
        currentPage.drawText(evLines[l]!, {
          x: MARGIN + 120,
          y: curY - l * 10.5,
          size: 7.5,
          font: fontRegular,
          color: TEXT_BODY,
        });
      }
      curY -= Math.max(1, evLines.length) * 10.5 + 4;

      // Row 2: Educational Relevance
      currentPage.drawText("Educational relevance", {
        x: MARGIN + 14,
        y: curY,
        size: 7.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      for (let l = 0; l < relLines.length; l++) {
        currentPage.drawText(relLines[l]!, {
          x: MARGIN + 120,
          y: curY - l * 10.5,
          size: 7.5,
          font: fontRegular,
          color: TEXT_BODY,
        });
      }

      y -= cardHeight + 12;
    }

    y -= 10;

    // =========================================================================
    // "AREAS OF IMPROVEMENT" / FURTHER PRACTICE (Matching Reference Style)
    // =========================================================================
    checkPageBreak(140);
    currentPage.drawText("Areas of Improvement", {
      x: MARGIN,
      y,
      size: 14,
      font: fontBold,
      color: BRAND_AMBER,
    });
    y -= 12;

    currentPage.drawText(
      "These are the skills where play and practice will help most. Pick one or two ideas, and let your child choose the ones that feel fun.",
      {
        x: MARGIN,
        y,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      }
    );
    y -= 16;

    const rawPractice = data.aiReport.areasForPractice || [];
    for (let pIdx = 0; pIdx < rawPractice.length; pIdx++) {
      const pr = formatPracticeArea(rawPractice[pIdx]);

      const patLines = wrapText(pr.pattern, fontRegular, 8.5, CONTENT_WIDTH - 28);
      const evLines = wrapText(pr.evidence, fontRegular, 8, CONTENT_WIDTH - 140);
      const appLines = wrapText(pr.approach, fontRegular, 8, CONTENT_WIDTH - 140);

      const subSectionHeight =
        16 +
        Math.max(1, evLines.length) * 11 +
        Math.max(1, appLines.length) * 11 +
        6;

      const cardHeight =
        28 + // Header
        patLines.length * 12 +
        8 + // gap
        subSectionHeight +
        12;

      checkPageBreak(cardHeight + 10);

      // Card Background (Soft Peach)
      drawRoundedRect(currentPage, {
        x: MARGIN,
        y: y - cardHeight,
        width: CONTENT_WIDTH,
        height: cardHeight,
        radius: 11,
        color: BG_CARD_PEACH,
        borderColor: BORDER_CARD_PEACH,
        borderWidth: 0.8,
      });

      // Card Header Left
      currentPage.drawText(pr.heading, {
        x: MARGIN + 14,
        y: y - 18,
        size: 10.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      currentPage.drawText(pr.skill, {
        x: MARGIN + 14,
        y: y - 30,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      });

      // Card Header Right: Area of Improvement Pill
      const pillW = 115;
      drawPill(currentPage, {
        x: PAGE_WIDTH - MARGIN - pillW - 14,
        y: y - 26,
        width: pillW,
        height: 17,
        color: BRAND_AMBER,
        label: "Area of Improvement",
        font: fontBold,
        fontSize: 7.5,
      });

      // Body Pattern
      let curY = y - 44;
      for (const line of patLines) {
        currentPage.drawText(line, {
          x: MARGIN + 14,
          y: curY,
          size: 8.5,
          font: fontRegular,
          color: TEXT_DARK,
        });
        curY -= 12;
      }

      curY -= 4;

      // "Ideas for everyday practice" sub-section
      currentPage.drawText(`Ideas for ${data.selectedClass || "children"}`, {
        x: MARGIN + 14,
        y: curY,
        size: 8,
        font: fontBold,
        color: BRAND_NAVY,
      });
      curY -= 12;

      // Row 1: Recorded Pattern
      currentPage.drawText("Recorded pattern", {
        x: MARGIN + 14,
        y: curY,
        size: 7.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      for (let l = 0; l < evLines.length; l++) {
        currentPage.drawText(evLines[l]!, {
          x: MARGIN + 120,
          y: curY - l * 10.5,
          size: 7.5,
          font: fontRegular,
          color: TEXT_BODY,
        });
      }
      curY -= Math.max(1, evLines.length) * 10.5 + 4;

      // Row 2: Playful Recommendation
      currentPage.drawText("Playful recommendation", {
        x: MARGIN + 14,
        y: curY,
        size: 7.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      for (let l = 0; l < appLines.length; l++) {
        currentPage.drawText(appLines[l]!, {
          x: MARGIN + 120,
          y: curY - l * 10.5,
          size: 7.5,
          font: fontRegular,
          color: TEXT_BODY,
        });
      }

      y -= cardHeight + 12;
    }

    y -= 14;

    // =========================================================================
    // PARENT-FRIENDLY HOME ACTIVITIES & PRACTICE ROUTINES
    // =========================================================================
    checkPageBreak(140);

    // Section Banner
    const actBannerH = 36;
    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - actBannerH,
      width: CONTENT_WIDTH,
      height: actBannerH,
      radius: 9,
      color: BRAND_NAVY,
    });

    currentPage.drawText("PARENT-FRIENDLY HOME ACTIVITIES & PRACTICE ROUTINES", {
      x: MARGIN + 14,
      y: y - 17,
      size: 9.5,
      font: fontBold,
      color: BRAND_GOLD,
    });

    currentPage.drawText(
      "Screen-free, enjoyable household activities designed to nurture developing skills through everyday family play",
      {
        x: MARGIN + 14,
        y: y - 29,
        size: 7.5,
        font: fontRegular,
        color: WHITE,
      }
    );

    y -= actBannerH + 14;

    const activities = data.aiReport.parentRecommendations || [];
    for (let aIdx = 0; aIdx < activities.length; aIdx++) {
      const act = formatHomeActivity(activities[aIdx]);

      const skillsStr = `Skills Practiced: ${act.skills.join(", ")}`;
      const skillsLines = wrapText(skillsStr, fontBold, 8, CONTENT_WIDTH - 28);

      const matStr = `Materials: ${act.materials.join(", ")}`;
      const matLines = wrapText(matStr, fontRegular, 8, CONTENT_WIDTH - 28);

      const instructionStepLines: string[][] = act.instructions.map(
        (step, idx) =>
          wrapText(`${idx + 1}. ${step}`, fontRegular, 8, CONTENT_WIDTH - 36)
      );

      const oppLines = wrapText(
        `Learning Opportunity: ${act.opportunity}`,
        fontRegular,
        7.5,
        CONTENT_WIDTH - 28
      );

      const tipLines = wrapText(
        `Parent Tip: ${act.tip}`,
        fontOblique,
        7.5,
        CONTENT_WIDTH - 40
      );

      let stepsHeight = 0;
      for (const sLines of instructionStepLines) {
        stepsHeight += sLines.length * 10.5 + 3;
      }

      const tipBoxHeight = tipLines.length * 10 + 12;

      const cardTotalHeight =
        28 + // Header strip
        skillsLines.length * 11 +
        matLines.length * 11 +
        12 + // Instructions Title
        stepsHeight +
        oppLines.length * 10 +
        tipBoxHeight +
        16;

      checkPageBreak(cardTotalHeight + 10);

      // Card Outer Box
      drawRoundedRect(currentPage, {
        x: MARGIN,
        y: y - cardTotalHeight,
        width: CONTENT_WIDTH,
        height: cardTotalHeight,
        radius: 11,
        color: BG_CARD_GREY,
        borderColor: BORDER_LIGHT,
        borderWidth: 1,
      });

      // Card Header Banner
      drawRoundedRect(currentPage, {
        x: MARGIN,
        y: y - 24,
        width: CONTENT_WIDTH,
        height: 24,
        radius: 11,
        color: rgb(238 / 255, 242 / 255, 246 / 255),
      });

      currentPage.drawText(`Activity ${aIdx + 1}: ${act.title}`, {
        x: MARGIN + 12,
        y: y - 16,
        size: 9.5,
        font: fontBold,
        color: BRAND_NAVY,
      });

      const durText = `Duration: ${act.duration}`;
      currentPage.drawText(durText, {
        x:
          PAGE_WIDTH -
          MARGIN -
          fontBold.widthOfTextAtSize(durText, 8) -
          12,
        y: y - 16,
        size: 8,
        font: fontBold,
        color: BRAND_BLUE,
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
      drawRoundedRect(currentPage, {
        x: MARGIN + 10,
        y: cardY - tipBoxHeight + 8,
        width: CONTENT_WIDTH - 20,
        height: tipBoxHeight,
        radius: 6,
        color: BG_TIP_AMBER,
        borderColor: BORDER_TIP_AMBER,
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

    y -= 10;

    // =========================================================================
    // "EVERYONE CAN HELP" (Venn Diagram & Ecosystem Guidance - Reference Page 3)
    // =========================================================================
    checkPageBreak(170);

    currentPage.drawText("Everyone can help", {
      x: MARGIN,
      y,
      size: 13,
      font: fontBold,
      color: BRAND_NAVY,
    });
    y -= 12;

    currentPage.drawText(
      "Children grow best when family, school and community support them together.",
      {
        x: MARGIN,
        y,
        size: 8,
        font: fontRegular,
        color: TEXT_MUTED,
      }
    );
    y -= 16;

    const ecosystemBoxH = 120;
    // Left: Venn diagram
    const vennCX = MARGIN + 68;
    const vennCY = y - ecosystemBoxH / 2 + 5;
    drawVennDiagram(currentPage, fontBold, {
      cx: vennCX,
      cy: vennCY,
      radius: 38,
    });

    // Right: 2 Cards (School and Community)
    const rightCardsX = MARGIN + 148;
    const rightCardsW = CONTENT_WIDTH - 148;
    const cardH = (ecosystemBoxH - 8) / 2;

    // Card 1: For teachers (School)
    drawRoundedRect(currentPage, {
      x: rightCardsX,
      y: y - cardH,
      width: rightCardsW,
      height: cardH,
      radius: 8,
      color: BG_LIGHT_BLUE,
    });

    currentPage.drawText("For teachers (School)", {
      x: rightCardsX + 10,
      y: y - 14,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    currentPage.drawText(
      "• Reasoning: Use circle-time pattern games such as clap, tap, stomp.",
      {
        x: rightCardsX + 10,
        y: y - 26,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    currentPage.drawText(
      "• Planning: Use picture sequence cards in language time for storytelling.",
      {
        x: rightCardsX + 10,
        y: y - 37,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    currentPage.drawText(
      `• Confidence: Give ${firstName} helper roles that exercise memory and focus.`,
      {
        x: rightCardsX + 10,
        y: y - 48,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    // Card 2: For parents and community
    drawRoundedRect(currentPage, {
      x: rightCardsX,
      y: y - ecosystemBoxH,
      width: rightCardsW,
      height: cardH,
      radius: 8,
      color: rgb(255 / 255, 241 / 255, 242 / 255), // soft rose
    });

    currentPage.drawText("For parents and the community", {
      x: rightCardsX + 10,
      y: y - cardH - 14,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    currentPage.drawText(
      "• Visit local library story hours and let child tell stories from pictures.",
      {
        x: rightCardsX + 10,
        y: y - cardH - 26,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    currentPage.drawText(
      "• Join playground games: tag, hopscotch, and simple ball rallies.",
      {
        x: rightCardsX + 10,
        y: y - cardH - 37,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    currentPage.drawText(
      "• Invite grandparents and family for board games and festive sorting play.",
      {
        x: rightCardsX + 10,
        y: y - cardH - 48,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      }
    );

    y -= ecosystemBoxH + 14;

    // "A note for families" card
    const noteLine1 =
      "Every child grows at their own pace, and play is the best way for thinking skills to grow. Pick one or two ideas to try this month and enjoy them together. Small, playful steps add up quickly.";
    const noteLine2 =
      "This report highlights your child's current strengths and growing areas based on a single play session. It is not a diagnosis or a label. Children develop at their own pace, and these observations are a starting point for support at home.";
    const lines1 = wrapText(noteLine1, fontRegular, 7.5, CONTENT_WIDTH - 24);
    const lines2 = wrapText(noteLine2, fontRegular, 7.2, CONTENT_WIDTH - 24);
    const noteHeight = 22 + lines1.length * 10 + 4 + lines2.length * 10 + 4;

    checkPageBreak(noteHeight + 10);

    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - noteHeight,
      width: CONTENT_WIDTH,
      height: noteHeight,
      radius: 8,
      color: BG_CARD_GREY,
    });

    currentPage.drawText("A note for families", {
      x: MARGIN + 12,
      y: y - 14,
      size: 8.5,
      font: fontBold,
      color: BRAND_NAVY,
    });

    let ny = y - 27;
    for (const l of lines1) {
      currentPage.drawText(l, {
        x: MARGIN + 12,
        y: ny,
        size: 7.5,
        font: fontRegular,
        color: TEXT_BODY,
      });
      ny -= 10;
    }
    ny -= 3;
    for (const l of lines2) {
      currentPage.drawText(l, {
        x: MARGIN + 12,
        y: ny,
        size: 7.2,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      ny -= 10;
    }

    y -= noteHeight + 12;

    // =========================================================================
    // IMPORTANT EDUCATIONAL ASSESSMENT DISCLAIMER
    // =========================================================================
    checkPageBreak(50);

    const disclaimerText =
      data.aiReport.dataLimitations ||
      "This report provides educational observations based solely on digital gameplay across 18 levels. It is designed to celebrate learning curiosity, recognize strengths, and suggest everyday home play. It is not a clinical assessment, medical diagnosis, or psychological evaluation.";

    const discLines = wrapText(
      disclaimerText,
      fontRegular,
      7,
      CONTENT_WIDTH - 24
    );
    const discH = 18 + discLines.length * 9 + 4;

    drawRoundedRect(currentPage, {
      x: MARGIN,
      y: y - discH,
      width: CONTENT_WIDTH,
      height: discH,
      radius: 7,
      color: BG_CARD_GREY,
      borderColor: BORDER_LIGHT,
      borderWidth: 0.5,
    });

    currentPage.drawText("IMPORTANT EDUCATIONAL ASSESSMENT DISCLAIMER", {
      x: MARGIN + 12,
      y: y - 12,
      size: 7,
      font: fontBold,
      color: BRAND_NAVY,
    });

    let dy = y - 22;
    for (const dl of discLines.slice(0, 3)) {
      currentPage.drawText(dl, {
        x: MARGIN + 12,
        y: dy,
        size: 6.8,
        font: fontRegular,
        color: TEXT_MUTED,
      });
      dy -= 9;
    }

    // =========================================================================
    // DYNAMIC PAGE NUMBERING & FOOTERS (All Pages Matching Reference)
    // =========================================================================
    const totalPages = doc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const page = doc.getPage(i);

      // Separator line
      page.drawLine({
        start: { x: MARGIN, y: MARGIN - 2 },
        end: { x: PAGE_WIDTH - MARGIN, y: MARGIN - 2 },
        thickness: 0.5,
        color: BORDER_LIGHT,
      });

      // Left: Reference-exact accreditation
      page.drawText(
        "ORIONKIDS | Where Every Kid Is a Star | Reviewed and approved by an Orionkids psychologist",
        {
          x: MARGIN,
          y: MARGIN - 14,
          size: 7,
          font: fontRegular,
          color: TEXT_MUTED,
        }
      );

      // Right: Page number
      const pageNumText = `Page ${i + 1}`;
      page.drawText(pageNumText, {
        x: PAGE_WIDTH - MARGIN - fontRegular.widthOfTextAtSize(pageNumText, 7.5),
        y: MARGIN - 14,
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
