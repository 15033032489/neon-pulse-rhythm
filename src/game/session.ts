import {
  applyRemainingMisses,
  calculateNormalizedScore,
  type GameStats,
} from "./scoring";
import type { DifficultyId, LoadedChart } from "./types";

export type FinishReason = "complete" | "failed" | "abandoned";
export type PlayMode = "standard" | "practice";

export interface RunSession {
  songId: string;
  songTitle: string;
  songEnglishTitle?: string;
  difficulty: DifficultyId;
  chart: LoadedChart;
  noteCount: number;
  maxScoreUnits: number;
  mode: PlayMode;
  audioVersion?: string;
  audioOffsetMs?: number;
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

export function createRunSession(
  chart: LoadedChart,
  mode: PlayMode = "standard",
  audioVersion?: string,
  audioOffsetMs?: number,
): RunSession {
  return Object.freeze({
    songId: chart.song.id,
    songTitle: chart.song.title,
    songEnglishTitle: chart.song.englishTitle,
    difficulty: chart.difficulty,
    chart,
    noteCount: chart.noteCount,
    maxScoreUnits: chart.totalScoringUnits,
    mode,
    audioVersion,
    audioOffsetMs,
  });
}

export const shouldFailRun = (life: number, mode: PlayMode): boolean =>
  mode === "standard" && life <= 0;

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

export function shouldPersistRun(
  session: RunSession,
  finalized: FinalizedRun,
): boolean {
  return session.mode === "standard" && finalized.shouldPersist;
}
