import { applyMissUnits, type GameStats } from "./scoring";

export type FinishReason = "complete" | "failed" | "abandoned";

export interface FinalizedRun {
  stats: GameStats;
  reason: FinishReason;
  shouldPersist: boolean;
}

export function finalizeRun(
  stats: GameStats,
  remainingScoringUnits: number,
  reason: FinishReason,
): FinalizedRun {
  if (reason === "abandoned") return { stats, reason, shouldPersist: false };
  return {
    stats: applyMissUnits(stats, remainingScoringUnits),
    reason,
    shouldPersist: true,
  };
}
