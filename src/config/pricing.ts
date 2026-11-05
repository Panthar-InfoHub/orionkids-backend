export interface ModelPricing {
  promptCostPerMillion: number;
  completionCostPerMillion: number;
}

export const OPENAI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o-mini": {
    promptCostPerMillion: 0.15,
    completionCostPerMillion: 0.6,
  },
  "gpt-4o-mini-2024-07-18": {
    promptCostPerMillion: 0.15,
    completionCostPerMillion: 0.6,
  },
  "gpt-4o": {
    promptCostPerMillion: 2.5,
    completionCostPerMillion: 10.0,
  },
  "gpt-4o-2024-08-06": {
    promptCostPerMillion: 2.5,
    completionCostPerMillion: 10.0,
  },
  "gpt-4o-2024-05-13": {
    promptCostPerMillion: 5.0,
    completionCostPerMillion: 15.0,
  },
};

export function estimateOpenAiCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const normalizedModel = Object.keys(OPENAI_MODEL_PRICING).find((m) =>
    model.startsWith(m)
  );
  const pricing = normalizedModel
    ? OPENAI_MODEL_PRICING[normalizedModel]
    : OPENAI_MODEL_PRICING["gpt-4o-mini"]!;

  const inputCost = (promptTokens / 1_000_000) * pricing!.promptCostPerMillion;
  const outputCost =
    (completionTokens / 1_000_000) * pricing!.completionCostPerMillion;

  return Number((inputCost + outputCost).toFixed(6));
}

