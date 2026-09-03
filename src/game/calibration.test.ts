import { describe, expect, it } from "vitest";
import { analyzeCalibration } from "./calibration";

describe("自动延迟校准", () => {
  it("忽略四个预热拍和明显异常值，用稳健中位数给出 5ms 精度建议", () => {
    const deviations = [
      500, -500, 90, -90, 31, 29, 32, 30, 28, 34, 27, 33, 170, 30, 31, 29,
    ];
    const result = analyzeCalibration(
      deviations.map((deviationMs, beatIndex) => ({ beatIndex, deviationMs })),
    );
    expect(result.ok).toBe(true);
    expect(result.recommendedOffsetMs).toBe(30);
    expect(result.ignoredCount).toBeGreaterThanOrEqual(4);
  });

  it("有效点击不足时要求重试", () => {
    const result = analyzeCalibration(
      Array.from({ length: 9 }, (_, beatIndex) => ({
        beatIndex,
        deviationMs: 20,
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/不足/);
  });
});
