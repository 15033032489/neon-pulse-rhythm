import { describe, expect, it } from "vitest";
import { loadBuiltInChart } from "../charts";
import { applyJudgement, createInitialStats } from "./scoring";
import {
  calculateSessionScore,
  createRunSession,
  finalizeRun,
} from "./session";

describe("结束和放弃", () => {
  it("放弃不补 Miss 且不保存成绩", () => {
    const stats = createInitialStats();
    const result = finalizeRun(
      stats,
      { noteCount: 90, scoreUnits: 100 },
      "abandoned",
    );
    expect(result.stats).toBe(stats);
    expect(result.stats.counts.miss).toBe(0);
    expect(result.shouldPersist).toBe(false);
  });

  it("Normal 局会话快照不会被菜单切换到 Easy 污染", () => {
    const normal = loadBuiltInChart("chromatic-run", "normal");
    const easy = loadBuiltInChart("chromatic-run", "easy");
    if (!normal.ok || !easy.ok) throw new Error("测试谱面加载失败");
    const session = createRunSession(normal.chart);
    const stats = applyJudgement(createInitialStats(), "perfect");
    const beforeSwitch = calculateSessionScore(stats, session);
    const menuChartAfterSwitch = easy.chart;
    expect(menuChartAfterSwitch.totalScoringUnits).not.toBe(
      session.maxScoreUnits,
    );
    expect(calculateSessionScore(stats, session)).toBe(beforeSwitch);
    expect(session).toMatchObject({
      songId: "chromatic-run",
      difficulty: "normal",
      noteCount: 96,
    });
  });

  it("生命耗尽按剩余音符数补 Miss，不把 Hold 尾部算作第二次判定", () => {
    const result = finalizeRun(
      createInitialStats(),
      { noteCount: 2, scoreUnits: 3 },
      "failed",
    );
    expect(result.stats.counts.miss).toBe(2);
    expect(result.stats.judgedNotes).toBe(2);
    expect(result.stats.processedScoreUnits).toBe(3);
    expect(result.shouldPersist).toBe(true);
  });
});
