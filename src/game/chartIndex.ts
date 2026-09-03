import type { ChartNote, Lane } from "./types";

const lowerBound = (notes: ChartNote[], time: number): number => {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
};

const upperBound = (notes: ChartNote[], time: number): number => {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
};

export class ChartIndex {
  readonly notes: ChartNote[];
  readonly notesByLane: [ChartNote[], ChartNote[], ChartNote[], ChartNote[]];

  constructor(
    notes: ChartNote[],
    notesByLane?: [ChartNote[], ChartNote[], ChartNote[], ChartNote[]],
  ) {
    this.notes = notes;
    this.notesByLane =
      notesByLane ??
      ([0, 1, 2, 3].map((lane) =>
        notes.filter((note) => note.lane === lane),
      ) as [ChartNote[], ChartNote[], ChartNote[], ChartNote[]]);
  }

  visible(
    chartTime: number,
    approachSeconds: number,
    postRollSeconds = 0.3,
  ): ChartNote[] {
    const first = lowerBound(this.notes, chartTime - postRollSeconds);
    const last = upperBound(this.notes, chartTime + approachSeconds);
    return this.notes.slice(first, last);
  }

  laneFrom(lane: Lane, cursor: number): ChartNote | undefined {
    return this.notesByLane[lane][cursor];
  }
}

export { lowerBound, upperBound };
