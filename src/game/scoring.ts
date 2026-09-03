export type Judgement = "perfect" | "great" | "good" | "miss";
export type HitJudgement = Exclude<Judgement, "miss">;
export type Grade = "S" | "A" | "B" | "C" | "D";

export interface JudgementCounts {
  perfect: number;
  great: number;
  good: number;
  miss: number;
}

export interface GameStats {
  rawScore: number;
  combo: number;
  maxCombo: number;
  judgedUnits: number;
  accuracyUnits: number;
  life: number;
  counts: JudgementCounts;
  holdCompleted: number;
  holdBroken: number;
  timingOffsetsMs: number[];
}

export interface TimingSummary {
  early: number;
  late: number;
  onTime: number;
  averageSignedMs: number;
  averageAbsoluteMs: number;
  histogram: Array<{ label: string; count: number }>;
}

export interface RunFlags {
  fc: boolean;
  ap: boolean;
}

export const RULESET = {
  windowsMs: {
    perfect: 45,
    great: 90,
    good: 140,
    holdReleaseGrace: 90,
    holdRegrabGrace: 250,
  },
  score: {
    perfect: 1000,
    great: 700,
    good: 400,
    miss: 0,
    holdComplete: 1000,
    holdBreak: 0,
  },
  accuracyUnits: {
    perfect: 1000,
    great: 750,
    good: 400,
    miss: 0,
    holdComplete: 1000,
    holdBreak: 0,
  },
  lifeDelta: {
    perfect: 2,
    great: 1,
    good: 0,
    miss: -8,
    holdComplete: 1,
    holdBreak: -10,
  },
  maxLife: 100,
  normalizedMaximum: 1_000_000,
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function classifyHitOffset(offsetMs: number): HitJudgement | null {
  if (!Number.isFinite(offsetMs)) return null;
  const absoluteOffset = Math.abs(offsetMs);
  if (absoluteOffset <= RULESET.windowsMs.perfect) return "perfect";
  if (absoluteOffset <= RULESET.windowsMs.great) return "great";
  if (absoluteOffset <= RULESET.windowsMs.good) return "good";
  return null;
}

export function isNoteOverdue(offsetMs: number): boolean {
  return Number.isFinite(offsetMs) && offsetMs > RULESET.windowsMs.good;
}

export function createInitialStats(initialLife = RULESET.maxLife): GameStats {
  return {
    rawScore: 0,
    combo: 0,
    maxCombo: 0,
    judgedUnits: 0,
    accuracyUnits: 0,
    life: clamp(initialLife, 0, RULESET.maxLife),
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    holdCompleted: 0,
    holdBroken: 0,
    timingOffsetsMs: [],
  };
}

export function applyJudgement(
  stats: GameStats,
  judgement: Judgement,
  offsetMs?: number,
): GameStats {
  const isHit = judgement !== "miss";
  const combo = isHit ? stats.combo + 1 : 0;
  const recordOffset = isHit && Number.isFinite(offsetMs);

  return {
    ...stats,
    rawScore: stats.rawScore + RULESET.score[judgement],
    combo,
    maxCombo: Math.max(stats.maxCombo, combo),
    judgedUnits: stats.judgedUnits + 1,
    accuracyUnits: stats.accuracyUnits + RULESET.accuracyUnits[judgement],
    life: clamp(stats.life + RULESET.lifeDelta[judgement], 0, RULESET.maxLife),
    counts: {
      ...stats.counts,
      [judgement]: stats.counts[judgement] + 1,
    },
    timingOffsetsMs: recordOffset
      ? [...stats.timingOffsetsMs, offsetMs as number]
      : stats.timingOffsetsMs,
  };
}

export function applyHoldCompletion(stats: GameStats): GameStats {
  const combo = stats.combo + 1;
  return {
    ...stats,
    rawScore: stats.rawScore + RULESET.score.holdComplete,
    combo,
    maxCombo: Math.max(stats.maxCombo, combo),
    judgedUnits: stats.judgedUnits + 1,
    accuracyUnits: stats.accuracyUnits + RULESET.accuracyUnits.holdComplete,
    life: clamp(
      stats.life + RULESET.lifeDelta.holdComplete,
      0,
      RULESET.maxLife,
    ),
    holdCompleted: stats.holdCompleted + 1,
  };
}

export function applyHoldBreak(stats: GameStats): GameStats {
  return {
    ...stats,
    combo: 0,
    judgedUnits: stats.judgedUnits + 1,
    life: clamp(stats.life + RULESET.lifeDelta.holdBreak, 0, RULESET.maxLife),
    counts: { ...stats.counts, miss: stats.counts.miss + 1 },
    holdBroken: stats.holdBroken + 1,
  };
}

export function applyMissUnits(stats: GameStats, count: number): GameStats {
  let next = stats;
  for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
    next = applyJudgement(next, "miss");
  }
  return next;
}

export function calculateNormalizedScore(
  stats: GameStats,
  totalScoringUnits: number,
): number {
  if (totalScoringUnits <= 0) return 0;
  return clamp(
    Math.round(
      (stats.rawScore / (totalScoringUnits * 1000)) * RULESET.normalizedMaximum,
    ),
    0,
    RULESET.normalizedMaximum,
  );
}

export function calculateAccuracy(stats: GameStats): number {
  if (stats.judgedUnits === 0) return 100;
  return (stats.accuracyUnits / (stats.judgedUnits * 1000)) * 100;
}

export function calculateGrade(accuracy: number): Grade {
  if (accuracy >= 95) return "S";
  if (accuracy >= 90) return "A";
  if (accuracy >= 80) return "B";
  if (accuracy >= 70) return "C";
  return "D";
}

export function calculateRunFlags(
  stats: GameStats,
  totalScoringUnits: number,
): RunFlags {
  const completed = stats.judgedUnits >= totalScoringUnits;
  const fc = completed && stats.counts.miss === 0 && stats.holdBroken === 0;
  const ap =
    fc &&
    stats.counts.great === 0 &&
    stats.counts.good === 0 &&
    stats.counts.perfect + stats.holdCompleted === totalScoringUnits;
  return { fc, ap };
}

export function summarizeTiming(offsetsMs: number[]): TimingSummary {
  const finite = offsetsMs.filter(Number.isFinite);
  const sum = finite.reduce((total, value) => total + value, 0);
  const absoluteSum = finite.reduce(
    (total, value) => total + Math.abs(value),
    0,
  );
  const buckets = [
    { label: "<-90", minimum: Number.NEGATIVE_INFINITY, maximum: -90 },
    { label: "-90~-45", minimum: -90, maximum: -45 },
    { label: "-45~0", minimum: -45, maximum: 0 },
    { label: "0~45", minimum: 0, maximum: 45 },
    { label: "45~90", minimum: 45, maximum: 90 },
    { label: ">90", minimum: 90, maximum: Number.POSITIVE_INFINITY },
  ];

  return {
    early: finite.filter((value) => value < -1).length,
    late: finite.filter((value) => value > 1).length,
    onTime: finite.filter((value) => Math.abs(value) <= 1).length,
    averageSignedMs: finite.length ? sum / finite.length : 0,
    averageAbsoluteMs: finite.length ? absoluteSum / finite.length : 0,
    histogram: buckets.map((bucket, index) => ({
      label: bucket.label,
      count: finite.filter((value) =>
        index === buckets.length - 1
          ? value >= bucket.minimum
          : value >= bucket.minimum && value < bucket.maximum,
      ).length,
    })),
  };
}
