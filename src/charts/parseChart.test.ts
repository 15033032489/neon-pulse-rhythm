import { describe, expect, it } from "vitest";
import { DEMO_SONG, SONG_CATALOG } from "../songs/catalog";
import { loadBuiltInChart } from ".";
import { parseChart } from "./parseChart";

describe("谱面解析和校验", () => {
  it.each([
    ["chromatic-run", "easy", 44, 2],
    ["chromatic-run", "normal", 96, 5],
    ["chromatic-run", "hard", 148, 8],
    ["midnight-arcade", "easy", 40, 3],
    ["midnight-arcade", "normal", 80, 6],
    ["midnight-arcade", "hard", 108, 8],
  ] as const)(
    "加载、排序并索引 %s %s 谱面",
    (songId, difficulty, noteCount, holdCount) => {
      const result = loadBuiltInChart(songId, difficulty);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.chart.notes).toHaveLength(noteCount);
      expect(result.chart.noteCount).toBe(noteCount);
      expect(result.chart.description.length).toBeGreaterThan(4);
      expect(
        result.chart.notes.filter((note) => note.type === "hold"),
      ).toHaveLength(holdCount);
      expect(result.chart.totalScoringUnits).toBeGreaterThan(noteCount);
      expect(result.chart.notesByLane.flat()).toHaveLength(noteCount);
      for (const laneNotes of result.chart.notesByLane) {
        for (let index = 0; index < laneNotes.length - 1; index += 1) {
          const note = laneNotes[index];
          const next = laneNotes[index + 1];
          const end = note.time + (note.type === "hold" ? note.duration : 0);
          expect(next.time).toBeGreaterThanOrEqual(end - 0.001);
          expect(next.time === note.time).toBe(false);
        }
      }
    },
  );

  it("六张谱面拥有独立描述和非模板化 Hold 数量", () => {
    const charts = SONG_CATALOG.flatMap((song) =>
      (["easy", "normal", "hard"] as const).map((difficulty) => {
        const result = loadBuiltInChart(song.id, difficulty);
        if (!result.ok) throw new Error(result.errors.join("\n"));
        return result.chart;
      }),
    );
    expect(new Set(charts.map((chart) => chart.description)).size).toBe(6);
    expect(
      new Set(
        charts.map(
          (chart) => chart.notes.filter((note) => note.type === "hold").length,
        ),
      ).size,
    ).toBeGreaterThan(2);
  });

  it("自动排序并给出提示", () => {
    const result = parseChart(
      {
        id: "unsorted",
        songId: DEMO_SONG.id,
        difficulty: "easy",
        level: 1,
        description: "测试乱序谱面",
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
        description: "测试非法谱面",
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

  it("拒绝同轨同一时刻的重复输入", () => {
    const result = parseChart(
      {
        id: "same-lane-chord",
        songId: DEMO_SONG.id,
        difficulty: "easy",
        level: 2,
        description: "同轨双音应被拒绝",
        notes: [
          { id: "a", time: 1, lane: 2, type: "tap" },
          { id: "b", time: 1, lane: 2, type: "tap" },
        ],
      },
      DEMO_SONG,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toMatch(/同时出现/);
  });
});
