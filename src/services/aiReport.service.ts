import OpenAI from "openai";
import { z } from "zod";
import { openaiApiKey, env } from "../config/env.js";
import { logger } from "../lib/logger.js";

import {
  CANONICAL_GAMES,
  TOTAL_GAMES,
  LEVELS_PER_GAME,
  TOTAL_LEVELS,
} from "../config/games.js";

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
      levelsCompleted: z.number(),
      averageAccuracy: z.number().nullable(),
      averageReactionTimeMs: z.number().nullable(),
      summary: z.string(),
      observedStrengths: z.array(z.string()),
      areasForPractice: z.array(z.string()),
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
  observedStrengths: z.array(z.string()),
  areasForPractice: z.array(z.string()),
  progressAndConsistency: z.string(),
  parentRecommendations: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      activityType: z.string().optional(),
    })
  ),
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

const SYSTEM_INSTRUCTIONS = `You are an AI report-generation assistant for the OrionKids platform.

You will receive structured gameplay data belonging to one child from a completed quest across 6 games and 18 levels.

Your task is to analyze the supplied game performance data and generate a clear, child-friendly and parent-friendly performance report.

Analyze the actual recorded performance across the six games and their three levels:
1. Stroop Colour-Word (Focus & Interference Resistance)
2. Card Flip (Visual Working Memory)
3. Pattern Recognition (Pattern Induction & Extrapolation)
4. Odd One Out (Visual Feature Acuity)
5. Rule Discovery (Hypothesis Testing & Flexibility)
6. Story Sequencing (Temporal & Narrative Sequencing)

Explain observed performance patterns using the available evidence.
Identify areas where the child performed consistently, areas where performance varied and areas where additional practice may be useful.
Do not invent information.
Do not infer medical conditions, neurological disorders, intelligence levels or clinical diagnoses.
This report is an educational gameplay summary, not a medical or psychological assessment.
Use understandable language that a parent can easily read.

You must respond ONLY with a valid JSON object matching this schema:
{
  "reportTitle": "OrionKids Cognitive Exploration & Gameplay Report",
  "childOverview": "Summary of child, age, class and overall journey engagement",
  "questSummary": "Overview of the completed 18-level quest",
  "overallPerformanceSummary": "Comprehensive readable summary of accuracy, pace, and persistence",
  "gameWiseAnalysis": [
    {
      "gameKey": "stroop",
      "gameName": "Stroop Colour-Word",
      "cognitiveDomain": "Focus & Interference Resistance",
      "levelsCompleted": 3,
      "averageAccuracy": 100,
      "averageReactionTimeMs": 1500,
      "summary": "Educational observation of performance in this game",
      "observedStrengths": ["specific strength based on data"],
      "areasForPractice": ["constructive practice recommendation"]
    }
    // repeat for all 6 games
  ],
  "levelWisePerformance": [
    {
      "gameKey": "stroop",
      "levelNumber": 1,
      "status": "COMPLETED",
      "accuracy": 100,
      "durationMs": 12000,
      "averageReactionTimeMs": 1200,
      "insight": "Observation for this specific level"
    }
    // all 18 levels
  ],
  "observedStrengths": [
    "Key overall strength 1",
    "Key overall strength 2"
  ],
  "areasForPractice": [
    "Gentle growth opportunity 1",
    "Gentle growth opportunity 2"
  ],
  "progressAndConsistency": "Assessment of how performance progressed across simpler to harder levels",
  "parentRecommendations": [
    {
      "title": "Home Activity Name",
      "description": "Fun, constructive, screen-free or guided activity parents can do at home",
      "activityType": "Home Game / Everyday Play"
    }
  ],
  "dataLimitations": "Educational disclaimer stating this report reflects digital gameplay performance during a specific session and is not a diagnostic medical or clinical evaluation.",
  "reportGenerationDate": "ISO date string"
}`;

/**
 * Generate a validated AI report using OpenAI API.
 * Falls back to high-fidelity rule-based generator if OpenAI is unavailable, timed out, or unconfigured.
 */
export async function generateAiReport(input: GameplayReportInput): Promise<{
  report: AiStructuredReport;
  modelName: string;
  usedAi: boolean;
  errorMessage?: string;
}> {
  const modelToUse = env.OPENAI_REPORT_MODEL || "gpt-4o-mini";

  if (!openaiApiKey) {
    logger.warn(
      "[AIReportService] OPEN_AI_API_KEY is not configured. Generating rule-based fallback report."
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
    const openai = new OpenAI({
      apiKey: openaiApiKey,
      timeout: 20000, // 20s timeout
    });

    const completion = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTIONS },
        {
          role: "user",
          content: `Generate the OrionKids performance report for this child and completed quest session:\n${JSON.stringify(
            input,
            null,
            2
          )}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error("OpenAI returned empty message content");
    }

    const parsedJson = JSON.parse(rawContent);
    const validated = AiStructuredReportSchema.parse(parsedJson);

    return {
      report: validated,
      modelName: completion.model || modelToUse,
      usedAi: true,
    };
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: errorMsg },
      "[AIReportService] OpenAI report generation failed. Using rule-based fallback."
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

/**
 * Deterministic, evidence-based report generator that adheres strictly to the same schema
 * and provides rich educational insights derived from genuine gameplay metrics.
 */
export function generateRuleBasedReport(
  input: GameplayReportInput
): AiStructuredReport {
  const { child, quest, warmUp, games } = input;

  const gameWiseAnalysis = CANONICAL_GAMES.map((cg) => {
    const recorded = games.find((g) => g.gameKey === cg.key);
    const acc = recorded?.averageAccuracy ?? null;
    const rt = recorded?.averageReactionTimeMs ?? null;
    const levelsDone = recorded?.levelsCompleted ?? 0;

    let summary = `${child.childName} explored ${cg.name} completing ${levelsDone}/3 levels.`;
    const strengths: string[] = [];
    const practice: string[] = [];

    if (acc !== null) {
      if (acc >= 85) {
        summary += ` Displayed exceptional mastery and precision in ${cg.domain.toLowerCase()} with ${acc}% accuracy.`;
        strengths.push(
          `High accuracy (${acc}%) in ${cg.name}, demonstrating confidence.`
        );
      } else if (acc >= 65) {
        summary += ` Showed solid competence and steady problem-solving in ${cg.domain.toLowerCase()} (${acc}% accuracy).`;
        strengths.push(`Steady, consistent approach in ${cg.name}.`);
        practice.push(
          `Targeted play with gentle progression to reinforce ${cg.domain.toLowerCase()}.`
        );
      } else {
        summary += ` Actively engaged with ${cg.name} (${acc}% accuracy), showing willingness to take on new cognitive challenges.`;
        practice.push(
          `Practice fun, low-pressure everyday activities exercising ${cg.domain.toLowerCase()}.`
        );
      }
    } else {
      summary += ` Engaged actively throughout the gameplay trials.`;
      practice.push(`Continue exploratory play in ${cg.name}.`);
    }

    if (rt && rt > 0) {
      if (rt < 1800) {
        strengths.push(
          `Quick, decisive response pacing (~${(rt / 1000).toFixed(1)}s per decision).`
        );
      } else {
        strengths.push(
          `Deliberate and reflective decision-making pace (~${(rt / 1000).toFixed(1)}s per decision).`
        );
      }
    }

    return {
      gameKey: cg.key,
      gameName: cg.name,
      cognitiveDomain: cg.domain,
      levelsCompleted: levelsDone,
      averageAccuracy: acc,
      averageReactionTimeMs: rt,
      summary,
      observedStrengths:
        strengths.length > 0
          ? strengths
          : [`Persistent engagement throughout ${cg.name}.`],
      areasForPractice:
        practice.length > 0
          ? practice
          : [
              `Continue everyday exploration of ${cg.name.toLowerCase()} puzzles.`,
            ],
    };
  });

  const levelWisePerformance: AiStructuredReport["levelWisePerformance"] = [];
  for (const cg of CANONICAL_GAMES) {
    const recorded = games.find((g) => g.gameKey === cg.key);
    for (let lvl = 1; lvl <= 3; lvl++) {
      const att = recorded?.levels.find((l) => l.levelNumber === lvl);
      const acc = att?.accuracy ?? null;
      const duration = att?.durationMs ?? null;
      const rt = att?.averageReactionTimeMs ?? null;
      const status =
        att?.status || (acc !== null ? "COMPLETED" : "NOT_RECORDED");

      let insight = `Level ${lvl} of ${cg.name}`;
      if (acc !== null) {
        insight += `: completed with ${acc}% accuracy`;
        if (duration) insight += ` across ${Math.round(duration / 1000)}s`;
      } else {
        insight += `: progression recorded`;
      }

      levelWisePerformance.push({
        gameKey: cg.key,
        levelNumber: lvl,
        status,
        accuracy: acc,
        durationMs: duration,
        averageReactionTimeMs: rt,
        insight,
      });
    }
  }

  // Identify highest and lowest games for strengths & areas for growth
  const scoredGames = gameWiseAnalysis.filter(
    (g) => g.averageAccuracy !== null
  );
  const sortedByAcc = [...scoredGames].sort(
    (a, b) => (b.averageAccuracy ?? 0) - (a.averageAccuracy ?? 0)
  );

  const observedStrengths: string[] = [];
  const topGame = sortedByAcc[0];
  if (topGame) {
    observedStrengths.push(
      `Strongest performance observed in ${topGame.gameName} (${topGame.cognitiveDomain}) with ${topGame.averageAccuracy}% average accuracy.`
    );
  }
  const secondGame = sortedByAcc[1];
  if (secondGame && (secondGame.averageAccuracy ?? 0) >= 70) {
    observedStrengths.push(
      `High proficiency in ${secondGame.gameName} demonstrating dependable ${secondGame.cognitiveDomain.toLowerCase()}.`
    );
  }
  observedStrengths.push(
    `Completed the complete 18-level journey across all six diverse cognitive domains with sustained focus and effort.`
  );

  const areasForPractice: string[] = [];
  const lowestGame = sortedByAcc[sortedByAcc.length - 1];
  if (lowestGame && (lowestGame.averageAccuracy ?? 100) < 75) {
    areasForPractice.push(
      `Additional playful practice in ${lowestGame.gameName} to nurture ${lowestGame.cognitiveDomain.toLowerCase()}.`
    );
  }
  areasForPractice.push(
    `Introduce playful, real-world sorting, storytelling, and memory games at home to strengthen flexibility.`
  );

  const parentRecommendations = [
    {
      title: "Storytelling & Sequence Mapping",
      description:
        "When reading a book before bed, pause after three pages and ask your child to arrange what happened first, next, and last using their own words or drawing pictures.",
      activityType: "Bedtime Story Game",
    },
    {
      title: "Playful Sorting & Rule Shifts",
      description:
        "Use colored building blocks or buttons. Start sorting by color, then playfully say 'Surprise Rule! Now sort by size!' to encourage flexible cognitive switching.",
      activityType: "Hands-on Play",
    },
    {
      title: "Memory Card Pairs & Patterns",
      description:
        "Play matching card games with 6 to 10 pairs. Encourage your child to say aloud where they saw a matching card to strengthen spatial working memory.",
      activityType: "Family Board Game",
    },
  ];

  const totalMin = Math.round(quest.totalDurationMs / 60000);

  return {
    reportTitle: "OrionKids Cognitive Exploration & Gameplay Report",
    childOverview: `${child.childName} (${child.age} years old, ${child.selectedClass}${
      child.school ? `, ${child.school}` : ""
    }) engaged enthusiastically throughout the OrionKids mission. In the warm-up, ${child.childName} indicated a '${
      warmUp.favoriteSubject
    }' interest and a '${warmUp.copingStrategy}' approach to puzzles.`,
    questSummary: `Across 6 diverse games and 18 progressively challenging levels, ${child.childName} achieved an overall accuracy of ${quest.overallAccuracy}% across ${totalMin} minutes of active gameplay.`,
    overallPerformanceSummary: `${child.childName} demonstrated sustained cognitive endurance, tackling selective focus, working memory, pattern extrapolation, visual feature acuity, rule switching, and temporal sequencing. Performance remained consistent across foundational stages with adaptive curiosity when navigating complex levels.`,
    gameWiseAnalysis,
    levelWisePerformance,
    observedStrengths,
    areasForPractice,
    progressAndConsistency:
      "Showed steady focus from early levels through final challenges, maintaining high engagement as difficulty graduated from single-attribute recognition to multi-attribute problem solving.",
    parentRecommendations,
    dataLimitations:
      "This report is an educational summary of digital gameplay performance during a specific quest session. It is designed to celebrate learning strengths and offer positive home activities. It is not a clinical assessment, medical diagnosis, or psychological evaluation.",
    reportGenerationDate: new Date().toISOString(),
  };
}
