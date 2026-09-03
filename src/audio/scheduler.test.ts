import { describe, expect, it } from "vitest";
import { loadBuiltInChart, SONG_CATALOG } from "../charts";
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

  it("六张谱面的每个音符都会进入一次合成音乐调度", () => {
    for (const song of SONG_CATALOG) {
      for (const difficulty of ["easy", "normal", "hard"] as const) {
        const result = loadBuiltInChart(song.id, difficulty);
        if (!result.ok) throw new Error(result.errors.join("\n"));
        const state = createSongSchedulerState();
        const scheduled: number[] = [];
        for (let horizon = 0; horizon <= song.duration + 0.5; horizon += 0.45) {
          scheduled.push(
            ...takeScheduleWindow(state, result.chart, horizon).noteIndices,
          );
        }
        expect(scheduled).toEqual(result.chart.notes.map((_, index) => index));
      }
    }
  });
});
