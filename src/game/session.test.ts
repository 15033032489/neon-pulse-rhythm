import { describe, expect, it } from "vitest";
import { createInitialStats } from "./scoring";
import { finalizeRun } from "./session";

describe("结束和放弃", () => {
  it("放弃不补 Miss 且不保存成绩", () => {
    const stats = createInitialStats();
    const result = finalizeRun(stats, 100, "abandoned");
    expect(result.stats).toBe(stats);
    expect(result.stats.counts.miss).toBe(0);
    expect(result.shouldPersist).toBe(false);
  });

  it("生命耗尽会结算剩余计分单位", () => {
    const result = finalizeRun(createInitialStats(), 3, "failed");
    expect(result.stats.counts.miss).toBe(3);
    expect(result.shouldPersist).toBe(true);
  });
});
