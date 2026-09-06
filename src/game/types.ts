export const LANE_KEYS = ["D", "F", "J", "K"] as const;
export const DIFFICULTIES = ["easy", "normal", "hard"] as const;

export type Lane = 0 | 1 | 2 | 3;
export type DifficultyId = (typeof DIFFICULTIES)[number];
export type NoteType = "tap" | "hold";
export type SongCategory = "original" | "classical" | "mandopop";
export type SongAudioMode = "synth" | "local-import";
export type SynthProfile =
  | "chromatic"
  | "night-drive"
  | "beethoven-5"
  | "mozart-40"
  | "new-world"
  | "ode-to-joy"
  | "local-import";

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
  description: string;
  notes: ChartNote[];
}

export interface SongDefinition {
  id: string;
  title: string;
  englishTitle?: string;
  artist: string;
  category: SongCategory;
  bpm: number;
  duration: number;
  subtitle: string;
  movement?: string;
  workNumber?: string;
  licenseLabel?: string;
  copyrightNotice?: string;
  audioMode: SongAudioMode;
  audioVersion?: string;
  expectedDuration?: number | null;
  firstBeatOffsetMs?: number | null;
  previewStart?: number | null;
  previewDuration?: number;
  tempoMap?: Array<{ time: number; bpm: number }> | null;
  chartStatus?: "ready" | "awaiting-matched-audio";
  synthProfile: SynthProfile;
  accent:
    | "cyan"
    | "violet"
    | "gold"
    | "rose"
    | "ember"
    | "azure"
    | "sunny"
    | "summer"
    | "nocturne"
    | "harvest"
    | "porcelain";
}

export const isLocalImportSong = (song: SongDefinition): boolean =>
  song.audioMode === "local-import";

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
  averageNps: number;
  peakNps: number;
  chordRatio: number;
  longestAlternation: number;
  maxSameLaneRun: number;
  notesDuringHolds: number;
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
  const timeGroups = new Map<number, ChartNote[]>();
  for (const note of chart.notes) {
    const key = Math.round(note.time * 1000);
    const group = timeGroups.get(key) ?? [];
    group.push(note);
    timeGroups.set(key, group);
  }
  const chordNotes = [...timeGroups.values()].reduce(
    (total, group) => total + (group.length > 1 ? group.length : 0),
    0,
  );
  let peakNps = 0;
  let windowStart = 0;
  for (let index = 0; index < chart.notes.length; index += 1) {
    while (chart.notes[index].time - chart.notes[windowStart].time >= 1)
      windowStart += 1;
    peakNps = Math.max(peakNps, index - windowStart + 1);
  }
  const singleNotes = [...timeGroups.values()]
    .filter((group) => group.length === 1)
    .map((group) => group[0]);
  let longestAlternation = singleNotes.length ? 1 : 0;
  let currentAlternation = longestAlternation;
  let maxSameLaneRun = singleNotes.length ? 1 : 0;
  let currentSameLaneRun = maxSameLaneRun;
  const continuationGap = (60 / chart.song.bpm) * 1.5;
  for (let index = 1; index < singleNotes.length; index += 1) {
    if (
      singleNotes[index].time - singleNotes[index - 1].time >
      continuationGap
    ) {
      currentAlternation = 1;
      currentSameLaneRun = 1;
      continue;
    }
    if (singleNotes[index].lane !== singleNotes[index - 1].lane) {
      currentAlternation += 1;
      currentSameLaneRun = 1;
    } else {
      currentAlternation = 1;
      currentSameLaneRun += 1;
    }
    longestAlternation = Math.max(longestAlternation, currentAlternation);
    maxSameLaneRun = Math.max(maxSameLaneRun, currentSameLaneRun);
  }
  const notesDuringHolds = chart.notes
    .filter(isHoldNote)
    .reduce(
      (total, hold) =>
        total +
        chart.notes.filter(
          (note) =>
            note.id !== hold.id &&
            note.lane !== hold.lane &&
            note.time > hold.time + 0.001 &&
            note.time < hold.time + hold.duration - 0.001,
        ).length,
      0,
    );
  return {
    level: chart.level,
    noteCount: chart.noteCount,
    tapCount: chart.noteCount - holdCount,
    holdCount,
    maxScoreUnits: chart.totalScoringUnits,
    averageNps: chart.noteCount / chart.song.duration,
    peakNps,
    chordRatio: chart.noteCount ? chordNotes / chart.noteCount : 0,
    longestAlternation,
    maxSameLaneRun,
    notesDuringHolds,
  };
}
