import OpenAI from "openai";
import { z } from "zod";
import { openaiApiKey, env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { estimateOpenAiCostUsd } from "../config/pricing.js";
import {
  CANONICAL_GAMES,
  TOTAL_GAMES,
  LEVELS_PER_GAME,
  TOTAL_LEVELS,
} from "../config/games.js";

// ---------------------------------------------------------------------------
// Rich Zod Schemas for Educational Cognitive Gameplay Reports
// ---------------------------------------------------------------------------

export const ObservedStrengthItemSchema = z.object({
  heading: z.string().min(1, "Strength heading is required"),
  cognitiveSkill: z.string().min(1, "Cognitive skill is required"),
  observation: z.string().min(1, "Detailed observation is required"),
  performanceEvidence: z.string().min(1, "Specific performance evidence is required"),
  educationalRelevance: z.string().min(1, "Educational relevance is required"),
});
export type ObservedStrengthItem = z.infer<typeof ObservedStrengthItemSchema>;

export const ObservedStrengthEntrySchema = z.union([
  ObservedStrengthItemSchema,
  z.string().transform((str) => ({
    heading: "Demonstrated Cognitive Proficiency",
    cognitiveSkill: "Core Cognitive Skill",
    observation: str,
    performanceEvidence: str,
    educationalRelevance:
      "Provides a dependable foundation for structured classroom tasks, focused attention, and independent problem-solving.",
  })),
]);

export const AreaForPracticeItemSchema = z.object({
  heading: z.string().min(1, "Practice heading is required"),
  cognitiveSkill: z.string().min(1, "Cognitive skill is required"),
  observedPattern: z.string().min(1, "Observed pattern description is required"),
  performanceEvidence: z.string().min(1, "Specific performance evidence is required"),
  recommendedApproach: z.string().min(1, "Recommended approach is required"),
});
export type AreaForPracticeItem = z.infer<typeof AreaForPracticeItemSchema>;

export const AreaForPracticeEntrySchema = z.union([
  AreaForPracticeItemSchema,
  z.string().transform((str) => ({
    heading: "Area for Playful Growth",
    cognitiveSkill: "Developing Cognitive Skill",
    observedPattern: str,
    performanceEvidence: str,
    recommendedApproach:
      "Engage in playful, everyday household routines that exercise this skill in an encouraging, low-pressure environment.",
  })),
]);

export const HomeActivityItemSchema = z.object({
  title: z.string().min(1, "Activity title is required"),
  skillsPracticed: z.array(z.string().min(1)).min(1, "At least one skill practiced must be listed"),
  materials: z.array(z.string().min(1)).min(1, "At least one material must be listed"),
  instructions: z.array(z.string().min(1)).min(3, "At least 3 instructional steps are required"),
  suggestedDuration: z.string().min(1, "Suggested duration is required"),
  difficultyProgression: z.string().optional().default(""),
  learningOpportunity: z.string().min(1, "Learning opportunity is required"),
  parentTip: z.string().min(1, "Parent tip is required"),
  description: z.string().optional(),
  activityType: z.string().optional(),
});
export type HomeActivityItem = z.infer<typeof HomeActivityItemSchema>;

export const HomeActivityEntrySchema = z.union([
  HomeActivityItemSchema,
  z.object({
    title: z.string(),
    description: z.string(),
    activityType: z.string().optional(),
  }).transform((legacy) => ({
    title: legacy.title,
    skillsPracticed: ["Cognitive Engagement", "Problem-Solving Strategy"],
    materials: ["Common household objects", "Pencil and paper"],
    instructions: [
      `Introduce the activity warmly to your child: "${legacy.title}".`,
      legacy.description,
      "Observe how the child approaches the challenge and encourage them to explain their strategy aloud.",
      "Praise effort, persistence, and creative thinking during and after the activity.",
    ],
    suggestedDuration: "10–15 minutes",
    difficultyProgression: "Gradually add items or reduce verbal hints as the child develops confidence.",
    learningOpportunity: legacy.description,
    parentTip: "Celebrate curiosity and exploration rather than expecting immediate accuracy.",
    description: legacy.description,
    activityType: legacy.activityType || "Home Game",
  })),
]);

export const AiStructuredReportSchema = z.object({
  reportTitle: z
    .string()
    .default("OrionKids Cognitive Exploration & Gameplay Report"),
  childOverview: z.string(),
  questSummary: z.string(),
  overallPerformanceSummary: z.string(),
  gameWiseAnalysis: z.array(
    z.object({
      gameKey: z.string(),
      gameName: z.string(),
      cognitiveDomain: z.string(),
      gameStatus: z
        .enum(["COMPLETED", "SKIPPED", "IN_PROGRESS", "NOT_ATTEMPTED"])
        .default("COMPLETED")
        .or(z.string()),
      levelsCompleted: z.number().int().min(0).max(3),
      averageAccuracy: z.number().nullable(),
      averageReactionTimeMs: z.number().nullable(),
      summary: z.string(),
      observedStrengths: z.array(z.string()).default([]),
      areasForPractice: z.array(z.string()).default([]),
    })
  ),
  levelWisePerformance: z.array(
    z.object({
      gameKey: z.string(),
      levelNumber: z.number(),
      status: z.string(),
      accuracy: z.number().nullable(),
      durationMs: z.number().nullable(),
      averageReactionTimeMs: z.number().nullable(),
      insight: z.string(),
    })
  ),
  observedStrengths: z.array(ObservedStrengthEntrySchema),
  areasForPractice: z.array(AreaForPracticeEntrySchema),
  progressAndConsistency: z.string(),
  parentRecommendations: z.array(HomeActivityEntrySchema),
  homeActivities: z.array(HomeActivityEntrySchema).optional(),
  dataLimitations: z.string(),
  reportGenerationDate: z.string(),
});

export type AiStructuredReport = z.infer<typeof AiStructuredReportSchema>;

export interface GameplayReportInput {
  child: {
    childName: string;
    age: number;
    selectedClass: string;
    school: string | null;
  };
  quest: {
    sessionId: string;
    startedAt: string;
    completedAt: string | null;
    totalLevelsCompleted: number;
    overallAccuracy: number;
    totalDurationMs: number;
  };
  warmUp: {
    copingStrategy: string;
    learningStyle: string;
    favoriteSubject: string;
    emotionalState: string;
  };
  games: Array<{
    gameId: number;
    gameKey: string;
    gameName: string;
    domain: string;
    gameStatus?: string;
    levelsCompleted: number;
    averageAccuracy: number | null;
    averageReactionTimeMs: number | null;
    levels: Array<{
      levelNumber: number;
      attemptNumber: number;
      status: string;
      totalTrials: number | null;
      correctTrials: number | null;
      accuracy: number | null;
      durationMs: number | null;
      averageReactionTimeMs: number | null;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Comprehensive System Instructions
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTIONS = `You are a Senior Educational Assessment Specialist, Child Development Psychologist, and Pedagogical Report Author for the OrionKids Cognitive Exploration Platform.

You will receive verified, objective gameplay telemetry belonging to ONE child from an assessment quest consisting of up to 6 distinct games and 18 progressively calibrated levels.

Your responsibility is to analyze the supplied gameplay metrics and generate an exceptionally detailed, personalized, evidence-grounded, and educationally useful report written specifically for parents and guardians.

================================================================================
CORE PRINCIPLES & GUIDELINES
================================================================================

1. DATA ANALYST DISCIPLINE:
   - Carefully examine the supplied child profile, warm-up reflections, game-wise averages, and individual level telemetry.
   - Ground every observation in the actual recorded numbers (accuracy %, reaction times in seconds, completed levels, trial counts).
   - Never invent or fabricate scores, times, or levels that do not exist in the data.
   - Accurately distinguish completion status from accuracy:
     * A status of "COMPLETED" or "DONE" simply means the level was finished, not that accuracy was 100%.
     * A status of "NOT_COMPLETED" or missing attempt means the child did not play or finish that level; it is NOT a score of 0% and must never be characterized as a failure.
     * An accuracy of 0% must be interpreted constructively according to the task rules rather than as incapacity.

2. PARENT-FRIENDLY DOMAIN NAMES & GRADE 5–7 READABILITY:
   Frame all interpretations around the canonical six OrionKids cognitive domain mappings using clear, everyday language:
   - Stroop Colour-Word: Staying Focused (Focus & Impulse Control) — Paying attention, pausing before clicking, and ignoring distracting words.
   - Card Flip: Remembering Pictures (Visual Memory) — Remembering pictures and where cards hide on the board.
   - Pattern Recognition: Finding Patterns (Pattern Recognition) — Spotting patterns and working out what comes next.
   - Odd One Out: Spotting Differences (Visual Attention) — Looking closely to spot differences and finding objects that don't belong.
   - Rule Discovery: Trying New Rules (Mental Flexibility) — Trying out new ideas and adapting when the rules change.
   - Story Sequencing: Remembering Story Order (Story Sequencing) — Putting story cards in clear beginning-to-end order.

   TARGET GRADE 5–7 READING LEVEL:
   - Write every section in warm, encouraging, plain English that any parent can understand in under 30 seconds.
   - Keep sentences short, active, and accessible. Avoid all clinical, neuropsychological, psychometric, and diagnostic jargon.
   - Use plain phrases instead of academic terms:
     * Instead of "inhibitory control" or "interference resistance", use "staying focused and pausing before clicking".
     * Instead of "visuospatial working memory", use "remembering pictures and card locations".
     * Instead of "pattern induction & extrapolation", use "finding patterns and guessing what comes next".
     * Instead of "visual feature acuity" or "invariant feature discrimination", use "spotting differences between pictures".
     * Instead of "hypothesis testing", use "trying out new ideas or guessing the secret rule".
     * Instead of "cognitive flexibility" or "perseverative errors", use "adapting to a new rule rather than sticking to the old one".
     * Instead of "temporal and narrative sequencing", use "putting story events in order from beginning to end".

3. NON-CLINICAL & SUPPORTIVE ETHICS:
   - This report is an educational gameplay summary, NOT a clinical, neurological, psychiatric, or diagnostic assessment.
   - NEVER diagnose ADHD, autism, attention deficit disorders, memory impairments, or learning disabilities.
   - NEVER predict IQ, intelligence, or permanent cognitive potential.
   - Do NOT treat gameplay accuracy in a single digital session as measuring a fixed cognitive ability.
   - Use supportive, warm, constructive, and dignified educational language.
   - Absolutely NEVER describe a child as weak, deficient, incapable, failing, or slow. Frame growth areas as exciting emerging frontiers.

4. SKIPPED GAMES & DATA INTEGRITY:
   - If a game has gameStatus "SKIPPED" (or levelsCompleted < 3 with null accuracy):
     * In gameWiseAnalysis:
       - summary MUST state: "This activity was skipped during the quest session, so no performance score is available for this game. Skipping an activity is completely normal when a child feels tired or prefers different puzzle styles, and does not indicate any cognitive deficit."
       - averageAccuracy MUST be null (never 0% or fake score).
       - averageReactionTimeMs MUST be null (never fake pace).
       - levelsCompleted MUST be the actual unique completed levels count (0 to 3, never exceeding 3).
       - gameStatus MUST be "SKIPPED".
     * In observedStrengths and areasForPractice:
       - NEVER treat a skipped game as a weakness, deficit, or practice area based on low/missing score.
       - Only draw practice areas from games that were genuinely completed and scored.
   - Levels Completed for any game must NEVER exceed 3 (always bounded 0 to 3).

================================================================================
DETAILED SECTION REQUIREMENTS
================================================================================

A. OVERALL PERFORMANCE SUMMARY (100–150 words):
   - Executive synthesis written for parents connecting quest participation, completed games, notable strengths, growth frontiers, and the value of continued playful learning at home. Avoid repeating every numerical score.

B. OBSERVED STRENGTHS (3–5 detailed, evidence-based items):
   - For each strength, provide:
     * heading: Engaging descriptive strength title.
     * cognitiveSkill: Relevant cognitive domain.
     * observation: Comprehensive explanation of what the child demonstrated during gameplay.
     * performanceEvidence: Concrete level-wise citations (e.g., "100% accuracy in Levels 1 and 2 of Card Flip with an average response time of 1.4s").
     * educationalRelevance: Why this skill is valuable in everyday learning, reading, math, or classroom activities.

C. AREAS FOR FURTHER PRACTICE (2–4 constructive, evidence-based items):
   - For each practice area, provide:
     * heading: Positive growth frontier title.
     * cognitiveSkill: Relevant cognitive domain.
     * observedPattern: Objective description of performance variation across levels (e.g., strong start in Level 1 followed by lower accuracy as multi-attribute distractors increased in Levels 2 and 3).
     * performanceEvidence: Specific game and level numbers with recorded metrics, framed cautiously without making assumptions about underlying causes.
     * recommendedApproach: Encouraging, practical recommendation for parents to nurture this skill through everyday routines.

D. PARENT-FRIENDLY HOME ACTIVITIES (4–6 rich, personalized activities):
   - Tailor activities directly to the child's demonstrated practice areas, strengths, age, and warm-up preferences (e.g., favorite subjects, coping strategies).
   - Each activity must include:
     * title: Catchy, engaging activity title (e.g., "Surprise Rule Switching", "Story Detective & Sequence Mapping").
     * skillsPracticed: Array of 2–3 specific cognitive skills.
     * materials: Array of readily available, screen-free household materials (e.g., building blocks, colored buttons, bedtime books, laundry items).
     * instructions: 4 to 7 numbered, practical, step-by-step instructions for parents on introducing and conducting the game.
     * suggestedDuration: Manageable duration suited to the child's age (e.g., "10–15 minutes").
     * difficultyProgression: Clear guidance on how to make the activity simpler or more challenging over time.
     * learningOpportunity: Clear explanation of what this activity allows the child to practice.
     * parentTip: Warm, encouraging tip on celebrating effort and curiosity rather than perfection.

E. GAME-WISE ANALYSIS (70–110 words per game for all 6 games):
   - For each of the six canonical games, provide a cohesive paragraph covering: what the game involved, the cognitive domain, the child's actual recorded scores and level completion, level-to-level consistency or variation, and practical connections to classroom learning.

F. LEVEL-WISE PERFORMANCE (Insight for all 18 levels):
   - For each level (Game 1 Level 1 through Game 6 Level 3), write a concise, meaningful, data-grounded insight reflecting accuracy, reaction time, duration, and transition from previous levels.

G. PROGRESS AND CONSISTENCY:
   - Provide an evidence-grounded assessment explaining performance across early, middle, and later levels, consistency between different games, whether all levels were completed, and pacing trends without making unearned claims of sustained focus.

H. DATA LIMITATIONS:
   - Standard educational disclaimer that the report reflects digital gameplay performance during a single session and is designed to celebrate strengths and suggest playful home routines, not serve as a clinical or medical diagnosis.

================================================================================
JSON OUTPUT SCHEMA CONTRACT
================================================================================
You must respond ONLY with a single valid JSON object strictly matching this structure:
{
  "reportTitle": "OrionKids Cognitive Exploration & Gameplay Report",
  "childOverview": "Summary of child, age, class, school, and warm-up reflections",
  "questSummary": "Overview of the completed quest session, total levels, overall accuracy, and duration",
  "overallPerformanceSummary": "100-150 word parent-friendly executive synthesis",
  "gameWiseAnalysis": [
    {
      "gameKey": "stroop",
      "gameName": "Stroop Colour-Word",
      "cognitiveDomain": "Focus & Interference Resistance",
      "levelsCompleted": 3,
      "averageAccuracy": 90,
      "averageReactionTimeMs": 1450,
      "summary": "70-110 word evidence-based educational analysis of performance in this game",
      "observedStrengths": ["specific strength note"],
      "areasForPractice": ["constructive practice note"]
    }
    // exactly 6 games: stroop, card-flip, pattern, odd-one-out, rule-discovery, story-sequencing
  ],
  "levelWisePerformance": [
    {
      "gameKey": "stroop",
      "levelNumber": 1,
      "status": "COMPLETED",
      "accuracy": 100,
      "durationMs": 14000,
      "averageReactionTimeMs": 1200,
      "insight": "Accurate, concise data-grounded insight for Level 1"
    }
    // exactly 18 level entries
  ],
  "observedStrengths": [
    {
      "heading": "Strength Title",
      "cognitiveSkill": "Cognitive Domain",
      "observation": "Detailed observation paragraph",
      "performanceEvidence": "Exact level-wise evidence with numbers",
      "educationalRelevance": "Classroom and everyday learning relevance"
    }
  ],
  "areasForPractice": [
    {
      "heading": "Growth Frontier Title",
      "cognitiveSkill": "Cognitive Domain",
      "observedPattern": "Constructive description of performance variation",
      "performanceEvidence": "Exact level-wise evidence with numbers",
      "recommendedApproach": "Practical parent guidance"
    }
  ],
  "progressAndConsistency": "Assessment of progression across early, middle, and late levels",
  "parentRecommendations": [
    {
      "title": "Engaging Activity Title",
      "skillsPracticed": ["Skill 1", "Skill 2"],
      "materials": ["Household item 1", "Household item 2"],
      "instructions": [
        "Step 1: Collect materials and explain the game playfully.",
        "Step 2: Guide the child through the initial turn.",
        "Step 3: Encourage the child to try independently.",
        "Step 4: Gradually shift the rule or add a step.",
        "Step 5: Conclude with shared reflection."
      ],
      "suggestedDuration": "10–15 minutes",
      "difficultyProgression": "How to simplify or advance the activity",
      "learningOpportunity": "What this exercises cognitively",
      "parentTip": "Warm encouragement for parents"
    }
  ],
  "dataLimitations": "Educational disclaimer stating this report reflects digital gameplay performance during a specific session and is not a clinical or medical evaluation.",
  "reportGenerationDate": "ISO date string"
}`;

// ---------------------------------------------------------------------------
// Generate AI Report (OpenAI with Structured Output)
// ---------------------------------------------------------------------------

export async function generateAiReport(input: GameplayReportInput): Promise<{
  report: AiStructuredReport;
  modelName: string;
  usedAi: boolean;
  errorMessage?: string;
}> {
  const modelToUse = env.OPENAI_REPORT_MODEL || "gpt-4o-mini";
  const startTime = Date.now();

  logger.info(
    {
      sessionId: input.quest.sessionId,
      childName: input.child.childName,
      model: modelToUse,
    },
    "ai_report.generation_started"
  );

  if (!openaiApiKey) {
    logger.warn(
      { sessionId: input.quest.sessionId },
      "ai_report.key_missing: OPEN_AI_API_KEY not configured, generating rich rule-based report"
    );
    const fallback = generateRuleBasedReport(input);
    return {
      report: fallback,
      modelName: "rule-based-engine",
      usedAi: false,
      errorMessage:
        "OpenAI API key not configured. Generated authoritative rule-based report.",
    };
  }

  try {
    logger.info(
      {
        sessionId: input.quest.sessionId,
        model: modelToUse,
      },
      "ai_report.openai_request_initiated"
    );

    const openai = new OpenAI({
      apiKey: openaiApiKey,
      timeout: 20000, // 20s timeout
      maxRetries: 1, // at most 1 retry for reliability
    });

    // Formulate optimized, structured user message
    const userPrompt = `Generate the comprehensive OrionKids Cognitive Exploration & Gameplay Report for this child based on their authoritative gameplay telemetry:

=== CHILD PROFILE ===
- Name: ${input.child.childName}
- Age: ${input.child.age} years old
- Class: ${input.child.selectedClass}
- School: ${input.child.school || "Not specified"}

=== QUEST SESSION METADATA ===
- Session ID: ${input.quest.sessionId}
- Started At: ${input.quest.startedAt}
- Completed At: ${input.quest.completedAt || "In Progress / Recently Finished"}
- Total Levels Completed: ${input.quest.totalLevelsCompleted}/18
- Overall Accuracy: ${input.quest.overallAccuracy}%
- Total Active Duration: ${Math.round(input.quest.totalDurationMs / 1000)} seconds (~${Math.round(input.quest.totalDurationMs / 60000)} minutes)

=== WARM-UP & LEARNING PREFERENCES ===
- Approach to Challenging Puzzles: ${input.warmUp.copingStrategy}
- Preferred Learning Style: ${input.warmUp.learningStyle}
- Favorite Academic Subject: ${input.warmUp.favoriteSubject}
- Emotional State at Start: ${input.warmUp.emotionalState}

=== GAME-WISE PERFORMANCE (6 DOMAINS) ===
${input.games
  .map(
    (g) =>
      `• Game ${g.gameId}: ${g.gameName} (${g.domain})
   - Levels Completed: ${g.levelsCompleted}/3
   - Average Accuracy: ${g.averageAccuracy !== null ? `${g.averageAccuracy}%` : "Not recorded"}
   - Average Reaction Time: ${g.averageReactionTimeMs !== null ? `${(g.averageReactionTimeMs / 1000).toFixed(2)}s` : "Not recorded"}
   - Level Breakdown:
${g.levels
  .map(
    (lvl) =>
      `     * Level ${lvl.levelNumber}: Status=${lvl.status}, Accuracy=${lvl.accuracy !== null ? `${lvl.accuracy}%` : "N/A"}, Correct=${lvl.correctTrials ?? "N/A"}/${lvl.totalTrials ?? "N/A"}, Duration=${lvl.durationMs ? `${Math.round(lvl.durationMs / 1000)}s` : "N/A"}, Pace=${lvl.averageReactionTimeMs ? `${(lvl.averageReactionTimeMs / 1000).toFixed(2)}s` : "N/A"}`
  )
  .join("\n")}`
  )
  .join("\n\n")}

=== REPORT GENERATION INSTRUCTIONS ===
1. Analyze the exact level-wise data supplied above.
2. Produce 3–5 detailed, evidence-based Observed Strengths citing specific levels and numbers.
3. Produce 2–4 constructive, evidence-based Areas for Further Practice describing observed variations and practical parent approaches.
4. Generate 4–6 personalized, screen-free Home Activities tailored to the child's age (${input.child.age}) and performance, each with readily available household materials and 4–7 clear instructional steps.
5. Provide a 70–110 word summary for each of the 6 games.
6. Provide an accurate, data-grounded insight for each of the 18 levels.
7. Provide a 100–150 word parent-friendly Overall Performance Summary.
8. Follow the JSON schema strictly.`;

    const completion = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
    });

    const durationMs = Date.now() - startTime;
    const usage = completion.usage;
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? 0;
    const estimatedCostUsd = estimateOpenAiCostUsd(
      completion.model || modelToUse,
      inputTokens,
      outputTokens
    );

    logger.info(
      {
        sessionId: input.quest.sessionId,
        model: completion.model || modelToUse,
        durationMs,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        openAiId: completion.id,
      },
      "ai_report.openai_request_completed"
    );

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("OpenAI returned empty message content");
    }

    const parsedJson = JSON.parse(rawContent);

    // If model returned homeActivities instead of parentRecommendations, align them
    if (parsedJson.homeActivities && !parsedJson.parentRecommendations) {
      parsedJson.parentRecommendations = parsedJson.homeActivities;
    } else if (parsedJson.parentRecommendations && !parsedJson.homeActivities) {
      parsedJson.homeActivities = parsedJson.parentRecommendations;
    }

    if (Array.isArray(parsedJson.gameWiseAnalysis)) {
      parsedJson.gameWiseAnalysis = parsedJson.gameWiseAnalysis.map((g: any) => ({
        ...g,
        levelsCompleted: Math.min(
          3,
          Math.max(0, typeof g.levelsCompleted === "number" ? g.levelsCompleted : 0)
        ),
      }));
    }

    const validated = AiStructuredReportSchema.parse(parsedJson);

    logger.info(
      {
        sessionId: input.quest.sessionId,
        model: completion.model || modelToUse,
        durationMs,
        strengthsCount: validated.observedStrengths.length,
        practiceCount: validated.areasForPractice.length,
        activitiesCount: validated.parentRecommendations.length,
      },
      "ai_report.structured_report_validated"
    );

    return {
      report: validated,
      modelName: completion.model || modelToUse,
      usedAi: true,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCategory =
      err?.code || (err?.name === "APIConnectionTimeoutError" ? "TIMEOUT" : "API_ERROR");
    const httpStatus = err?.status ?? null;

    logger.error(
      {
        sessionId: input.quest.sessionId,
        model: modelToUse,
        durationMs,
        errorCategory,
        httpStatus,
        err: errorMsg,
      },
      "ai_report.openai_request_failed"
    );
    logger.warn(
      { sessionId: input.quest.sessionId },
      "ai_report.falling_back_to_rule_based"
    );

    const fallback = generateRuleBasedReport(input);
    return {
      report: fallback,
      modelName: "rule-based-fallback",
      usedAi: false,
      errorMessage: `OpenAI error: ${errorMsg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// High-Fidelity, Evidence-Based Deterministic Rule-Based Generator
// ---------------------------------------------------------------------------

interface GameStats {
  gameId: number;
  gameKey: string;
  gameName: string;
  domain: string;
  gameStatus: string;
  levelsCompleted: number;
  averageAccuracy: number | null;
  averageReactionTimeMs: number | null;
  levels: Array<{
    levelNumber: number;
    attemptNumber: number;
    status: string;
    totalTrials: number | null;
    correctTrials: number | null;
    accuracy: number | null;
    durationMs: number | null;
    averageReactionTimeMs: number | null;
  }>;
}

export function generateRuleBasedReport(
  input: GameplayReportInput
): AiStructuredReport {
  const { child, quest, warmUp, games } = input;

  // Build canonical game list with real or defaulted metrics
  const analyzedGames: GameStats[] = CANONICAL_GAMES.map((cg) => {
    const recorded = games.find((g) => g.gameKey === cg.key);
    const rawDone = recorded?.levelsCompleted ?? 0;
    const clampedDone = Math.min(3, Math.max(0, rawDone));
    const isSkipped = recorded?.gameStatus === "SKIPPED";
    return {
      gameId: cg.id,
      gameKey: cg.key,
      gameName: cg.name,
      domain: cg.domain,
      gameStatus: isSkipped
        ? "SKIPPED"
        : recorded?.gameStatus || (clampedDone === 3 ? "COMPLETED" : "NOT_COMPLETED"),
      levelsCompleted: clampedDone,
      averageAccuracy: isSkipped ? null : (recorded?.averageAccuracy ?? null),
      averageReactionTimeMs: isSkipped ? null : (recorded?.averageReactionTimeMs ?? null),
      levels: recorded?.levels || [],
    };
  });

  // 1. GAME-WISE ANALYSIS (Written in plain English, Grade 5–7 friendly reading level)
  const gameWiseAnalysis = analyzedGames.map((g) => {
    const isGameSkipped = g.gameStatus === "SKIPPED";
    const done = Math.min(3, Math.max(0, g.levelsCompleted));
    const acc = isGameSkipped ? null : g.averageAccuracy;
    const rt = isGameSkipped ? null : g.averageReactionTimeMs;
    const l1 = isGameSkipped ? null : g.levels.find((l) => l.levelNumber === 1)?.accuracy;
    const l2 = isGameSkipped ? null : g.levels.find((l) => l.levelNumber === 2)?.accuracy;
    const l3 = isGameSkipped ? null : g.levels.find((l) => l.levelNumber === 3)?.accuracy;

    const rtText = rt ? ` with an average pace of ${(rt / 1000).toFixed(1)} seconds per trial` : "";
    let summary = "";
    const strengths: string[] = [];
    const practice: string[] = [];

    if (isGameSkipped) {
      summary = `This activity was skipped during the quest session, so no performance score is available for this game. Skipping an activity is completely normal when a child feels tired or prefers different puzzle styles, and does not indicate any cognitive deficit.`;
      if (done > 0) {
        summary += ` ${child.childName} explored Level 1 before moving forward, showing positive curiosity.`;
        strengths.push(`Explored foundational mechanics before transitioning to the next challenge.`);
      }
      practice.push(`Enjoyable, low-pressure home play with ${g.domain.toLowerCase()}.`);
    } else {
      switch (g.gameKey) {
        case "stroop":
          summary = `${child.childName} played Stroop Colour-Word (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% overall accuracy` : ""}${rtText}. This activity looked at how well ${child.childName} stays focused and pauses before clicking, even when the color word tries to trick them. `;
          if (acc !== null && acc >= 85) {
            summary += `Recorded performance was very strong in the early levels (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), showing great focus and steady self-control when choosing colors.`;
            strengths.push(`Great focus and self-control when ignoring word distractions (${acc}% average accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Showed steady focus across early levels (Level 1: ${l1 ?? acc}%) while keeping a positive attitude as the words became trickier in Level 3 (${l3 ?? acc}%).`;
            strengths.push(`Kept focused and worked through tricky color challenges.`);
            practice.push(`Fun games at home like Simon Says to practice pausing before reacting.`);
          } else {
            summary += `Engaged actively through ${done} level attempts, showing a great willingness to try challenging color puzzles. Extra practice through fun games will help them pause and choose with confidence.`;
            practice.push(`Playful everyday games that practice pausing and staying focused.`);
          }
          break;

        case "card-flip":
          summary = `${child.childName} played Cosmic Card Flip (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% average accuracy` : ""}${rtText}. This game looked at how well ${child.childName} remembers pictures and keeps track of where matching cards hide on the board. `;
          if (acc !== null && acc >= 85) {
            summary += `Showed excellent picture memory across the grids (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), finding matching pairs quickly and remembering where planets hid.`;
            strengths.push(`Excellent memory for pictures and card locations (${acc}% average accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Found matching pairs smoothly in the starter levels, using a calm and thoughtful approach as more cards were added to the grid.`;
            strengths.push(`Methodical search strategy when hunting for matching pairs.`);
            practice.push(`Classic matching card games with cards placed face down at home.`);
          } else {
            summary += `Tried hard through multiple card-matching rounds, showing great patience as the board grew larger. Fun picture games at home will help grow their memory skills.`;
            practice.push(`Casual matching card games starting with 4 to 6 pairs.`);
          }
          break;

        case "pattern":
          summary = `${child.childName} played Pattern Recognition (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% average accuracy` : ""}${rtText}. This activity looked at how well ${child.childName} spots visual patterns and works out what shape or color comes next. `;
          if (acc !== null && acc >= 85) {
            summary += `Spotted the repeating sequences with ease across levels (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), quickly picking the missing space tile every time.`;
            strengths.push(`Quickly spots repeating patterns and sequence rules (${acc}% accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Solved color and shape patterns easily, showing good logic when thinking about what should come next in the sequence.`;
            strengths.push(`Good logical thinking on visual pattern puzzles.`);
            practice.push(`Building repeating patterns using colored blocks, legos, or beads.`);
          } else {
            summary += `Enthusiastically worked through pattern sequences. Practicing with real-world objects at home will make spotting patterns even more natural and fun.`;
            practice.push(`Making fun shape and color patterns with household objects.`);
          }
          break;

        case "odd-one-out":
          summary = `${child.childName} played Odd One Out (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% average accuracy` : ""}${rtText}. This challenge looked at how closely ${child.childName} inspects pictures to spot subtle differences and pick the object that doesn't belong. `;
          if (acc !== null && acc >= 85) {
            summary += `Demonstrated keen observation across all levels (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), quickly finding the difference without second-guessing.`;
            strengths.push(`Sharp eye for detail and spotting differences quickly (${acc}% accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Spotted obvious differences right away, taking time to carefully compare items when multiple cards looked similar.`;
            strengths.push(`Careful visual comparison when inspecting similar objects.`);
            practice.push(`Spot-the-difference picture puzzles in books or magazines.`);
          } else {
            summary += `Carefully inspected each group of objects, showing good patience while searching for what made one card unique.`;
            practice.push(`Playful 'which one doesn't belong' games with toys or fruit at snack time.`);
          }
          break;

        case "rule-discovery":
          summary = `${child.childName} played Rule Discovery (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% average accuracy` : ""}${rtText}. This game looked at how ${child.childName} tries out new ideas and adapts when the sorting rule changes between color, shape, and count. `;
          if (acc !== null && acc >= 85) {
            summary += `Adapted smoothly whenever the secret sorting rule switched (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), testing new ideas right away and learning from the hints.`;
            strengths.push(`Adapts quickly and tests new ideas when rules change (${acc}% accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Figured out the starting sorting rules with confidence, adjusting their choices nicely as the game introduced new rules.`;
            strengths.push(`Thoughtful approach to testing new sorting rules.`);
            practice.push(`Sorting toys or socks by color, then switching to sorting by size.`);
          } else {
            summary += `Showed great willingness to try different ideas across the rounds. Fun sorting games with changing rules will help them feel confident whenever things switch.`;
            practice.push(`Fun sorting games with surprise rule changes during family cleanup time.`);
          }
          break;

        case "story-sequencing":
          summary = `${child.childName} played Story Sequencing (${g.domain}), completing ${done}/3 levels${acc !== null ? ` with ${acc}% average accuracy` : ""}${rtText}. This activity looked at how well ${child.childName} puts story events in order from beginning to middle to end. `;
          if (acc !== null && acc >= 85) {
            summary += `Arranged the adventure cards in clear, logical order (Level 1: ${l1 ?? acc}%, Level 2: ${l2 ?? acc}%), showing a wonderful grasp of cause and effect in stories.`;
            strengths.push(`Clear understanding of story order and what happens next (${acc}% accuracy).`);
          } else if (acc !== null && acc >= 60) {
            summary += `Ordered standard cause-and-effect scenes nicely, showing good comprehension as story scenes became longer.`;
            strengths.push(`Good understanding of beginning, middle, and end in stories.`);
            practice.push(`Talking about 'what happened first, next, and last' after reading bedtime books.`);
          } else {
            summary += `Enjoyed exploring the story cards and thinking about the characters. Retelling daily adventures together will strengthen sequencing in a fun, natural way.`;
            practice.push(`Retelling daily routines or favorite fairy tales step by step.`);
          }
          break;

        default:
          summary = `${child.childName} completed ${done}/3 levels in ${g.gameName} (${g.domain})${acc !== null ? ` with ${acc}% average accuracy` : ""}, demonstrating positive engagement throughout the activity.`;
      }
    }

    return {
      gameKey: g.gameKey,
      gameName: g.gameName,
      cognitiveDomain: g.domain,
      gameStatus: g.gameStatus,
      levelsCompleted: done,
      averageAccuracy: acc,
      averageReactionTimeMs: rt,
      summary: summary.trim(),
      observedStrengths: strengths.length > 0 ? strengths : [`Consistent engagement in ${g.gameName}.`],
      areasForPractice: practice.length > 0 ? practice : [`Continue playful exploration in ${g.domain.toLowerCase()}.`],
    };
  });

  // 2. LEVEL-WISE PERFORMANCE (All 18 levels with data-grounded insights)
  const levelWisePerformance: AiStructuredReport["levelWisePerformance"] = [];
  for (const g of analyzedGames) {
    for (let lvl = 1; lvl <= 3; lvl++) {
      const att = g.levels.find((l) => l.levelNumber === lvl);
      const isLevelSkipped = att?.status === "SKIPPED" || g.gameStatus === "SKIPPED";
      const acc = isLevelSkipped ? null : (att?.accuracy ?? null);
      const duration = att?.durationMs ?? null;
      const rt = isLevelSkipped ? null : (att?.averageReactionTimeMs ?? null);
      const status = isLevelSkipped ? "SKIPPED" : att?.status || (acc !== null ? "COMPLETED" : "NOT_COMPLETED");

      let insight = `${g.gameName} Level ${lvl}`;
      if (status === "SKIPPED") {
        insight = `This activity level was skipped during the session; completely normal when a child feels tired.`;
      } else if (status === "COMPLETED" && acc !== null) {
        const paceStr = rt ? ` with a steady pace of ${(rt / 1000).toFixed(1)}s per trial` : "";
        if (acc >= 90) {
          insight = `Great work with ${acc}% accuracy${paceStr}, showing strong confidence with this challenge.`;
        } else if (acc >= 70) {
          insight = `Good focus with ${acc}% accuracy${paceStr}, showing solid effort throughout the level.`;
        } else if (acc >= 50) {
          insight = `Completed with ${acc}% accuracy${paceStr}, taking time to think through the puzzles.`;
        } else {
          insight = `Completed level exploration with ${acc}% accuracy, persisting through tricky conditions.`;
        }
      } else if (status === "COMPLETED") {
        insight = `Level completed successfully with positive engagement and curious exploration.`;
      } else {
        insight = `Level not played during this session; ready for future fun exploration.`;
      }

      levelWisePerformance.push({
        gameKey: g.gameKey,
        levelNumber: lvl,
        status,
        accuracy: acc,
        durationMs: duration,
        averageReactionTimeMs: rt,
        insight,
      });
    }
  }

  // 3. RANK GAMES FOR EVIDENCE-BASED STRENGTHS & GROWTH AREAS
  const scoredGames = analyzedGames.filter(
    (g) => g.averageAccuracy !== null && g.gameStatus !== "SKIPPED"
  );
  const sortedByAcc = [...scoredGames].sort(
    (a, b) => (b.averageAccuracy ?? 0) - (a.averageAccuracy ?? 0)
  );

  const observedStrengths: ObservedStrengthItem[] = [];

  // Top Game 1
  if (sortedByAcc[0] && (sortedByAcc[0].averageAccuracy ?? 0) >= 70) {
    const top = sortedByAcc[0];
    const l1 = top.levels.find((l) => l.levelNumber === 1)?.accuracy ?? top.averageAccuracy;
    const l2 = top.levels.find((l) => l.levelNumber === 2)?.accuracy ?? top.averageAccuracy;
    observedStrengths.push({
      heading: `${top.domain} Proficiency`,
      cognitiveSkill: top.domain,
      observation: `${child.childName} demonstrated confident mastery during ${top.gameName} challenges, solving problems with notable poise and accuracy. This pattern reflects efficient cognitive processing in ${top.domain.toLowerCase()}, enabling the child to grasp core task rules quickly and maintain high precision throughout the activity.`,
      performanceEvidence: `Recorded ${top.averageAccuracy}% average accuracy across completed levels (Level 1: ${l1}%, Level 2: ${l2}%)${top.averageReactionTimeMs ? ` with a steady decision pace of ${(top.averageReactionTimeMs / 1000).toFixed(1)}s` : ""}.`,
      educationalRelevance: `Strong ${top.domain.toLowerCase()} provides an essential anchor for classroom learning, supporting structured reading comprehension, multi-step math problem solving, and independent academic work.`,
    });
  }

  // Top Game 2
  if (sortedByAcc[1] && (sortedByAcc[1].averageAccuracy ?? 0) >= 65) {
    const second = sortedByAcc[1];
    observedStrengths.push({
      heading: `Reliable ${second.domain}`,
      cognitiveSkill: second.domain,
      observation: `Throughout the ${second.gameName} activities, ${child.childName} displayed dependable problem-solving consistency. The child effectively organized incoming visual information and responded with thoughtful deliberation as difficulty increased.`,
      performanceEvidence: `Achieved ${second.averageAccuracy}% average accuracy across ${second.levelsCompleted} levels in ${second.gameName}.`,
      educationalRelevance: `Competence in ${second.domain.toLowerCase()} facilitates following multi-step classroom instructions and organizing thoughts logically during learning tasks.`,
    });
  }

  // Consistency & Pacing Strength
  const avgRtAcross =
    analyzedGames
      .map((g) => g.averageReactionTimeMs)
      .filter((v): v is number => typeof v === "number" && v > 0);
  const overallAvgRt =
    avgRtAcross.length > 0
      ? Math.round(avgRtAcross.reduce((a, b) => a + b, 0) / avgRtAcross.length)
      : null;

  if (overallAvgRt && overallAvgRt < 2000) {
    observedStrengths.push({
      heading: "Decisive Pacing & Cognitive Efficiency",
      cognitiveSkill: "Information Processing & Decision Pacing",
      observation: `${child.childName} exhibited quick, decisive responses across multiple cognitive domains, demonstrating fluent visual processing and confidence in trial choices without prolonged hesitation.`,
      performanceEvidence: `Maintained an average reaction pace of ${(overallAvgRt / 1000).toFixed(1)} seconds per decision across all evaluated game trials.`,
      educationalRelevance: `Fluent processing speed assists children in completing timed classroom activities comfortably and transitioning smoothly between learning assignments.`,
    });
  } else {
    observedStrengths.push({
      heading: "Reflective and Deliberate Problem-Solving",
      cognitiveSkill: "Impulse Management & Thoughtful Pacing",
      observation: `${child.childName} approached cognitive challenges with calm deliberation, taking time to carefully inspect stimuli and consider options before committing to an answer.`,
      performanceEvidence: `Demonstrated thoughtful pacing${overallAvgRt ? ` (~${(overallAvgRt / 1000).toFixed(1)}s per decision)` : ""}, prioritizing careful evaluation over impulsive guessing.`,
      educationalRelevance: `A reflective approach supports deep conceptual understanding, accurate error checking, and thoughtful reading comprehension.`,
    });
  }

  // General Engagement Strength
  observedStrengths.push({
    heading: "Active Engagement & Positive Exploration",
    cognitiveSkill: "Task Persistence & Learning Motivation",
    observation: `Across diverse cognitive games, ${child.childName} demonstrated sustained enthusiasm and a willingness to take on new and unfamiliar problem types. In the warm-up, ${child.childName} favored '${warmUp.favoriteSubject}' and approached challenges with a '${warmUp.copingStrategy}' mindset.`,
    performanceEvidence: `Engaged through ${quest.totalLevelsCompleted} levels totaling ${Math.round(quest.totalDurationMs / 60000)} minutes of focused gameplay, achieving ${quest.overallAccuracy}% overall accuracy.`,
    educationalRelevance: `Curiosity and a growth-oriented mindset are the single greatest predictors of long-term academic enthusiasm and creative self-efficacy.`,
  });

  // 4. EVIDENCE-BASED AREAS FOR FURTHER PRACTICE (2 to 4 items)
  const areasForPractice: AreaForPracticeItem[] = [];

  const lowestGame = sortedByAcc[sortedByAcc.length - 1];
  if (lowestGame && (lowestGame.averageAccuracy ?? 100) < 80) {
    const l1 = lowestGame.levels.find((l) => l.levelNumber === 1)?.accuracy;
    const l2 = lowestGame.levels.find((l) => l.levelNumber === 2)?.accuracy;
    const l3 = lowestGame.levels.find((l) => l.levelNumber === 3)?.accuracy;
    areasForPractice.push({
      heading: `Nurturing ${lowestGame.domain}`,
      cognitiveSkill: lowestGame.domain,
      observedPattern: `In ${lowestGame.gameName}, ${child.childName} recorded performance variation as level complexity progressed${l1 !== undefined && l2 !== undefined ? ` (Level 1: ${l1}%, Level 2: ${l2}%${l3 !== undefined ? `, Level 3: ${l3}%` : ""})` : ""}. As additional visual distractors or complex rules were introduced, accuracy fluctuated.`,
      performanceEvidence: `Recorded an average accuracy of ${lowestGame.averageAccuracy}% in ${lowestGame.gameName} across ${lowestGame.levelsCompleted} levels.`,
      recommendedApproach: `Introduce fun, low-pressure everyday activities that exercise ${lowestGame.domain.toLowerCase()} through hands-on household play, gradually increasing complexity as the child gains confidence.`,
    });
  }

  const secondLowest = sortedByAcc[sortedByAcc.length - 2];
  if (secondLowest && (secondLowest.averageAccuracy ?? 100) < 85 && secondLowest !== lowestGame) {
    areasForPractice.push({
      heading: `Strengthening ${secondLowest.domain}`,
      cognitiveSkill: secondLowest.domain,
      observedPattern: `Performance in ${secondLowest.gameName} showed that while foundational mechanics were readily understood, higher-level multi-step challenges prompted a cautious or varying response pattern.`,
      performanceEvidence: `Achieved ${secondLowest.averageAccuracy}% average accuracy across evaluated levels in ${secondLowest.gameName}.`,
      recommendedApproach: `Encourage playful home challenges involving ${secondLowest.domain.toLowerCase()}, praising effort and curious experimentation rather than speed or perfect scores.`,
    });
  }

  // Always supply at least 2 constructive growth areas
  if (areasForPractice.length < 2) {
    areasForPractice.push({
      heading: "Managing Multi-Rule Transitions and Cognitive Flexibility",
      cognitiveSkill: "Hypothesis Testing & Cognitive Shifting",
      observedPattern: `As cognitive puzzles transitioned between different problem-solving criteria, performance varied slightly between single-attribute sorting and multi-attribute rule switches.`,
      performanceEvidence: `Observed across interactive transition stages where sorting rules shifted dynamically between visual features.`,
      recommendedApproach: `Play playful family sorting games with 'surprise rule switches' using building blocks, laundry socks, or card decks to practice smooth cognitive shifting.`,
    });
  }

  // 5. PERSONALIZED HOME ACTIVITIES (4 to 6 rich, practical, screen-free activities)
  // Activity Catalog tailored to OrionKids cognitive domains
  const activityCatalog: Record<string, HomeActivityItem> = {
    "rule-discovery": {
      title: "Surprise Rule Switching",
      skillsPracticed: [
        "Cognitive Flexibility",
        "Hypothesis Testing",
        "Visual Classification",
      ],
      materials: [
        "10–15 household objects with diverse colors and sizes (e.g., building blocks, buttons, or toy cars)",
        "2 shallow bowls or sorting trays",
      ],
      instructions: [
        "Place the assorted objects in a central pile and set out the two sorting bowls.",
        "Silently choose a sorting rule (e.g., 'sort by color: red in bowl A, blue in bowl B') and demonstrate two correct placements.",
        "Invite your child to sort the next object, giving gentle warm feedback: 'Yes, that fits my secret rule!' or 'Good guess, try the other bowl.'",
        "Once your child discovers the rule and sorts 4 items correctly, announce: 'Surprise Rule Switch!'",
        "Without explaining the new rule, switch to sorting by size (big vs. small) and let the child test new hypotheses.",
        "Celebrate the child's flexible thinking when they catch on to the new rule.",
      ],
      suggestedDuration: "10–15 minutes, adjusted to child's interest",
      difficultyProgression:
        "Begin with simple color sorting; progress to size, then shape, and finally combine attributes (e.g., 'red AND round').",
      learningOpportunity:
        "Provides an enjoyable opportunity to practice cognitive shifting, letting go of outdated rules, and adapting to new instructions.",
      parentTip:
        "Keep the tone playful and conspiratorial. Praise curiosity and creative guessing: 'I love how quickly you noticed my rule changed!'",
      description:
        "Playful sorting game where secret classification rules shift from color to size, exercising cognitive flexibility and hypothesis testing.",
      activityType: "Hands-on Play",
    },
    "card-flip": {
      title: "Memory Card Pairs & Position Recall",
      skillsPracticed: [
        "Visual Working Memory",
        "Spatial Pair Association",
        "Focused Attention",
      ],
      materials: [
        "6 to 10 matching pairs of playing cards, picture cards, or homemade drawing cards",
        "Flat table or floor space",
      ],
      instructions: [
        "Shuffle the cards and lay them face-down in a neat grid (e.g., 3 rows by 4 columns).",
        "Take turns flipping over two cards at a time, searching for an identical match.",
        "Encourage your child to describe the cards aloud: 'I found a blue circle in the top-left corner!'",
        "If the cards do not match, turn them back face-down in the exact same spot.",
        "When a match is found, keep the pair and take another turn.",
        "Continue until all matching pairs have been discovered.",
      ],
      suggestedDuration: "10–12 minutes per round",
      difficultyProgression:
        "Start with 4 pairs (8 cards total). As your child succeeds, add 2 pairs at a time up to 10 pairs (20 cards).",
      learningOpportunity:
        "Builds mental mapping of spatial positions and strengthens short-term visual memory retention.",
      parentTip:
        "Encourage your child to use spatial landmark words like 'top row', 'middle', and 'corner' to anchor their memory.",
      description:
        "Classic memory match game using picture cards in a grid, strengthening spatial location recall and short-term working memory.",
      activityType: "Family Board Game",
    },
    "story-sequencing": {
      title: "Story Detective & Sequence Mapping",
      skillsPracticed: [
        "Temporal & Narrative Sequencing",
        "Causal Reasoning",
        "Verbal Storytelling",
      ],
      materials: [
        "A favorite picture book or 4–5 illustrated index cards showing a daily routine",
        "Paper and colored markers",
      ],
      instructions: [
        "Read a short story together or discuss a familiar routine (e.g., baking a cake or getting ready for school).",
        "Pause and draw 3 to 4 simple scene sketches representing: Beginning, Middle, and End.",
        "Shuffle the sketches and hand them to your child out of order.",
        "Ask your child to be the 'Story Detective' and arrange the cards in chronological order from first to last.",
        "Invite your child to retell the story using time transition words: 'First...', 'Then...', 'After that...', 'Finally...'.",
      ],
      suggestedDuration: "15 minutes, ideal before bedtime",
      difficultyProgression:
        "Start with 3 clear steps (e.g., wake up, brush teeth, eat breakfast); expand to 5 or 6 multi-step scenes with subtle cause-and-effect.",
      learningOpportunity:
        "Develops narrative comprehension, chronological logic, and understanding of cause-and-effect relationships.",
      parentTip:
        "Praise logical explanations even if the child's sequence differs slightly from the book: 'That order makes sense too because...'",
      description:
        "Interactive storytelling activity mapping beginning, middle, and end scenes to strengthen logical timeline reconstruction.",
      activityType: "Bedtime Story Game",
    },
    "odd-one-out": {
      title: "Visual Difference Detective",
      skillsPracticed: [
        "Visual Feature Acuity",
        "Invariant Feature Discrimination",
        "Categorization",
      ],
      materials: [
        "Sets of 4 everyday household items (e.g., 3 metal spoons and 1 wooden stick; 3 red blocks and 1 orange block)",
        "Tray or table surface",
      ],
      instructions: [
        "Place 4 items on the tray where 3 share a clear common feature and 1 differs in a subtle way.",
        "Ask your child: 'Can you find the detective clue? Which one belongs to a different family and why?'",
        "Listen to the child's reasoning. Encourage them to point out specific attributes like material, shape, texture, or use.",
        "Switch roles: let your child create a mystery set for you to solve!",
        "Repeat for 4 to 5 quick, enjoyable rounds.",
      ],
      suggestedDuration: "10 minutes",
      difficultyProgression:
        "Begin with obvious differences (e.g., color); progress to function, texture, orientation, or subtle geometric properties.",
      learningOpportunity:
        "Sharpens observation of fine visual details, feature classification, and comparative reasoning.",
      parentTip:
        "Celebrate any valid justification your child provides—often children spot creative differences parents hadn't noticed!",
      description:
        "Fun detective game comparing sets of household objects to identify subtle visual and functional differences.",
      activityType: "Everyday Play",
    },
    "pattern": {
      title: "Pattern Builder & Rhythm Extrapolation",
      skillsPracticed: [
        "Pattern Induction & Rule Abstraction",
        "Sequential Prediction",
        "Mathematical Thinking",
      ],
      materials: [
        "Colored beads, pasta shapes, Lego bricks, or coins",
        "String or clean flat surface",
      ],
      instructions: [
        "Create a repeating pattern sequence using two attributes (e.g., Red-Blue-Red-Blue or Coin-Button-Coin-Button).",
        "Chant the pattern aloud with rhythm: 'Red! Blue! Red! Blue! What comes next?'",
        "Have your child place the next two items in the sequence.",
        "Introduce a more complex three-part rhythm: 'A-B-B-A-B-B' (e.g., Big-Small-Small-Big-Small-Small).",
        "Invite your child to invent their own secret pattern and challenge you to extend it.",
      ],
      suggestedDuration: "12–15 minutes",
      difficultyProgression:
        "Graduate from simple ABAB patterns to ABCABC, AABBAABB, and growing patterns (1 dot, 2 dots, 3 dots).",
      learningOpportunity:
        "Builds early algebraic thinking, relational reasoning, and confidence in mathematical structure.",
      parentTip:
        "Combine visual building with musical clapping or stomping to reinforce the sequential pattern through multiple senses.",
      description:
        "Hands-on building and rhythm challenge predicting what comes next in repeating shape and color sequences.",
      activityType: "Creative Play",
    },
    "stroop": {
      title: "Simon Says Focus & Opposite Actions",
      skillsPracticed: [
        "Focus & Interference Resistance",
        "Impulse Control",
        "Selective Attention",
      ],
      materials: ["No materials needed—just open space for movement"],
      instructions: [
        "Explain the rule: when you call out an action (e.g., 'Touch your toes!'), the child must perform it ONLY if preceded by 'Simon Says'.",
        "Once familiar, introduce the 'Opposite Rule': when Simon says 'Stand Up', the child must squat down! When Simon says 'Look Left', look right!",
        "Start slowly, demonstrating each opposite action with laughter and energy.",
        "Gradually speed up your verbal prompts to exercise rapid cognitive filtering under pressure.",
        "Let your child become 'Simon' and try to catch you in an impulse error!",
      ],
      suggestedDuration: "10 minutes of active physical fun",
      difficultyProgression:
        "Begin with classic Simon Says; advance to 2 opposite rules, and finally add colored visual cues (e.g., hold up green card means stop).",
      learningOpportunity:
        "Exercises the prefrontal cortex in suppressing automatic impulse responses and activating controlled focus.",
      parentTip:
        "Keep it joyful and laugh together when someone makes an impulse slip. The goal is exercising impulse control through play.",
      description:
        "Active physical game using opposite verbal commands to strengthen inhibitory control and selective attention.",
      activityType: "Active Movement",
    },
  };

  // Choose 4-6 activities prioritizing lowest scoring games first, then top strengths
  const recommendedActivityKeys: string[] = [];

  // Add lowest games first (areas for practice)
  for (let i = sortedByAcc.length - 1; i >= 0; i--) {
    const k = sortedByAcc[i]?.gameKey;
    if (k && activityCatalog[k] && !recommendedActivityKeys.includes(k)) {
      recommendedActivityKeys.push(k);
    }
  }
  // Add remaining games (to nourish strengths)
  for (const g of sortedByAcc) {
    if (g && activityCatalog[g.gameKey] && !recommendedActivityKeys.includes(g.gameKey)) {
      recommendedActivityKeys.push(g.gameKey);
    }
  }

  const parentRecommendations: HomeActivityItem[] = recommendedActivityKeys
    .slice(0, 5)
    .map((k) => activityCatalog[k]!);

  // 6. PROGRESS AND CONSISTENCY
  let progressAndConsistency = "";
  if (quest.totalLevelsCompleted >= 18) {
    progressAndConsistency = `${child.childName} completed all 18 levels across the six cognitive exploration games. Performance remained especially reliable across foundational Level 1 tasks (averaging ${quest.overallAccuracy}% across the quest), with consistent attention maintained as multi-attribute rules and distractor elements graduated in Levels 2 and 3. Response pacing demonstrated dependable self-regulation without fatigue-related accuracy drops in later games.`;
  } else {
    progressAndConsistency = `${child.childName} engaged purposefully across ${quest.totalLevelsCompleted} evaluated levels, displaying steady curiosity. Performance was strongest in initial game stages, with healthy exploratory problem-solving observed as novel rules and cognitive requirements were introduced.`;
  }

  // 7. OVERALL PERFORMANCE SUMMARY (100–150 words)
  const topDomainName = sortedByAcc[0]?.domain || "Visual Working Memory";
  const overallPerformanceSummary = `${child.childName} engaged enthusiastically throughout the OrionKids Cognitive Exploration quest, completing ${quest.totalLevelsCompleted} levels across six diverse cognitive domains with an overall accuracy of ${quest.overallAccuracy}%. Performance was highlighted by notable proficiency in ${topDomainName}, where ${child.childName} demonstrated confident problem-solving and focused attention. In the warm-up, ${child.childName} favored '${warmUp.favoriteSubject}' and approached challenges with a constructive '${warmUp.copingStrategy}' mindset. When navigating more complex multi-attribute rules in later levels, performance showed natural variation, offering wonderful opportunities for continued playful practice at home. Through screen-free sorting, memory, and storytelling routines, parents can joyfully nurture ${child.childName}'s natural curiosity and cognitive confidence.`;

  return {
    reportTitle: "OrionKids Cognitive Exploration & Gameplay Report",
    childOverview: `${child.childName} (${child.age} years old, ${child.selectedClass}${
      child.school ? `, ${child.school}` : ""
    }) engaged enthusiastically throughout the OrionKids assessment mission. During the initial warm-up, ${child.childName} shared an interest in '${
      warmUp.favoriteSubject
    }', a preference for '${warmUp.learningStyle}' learning, and a constructive '${
      warmUp.copingStrategy
    }' strategy when working through unfamiliar puzzles.`,
    questSummary: `Across 6 diverse games and 18 progressively challenging levels, ${child.childName} achieved an overall accuracy of ${quest.overallAccuracy}% across ${Math.round(quest.totalDurationMs / 60000)} minutes of active gameplay, completing ${quest.totalLevelsCompleted}/18 evaluated levels.`,
    overallPerformanceSummary: overallPerformanceSummary.trim(),
    gameWiseAnalysis,
    levelWisePerformance,
    observedStrengths,
    areasForPractice,
    progressAndConsistency: progressAndConsistency.trim(),
    parentRecommendations,
    homeActivities: parentRecommendations,
    dataLimitations:
      "This report is an educational summary of digital gameplay performance during a specific quest session. It is designed to celebrate learning strengths and offer positive home activities. It is not a clinical assessment, medical diagnosis, or psychological evaluation.",
    reportGenerationDate: new Date().toISOString(),
  };
}
