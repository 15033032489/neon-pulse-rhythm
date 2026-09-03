import { describe, expect, it } from "vitest";
import { loadBuiltInChart } from "../charts";
import { createSongSchedulerState, takeScheduleWindow } from "./scheduler";

describe("音频短窗口预调度", () => {
  it("每个窗口只取新事件且不会重复调度", () => {
    const result = loadBuiltInChart("chromatic-run", "normal");
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const state = createSongSchedulerState();
    const first = takeScheduleWindow(state, result.chart, 2);
    const second = takeScheduleWindow(state, result.chart, 2.5);
    const empty = takeScheduleWindow(state, result.chart, 2.5);
    expect(first.halfBeats.length).toBeGreaterThan(0);
    expect(first.noteIndices.length).toBeGreaterThan(0);
    expect(second.halfBeats[0]).toBeGreaterThan(first.halfBeats.at(-1) ?? -1);
    expect(second.noteIndices[0]).toBeGreaterThan(
      first.noteIndices.at(-1) ?? -1,
    );
    expect(empty).toMatchObject({
      halfBeats: [],
      noteIndices: [],
      scheduleOutro: false,
    });
  });
});
