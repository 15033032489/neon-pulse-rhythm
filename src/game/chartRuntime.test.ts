import { describe, expect, it } from "vitest";
import { ChartRuntime } from "./chartRuntime";
import type { ChartNote, LoadedChart } from "./types";

const makeChart = (notes: ChartNote[]): LoadedChart => ({
  id: "test-normal",
  songId: "test",
  difficulty: "normal",
  level: 1,
  notes,
  song: {
    id: "test",
    title: "Test",
    artist: "Test",
    bpm: 120,
    duration: 10,
    subtitle: "Test",
    synthProfile: "chromatic",
  },
  totalScoringUnits: notes.reduce(
    (sum, note) => sum + (note.type === "hold" ? 2 : 1),
    0,
  ),
  notesByLane: [0, 1, 2, 3].map((lane) =>
    notes.filter((note) => note.lane === lane),
  ) as LoadedChart["notesByLane"],
});

describe("Hold 状态机", () => {
  const hold = {
    id: "h1",
    time: 1,
    lane: 0,
    type: "hold",
    duration: 1,
  } as const;

  it("判定头部并在持续到尾部时完成", () => {
    const runtime = new ChartRuntime(makeChart([hold]));
    expect(runtime.press(0, 1)).toMatchObject([
      { kind: "judgement", judgement: "perfect" },
    ]);
    expect(runtime.press(0, 1.02)).toEqual([]);
    expect(runtime.update(1.8)).toEqual([]);
    expect(runtime.update(2)).toMatchObject([{ kind: "holdComplete" }]);
    expect(runtime.isComplete()).toBe(true);
  });

  it("提前松开会中断，尾部宽限内松开会完成", () => {
    const broken = new ChartRuntime(makeChart([hold]));
    broken.press(0, 1);
    expect(broken.release(0, 1.5)).toMatchObject([
      { kind: "holdBreak", reason: "released" },
    ]);
    const completed = new ChartRuntime(makeChart([hold]));
    completed.press(0, 1);
    expect(completed.release(0, 1.92)).toMatchObject([
      { kind: "holdComplete" },
    ]);
  });

  it("暂停不判失败，继续后允许短时间重新按住", () => {
    const runtime = new ChartRuntime(makeChart([hold]));
    runtime.press(0, 1);
    runtime.pause();
    expect(runtime.release(0, 1.2)).toEqual([]);
    runtime.resume(1.2);
    expect(runtime.press(0, 1.3)).toMatchObject([{ kind: "holdRegrab" }]);
    expect(runtime.update(2)).toMatchObject([{ kind: "holdComplete" }]);
  });

  it("继续后未重新按住会超时中断", () => {
    const runtime = new ChartRuntime(makeChart([hold]));
    runtime.press(0, 1);
    runtime.pause();
    runtime.resume(1.2);
    expect(runtime.update(1.46)).toMatchObject([
      { kind: "holdBreak", reason: "regrab-timeout" },
    ]);
  });

  it("Hold 头部漏击会一次结算两个计分单位", () => {
    const runtime = new ChartRuntime(makeChart([hold]));
    expect(runtime.update(1.141)).toMatchObject([{ kind: "miss", units: 2 }]);
    expect(runtime.isComplete()).toBe(true);
  });
});
