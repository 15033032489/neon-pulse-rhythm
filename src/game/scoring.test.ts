import { describe, expect, it } from "vitest";
import { loadBuiltInChart } from "../charts";
import { SONG_CATALOG } from "../songs/catalog";
import {
  applyHoldBreak,
  applyHoldCompletion,
  applyJudgement,
  calculateAccuracy,
  calculateGrade,
  calculateNormalizedScore,
  calculateRunFlags,
  classifyHitOffset,
  createInitialStats,
  judgementCount,
  isNoteOverdue,
  summarizeTiming,
  type Judgement,
} from "./scoring";

describe("判定窗口边界", () => {
  it.each([
    [0, "perfect"],
    [45, "perfect"],
    [-45, "perfect"],
    [45.001, "great"],
    [-45.001, "great"],
    [90, "great"],
    [-90, "great"],
    [90.001, "good"],
    [-90.001, "good"],
    [140, "good"],
    [-140, "good"],
    [140.001, null],
    [-140.001, null],
  ] as const)("%sms → %s", (offset, expected) => {
    expect(classifyHitOffset(offset)).toBe(expected);
  });

  it("只在 Good 窗口之后判为逾期", () => {
    expect(isNoteOverdue(140)).toBe(false);
    expect(isNoteOverdue(140.001)).toBe(true);
    expect(isNoteOverdue(-500)).toBe(false);
    expect(classifyHitOffset(Number.NaN)).toBeNull();
  });
});

describe("计分、连击和准确率", () => {
  it.each([
    ["perfect", 1000],
    ["great", 700],
    ["good", 400],
    ["miss", 0],
  ] as const)("正确应用 %s", (judgement, rawScore) => {
    const before = createInitialStats();
    const after = applyJudgement(before, judgement, 12);
    expect(after.rawScore).toBe(rawScore);
    expect(after.counts[judgement]).toBe(1);
    expect(before).toEqual(createInitialStats());
  });

  it("Miss 和 Hold 中断会清空当前连击但保留最高连击", () => {
    let stats = createInitialStats();
    for (const judgement of ["perfect", "great", "good"] as Judgement[]) {
      stats = applyJudgement(stats, judgement);
    }
    expect(stats).toMatchObject({ combo: 3, maxCombo: 3 });
    stats = applyJudgement(stats, "miss");
    expect(stats).toMatchObject({ combo: 0, maxCombo: 3 });
    stats = applyHoldBreak(applyJudgement(stats, "perfect"));
    expect(stats).toMatchObject({ combo: 0, maxCombo: 3, holdBroken: 1 });
  });

  it("把不同长度谱面标准化为 1,000,000 满分", () => {
    let stats = createInitialStats();
    stats = applyJudgement(stats, "perfect");
    stats = applyJudgement(stats, "great");
    stats = applyHoldCompletion(stats);
    expect(calculateNormalizedScore(stats, 3)).toBe(900_000);
    expect(calculateAccuracy(stats)).toBeCloseTo(91.666666, 4);
  });

  it("Hold 尾部完成或中断不重复增加主判定", () => {
    const headed = applyJudgement(createInitialStats(), "perfect");
    const completed = applyHoldCompletion(headed);
    const broken = applyHoldBreak(headed);
    expect(judgementCount(completed)).toBe(1);
    expect(completed).toMatchObject({ holdCompleted: 1, combo: 1 });
    expect(judgementCount(broken)).toBe(1);
    expect(broken).toMatchObject({ holdBroken: 1, combo: 0 });
  });

  it("全 Perfect Tap + Hold 满分严格为 1,000,000", () => {
    let stats = createInitialStats();
    stats = applyJudgement(stats, "perfect");
    stats = applyJudgement(stats, "perfect");
    stats = applyHoldCompletion(stats);
    expect(calculateNormalizedScore(stats, 3)).toBe(1_000_000);
    expect(calculateAccuracy(stats, 3)).toBe(100);
    expect(calculateRunFlags(stats, 2, 3)).toEqual({ fc: true, ap: true });
  });

  it("全部内置谱面的主判定数等于音符数且 AP 满分严格一致", () => {
    for (const song of SONG_CATALOG) {
      for (const difficulty of ["easy", "normal", "hard"] as const) {
        const loaded = loadBuiltInChart(song.id, difficulty);
        if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
        let stats = createInitialStats();
        for (const note of loaded.chart.notes) {
          stats = applyJudgement(stats, "perfect", 0);
          if (note.type === "hold") stats = applyHoldCompletion(stats);
        }
        expect(judgementCount(stats)).toBe(loaded.chart.noteCount);
        expect(
          calculateNormalizedScore(stats, loaded.chart.totalScoringUnits),
        ).toBe(1_000_000);
        expect(
          calculateRunFlags(
            stats,
            loaded.chart.noteCount,
            loaded.chart.totalScoringUnits,
          ),
        ).toEqual({ fc: true, ap: true });
      }
    }
  });

  it("识别 FC 和 AP", () => {
    let stats = createInitialStats();
    stats = applyJudgement(stats, "perfect");
    stats = applyHoldCompletion(stats);
    expect(calculateRunFlags(stats, 1, 2)).toEqual({ fc: true, ap: true });
    expect(calculateRunFlags(applyJudgement(stats, "miss"), 2, 3)).toEqual({
      fc: false,
      ap: false,
    });
  });

  it("计算 Early/Late 与时间分布", () => {
    const timing = summarizeTiming([-120, -40, 0, 20, 80, 110]);
    expect(timing).toMatchObject({ early: 2, late: 3, onTime: 1 });
    expect(timing.averageSignedMs).toBeCloseTo(8.333, 2);
    expect(timing.averageAbsoluteMs).toBeCloseTo(61.667, 2);
    expect(timing.histogram.map((bucket) => bucket.count)).toEqual([
      1, 0, 1, 2, 1, 1,
    ]);
  });
});

describe("评级", () => {
  it.each([
    [95, "S"],
    [90, "A"],
    [80, "B"],
    [70, "C"],
    [69.999, "D"],
  ] as const)("%s%% → %s", (accuracy, grade) => {
    expect(calculateGrade(accuracy)).toBe(grade);
  });
});
