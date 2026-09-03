import { describe, expect, it } from "vitest";
import { DEMO_SONG } from "../songs/catalog";
import { loadBuiltInChart } from ".";
import { parseChart } from "./parseChart";

describe("谱面解析和校验", () => {
  it.each([
    ["chromatic-run", "easy", 44],
    ["chromatic-run", "normal", 96],
    ["chromatic-run", "hard", 148],
    ["midnight-arcade", "easy", 40],
    ["midnight-arcade", "normal", 80],
    ["midnight-arcade", "hard", 108],
  ] as const)(
    "加载、排序并索引 %s %s 谱面",
    (songId, difficulty, noteCount) => {
      const result = loadBuiltInChart(songId, difficulty);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.chart.notes).toHaveLength(noteCount);
      expect(result.chart.noteCount).toBe(noteCount);
      expect(result.chart.notes.some((note) => note.type === "hold")).toBe(
        true,
      );
      expect(result.chart.totalScoringUnits).toBeGreaterThan(noteCount);
      expect(result.chart.notesByLane.flat()).toHaveLength(noteCount);
    },
  );

  it("自动排序并给出提示", () => {
    const result = parseChart(
      {
        id: "unsorted",
        songId: DEMO_SONG.id,
        difficulty: "easy",
        level: 1,
        notes: [
          { id: "b", time: 2, lane: 1, type: "tap" },
          { id: "a", time: 1, lane: 0, type: "tap" },
        ],
      },
      DEMO_SONG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chart.notes.map((note) => note.id)).toEqual(["a", "b"]);
    expect(result.warnings).toContain("音符未按时间排序，已在加载时自动排序。");
  });

  it("拒绝重复 id、非法轨道、错误 Hold 和重叠", () => {
    const result = parseChart(
      {
        id: "bad",
        songId: DEMO_SONG.id,
        difficulty: "normal",
        level: 6,
        notes: [
          { id: "same", time: 1, lane: 0, type: "hold", duration: 1 },
          { id: "same", time: 1.5, lane: 0, type: "tap" },
          { id: "lane", time: 2, lane: 8, type: "tap" },
          { id: "duration", time: 3, lane: 2, type: "hold", duration: 0 },
        ],
      },
      DEMO_SONG,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toMatch(/重复/);
    expect(result.errors.join("\n")).toMatch(/lane/);
    expect(result.errors.join("\n")).toMatch(/duration/);
    expect(result.errors.join("\n")).toMatch(/重叠/);
  });
});
