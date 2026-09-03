export const LANE_KEYS = ["D", "F", "J", "K"] as const;
export const DIFFICULTIES = ["easy", "normal", "hard"] as const;

export type Lane = 0 | 1 | 2 | 3;
export type DifficultyId = (typeof DIFFICULTIES)[number];
export type NoteType = "tap" | "hold";

interface BaseChartNote {
  id: string;
  time: number;
  lane: Lane;
}

export interface TapNote extends BaseChartNote {
  type: "tap";
}

export interface HoldNote extends BaseChartNote {
  type: "hold";
  duration: number;
}

export type ChartNote = TapNote | HoldNote;

export interface ChartDefinition {
  id: string;
  songId: string;
  difficulty: DifficultyId;
  level: number;
  notes: ChartNote[];
}

export interface SongDefinition {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  duration: number;
  subtitle: string;
  synthProfile: "chromatic" | "night-drive";
  accent: "cyan" | "violet";
}

export interface LoadedChart extends ChartDefinition {
  song: SongDefinition;
  noteCount: number;
  totalScoringUnits: number;
  notesByLane: [ChartNote[], ChartNote[], ChartNote[], ChartNote[]];
}

export interface ChartSummary {
  level: number;
  noteCount: number;
  tapCount: number;
  holdCount: number;
  maxScoreUnits: number;
}

export interface ChartLoadSuccess {
  ok: true;
  chart: LoadedChart;
  warnings: string[];
}

export interface ChartLoadFailure {
  ok: false;
  errors: string[];
}

export type ChartLoadResult = ChartLoadSuccess | ChartLoadFailure;

export const isHoldNote = (note: ChartNote): note is HoldNote =>
  note.type === "hold";

export function scoringUnitsForNote(note: ChartNote): number {
  return isHoldNote(note) ? 2 : 1;
}

export function summarizeChart(chart: LoadedChart): ChartSummary {
  const holdCount = chart.notes.filter(isHoldNote).length;
  return {
    level: chart.level,
    noteCount: chart.noteCount,
    tapCount: chart.noteCount - holdCount,
    holdCount,
    maxScoreUnits: chart.totalScoringUnits,
  };
}
