import { describe, expect, it } from "vitest";
import {
  deriveProductDisplayState,
  formatClockTime,
  type ProductPhase,
} from "./displayState";

describe("产品展示状态", () => {
  it.each([
    ["idle", false, "waiting", "selection", false],
    ["idle", true, "last-result", "selection", false],
    ["starting", false, "live", "live", true],
    ["countdown", false, "live", "live", true],
    ["playing", false, "live", "live", true],
    ["pausing", false, "live", "live", true],
    ["paused", false, "live", "live", true],
    ["resuming", false, "live", "live", true],
    ["results", false, "last-result", "result", false],
  ] as const)(
    "%s 阶段使用正确的数据语义",
    (phase, hasLast, statsPanel, stageHud, showRuntimeMetrics) => {
      expect(deriveProductDisplayState(phase as ProductPhase, hasLast)).toEqual(
        { statsPanel, stageHud, showRuntimeMetrics },
      );
    },
  );

  it("待机曲长使用真实歌曲时长而不是虚假的 0:00", () => {
    expect(formatClockTime(52)).toBe("0:52");
    expect(formatClockTime(Number.NaN)).toBe("0:00");
  });
});
