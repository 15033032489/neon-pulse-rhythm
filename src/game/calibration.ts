import { SETTINGS_LIMITS } from "./settings";

export interface CalibrationSample {
  beatIndex: number;
  deviationMs: number;
}

export interface CalibrationResult {
  ok: boolean;
  recommendedOffsetMs: number;
  acceptedSamples: number[];
  ignoredCount: number;
  medianDeviationMs: number;
  message: string;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function analyzeCalibration(
  samples: CalibrationSample[],
): CalibrationResult {
  const candidates = samples
    .filter((sample) => sample.beatIndex >= 4)
    .map((sample) => sample.deviationMs)
    .filter((value) => Number.isFinite(value) && Math.abs(value) <= 180);

  if (candidates.length < 8) {
    return {
      ok: false,
      recommendedOffsetMs: 0,
      acceptedSamples: candidates,
      ignoredCount: samples.length - candidates.length,
      medianDeviationMs: median(candidates),
      message: `有效点击不足（${candidates.length}/8），请重新校准。`,
    };
  }

  const center = median(candidates);
  const absoluteDeviations = candidates.map((value) =>
    Math.abs(value - center),
  );
  const mad = median(absoluteDeviations);
  const threshold = Math.max(18, mad * 3.5);
  const accepted = candidates.filter(
    (value) => Math.abs(value - center) <= threshold,
  );
  const robustCenter = median(accepted);
  const clamped = Math.min(
    SETTINGS_LIMITS.audioOffsetMs.maximum,
    Math.max(SETTINGS_LIMITS.audioOffsetMs.minimum, robustCenter),
  );
  const recommendedOffsetMs = Math.round(clamped / 5) * 5;

  return {
    ok: accepted.length >= 8,
    recommendedOffsetMs,
    acceptedSamples: accepted,
    ignoredCount: samples.length - accepted.length,
    medianDeviationMs: robustCenter,
    message:
      accepted.length >= 8
        ? `建议偏移 ${recommendedOffsetMs >= 0 ? "+" : ""}${recommendedOffsetMs} ms。`
        : "稳定样本不足，请重新校准。",
  };
}

export { median };
