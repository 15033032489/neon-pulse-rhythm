import {
  applyRemainingMisses,
  calculateNormalizedScore,
  type GameStats,
} from "./scoring";
import type { DifficultyId, LoadedChart } from "./types";

export type FinishReason = "complete" | "failed" | "abandoned";

export interface RunSession {
  songId: string;
  songTitle: string;
  difficulty: DifficultyId;
  chart: LoadedChart;
  noteCount: number;
  maxScoreUnits: number;
}

export interface RemainingRunWork {
  noteCount: number;
  scoreUnits: number;
}

export interface FinalizedRun {
  stats: GameStats;
  reason: FinishReason;
  shouldPersist: boolean;
}

export function createRunSession(chart: LoadedChart): RunSession {
  return Object.freeze({
    songId: chart.song.id,
    songTitle: chart.song.title,
    difficulty: chart.difficulty,
    chart,
    noteCount: chart.noteCount,
    maxScoreUnits: chart.totalScoringUnits,
  });
}

export function calculateSessionScore(
  stats: GameStats,
  session: RunSession,
): number {
  return calculateNormalizedScore(stats, session.maxScoreUnits);
}

export function finalizeRun(
  stats: GameStats,
  remaining: RemainingRunWork,
  reason: FinishReason,
): FinalizedRun {
  if (reason === "abandoned") return { stats, reason, shouldPersist: false };
  return {
    stats: applyRemainingMisses(
      stats,
      remaining.noteCount,
      remaining.scoreUnits,
    ),
    reason,
    shouldPersist: true,
  };
}
