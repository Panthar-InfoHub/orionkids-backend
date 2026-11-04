export interface CanonicalGameDefinition {
  id: number;
  gameId: number;
  key: string;
  gameKey: string;
  name: string;
  title: string;
  domain: string;
  totalLevels: number;
}

export const CANONICAL_GAMES: readonly CanonicalGameDefinition[] = [
  {
    id: 1,
    gameId: 1,
    key: "stroop",
    gameKey: "stroop",
    name: "Stroop Colour-Word",
    title: "Stroop Colour-Word",
    domain: "Focus & Interference Resistance",
    totalLevels: 3,
  },
  {
    id: 2,
    gameId: 2,
    key: "card-flip",
    gameKey: "card-flip",
    name: "Card Flip Memory",
    title: "Card Flip Memory",
    domain: "Visual Working Memory",
    totalLevels: 3,
  },
  {
    id: 3,
    gameId: 3,
    key: "pattern",
    gameKey: "pattern",
    name: "Pattern Recognition",
    title: "Pattern Recognition",
    domain: "Pattern Induction & Extrapolation",
    totalLevels: 3,
  },
  {
    id: 4,
    gameId: 4,
    key: "odd-one-out",
    gameKey: "odd-one-out",
    name: "Odd One Out",
    title: "Odd One Out",
    domain: "Visual Feature Acuity",
    totalLevels: 3,
  },
  {
    id: 5,
    gameId: 5,
    key: "rule-discovery",
    gameKey: "rule-discovery",
    name: "Rule Discovery",
    title: "Rule Discovery",
    domain: "Hypothesis Testing & Flexibility",
    totalLevels: 3,
  },
  {
    id: 6,
    gameId: 6,
    key: "story-sequencing",
    gameKey: "story-sequencing",
    name: "Story Sequencing",
    title: "Story Sequencing",
    domain: "Temporal & Narrative Sequencing",
    totalLevels: 3,
  },
] as const;

export const TOTAL_GAMES = CANONICAL_GAMES.length; // 6
export const LEVELS_PER_GAME = 3;
export const TOTAL_LEVELS = TOTAL_GAMES * LEVELS_PER_GAME; // 18

export const GAME_KEY_TO_ID: Record<string, number> = Object.fromEntries(
  CANONICAL_GAMES.map((g) => [g.key, g.id])
);

export const GAME_ID_TO_KEY: Record<number, string> = Object.fromEntries(
  CANONICAL_GAMES.map((g) => [g.id, g.key])
);
