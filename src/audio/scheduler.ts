import type { LoadedChart } from "../game/types";

export interface SongSchedulerState {
  nextHalfBeat: number;
  nextNote: number;
  outroScheduled: boolean;
}

export interface ScheduleWindow {
  halfBeats: number[];
  noteIndices: number[];
  scheduleOutro: boolean;
}

export const createSongSchedulerState = (): SongSchedulerState => ({
  nextHalfBeat: 0,
  nextNote: 0,
  outroScheduled: false,
});

export function takeScheduleWindow(
  state: SongSchedulerState,
  chart: LoadedChart,
  horizonSongTime: number,
): ScheduleWindow {
  const beatDuration = 60 / chart.song.bpm;
  const halfBeatDuration = beatDuration / 2;
  const totalHalfBeats = Math.ceil(chart.song.duration / halfBeatDuration);
  const halfBeats: number[] = [];
  const noteIndices: number[] = [];

  while (
    state.nextHalfBeat < totalHalfBeats &&
    state.nextHalfBeat * halfBeatDuration <= horizonSongTime
  ) {
    halfBeats.push(state.nextHalfBeat);
    state.nextHalfBeat += 1;
  }

  while (
    state.nextNote < chart.notes.length &&
    chart.notes[state.nextNote].time <= horizonSongTime
  ) {
    noteIndices.push(state.nextNote);
    state.nextNote += 1;
  }

  const outroTime = chart.song.duration - beatDuration * 1.5;
  const scheduleOutro = !state.outroScheduled && outroTime <= horizonSongTime;
  if (scheduleOutro) state.outroScheduled = true;

  return { halfBeats, noteIndices, scheduleOutro };
}
