import { describe, expect, it } from "vitest";
import { ChartIndex } from "./chartIndex";
import type { ChartNote } from "./types";

describe("长谱面可见音符索引", () => {
  it("用 1,600 个音符的谱面只返回当前时间窗口", () => {
    const notes: ChartNote[] = Array.from({ length: 1_600 }, (_, index) => ({
      id: `stress-${index}`,
      time: index * 0.08,
      lane: (index % 4) as 0 | 1 | 2 | 3,
      type: "tap",
    }));
    const chartIndex = new ChartIndex(notes);
    const startedAt = performance.now();
    let maximumVisible = 0;
    for (let frame = 0; frame < 7_680; frame += 1) {
      maximumVisible = Math.max(
        maximumVisible,
        chartIndex.visible(frame / 60, 2.1).length,
      );
    }
    const elapsed = performance.now() - startedAt;
    expect(maximumVisible).toBeLessThan(35);
    expect(elapsed).toBeLessThan(1_000);
  });
});
