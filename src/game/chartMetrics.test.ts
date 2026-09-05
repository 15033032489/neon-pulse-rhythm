import { describe, expect, it } from "vitest";
import { loadBuiltInChart } from "../charts";
import { summarizeChart } from "./types";

describe("谱面自动指标", () => {
  it("从谱面计算密度、双押、换手、同轨和 Hold 内输入", () => {
    const result = loadBuiltInChart("beethoven-5-op67", "normal");
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const metrics = summarizeChart(result.chart);
    expect(metrics.noteCount).toBe(result.chart.notes.length);
    expect(metrics.tapCount + metrics.holdCount).toBe(metrics.noteCount);
    expect(metrics.averageNps).toBeCloseTo(metrics.noteCount / 72, 5);
    expect(metrics.peakNps).toBeGreaterThan(0);
    expect(metrics.chordRatio).toBeGreaterThanOrEqual(0);
    expect(metrics.chordRatio).toBeLessThanOrEqual(1);
    expect(metrics.longestAlternation).toBeGreaterThan(0);
    expect(metrics.maxSameLaneRun).toBeGreaterThan(0);
    expect(metrics.notesDuringHolds).toBeGreaterThanOrEqual(0);
  });
});
