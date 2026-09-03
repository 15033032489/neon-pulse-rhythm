import { ChartIndex } from "./chartIndex";
import { classifyHitOffset, RULESET, type HitJudgement } from "./scoring";
import {
  scoringUnitsForNote,
  type ChartNote,
  type HoldNote,
  type Lane,
  type LoadedChart,
} from "./types";

export type NoteRuntimeState =
  | "pending"
  | "holding"
  | "completed"
  | "missed"
  | "broken";

export type RuntimeEvent =
  | {
      kind: "judgement";
      note: ChartNote;
      judgement: HitJudgement;
      offsetMs: number;
    }
  | { kind: "miss"; note: ChartNote; offsetMs: number; scoreUnits: number }
  | { kind: "holdComplete"; note: HoldNote }
  | { kind: "holdBreak"; note: HoldNote; reason: "released" | "regrab-timeout" }
  | { kind: "holdRegrab"; note: HoldNote };

interface ActiveHold {
  note: HoldNote;
  holding: boolean;
  awaitingRegrab: boolean;
  regrabDeadline: number;
}

export class ChartRuntime {
  readonly index: ChartIndex;
  private readonly states = new Map<string, NoteRuntimeState>();
  private readonly laneCursors: [number, number, number, number] = [0, 0, 0, 0];
  private readonly activeHolds: Array<ActiveHold | null> = [
    null,
    null,
    null,
    null,
  ];
  private globalCursor = 0;
  private paused = false;
  private remainingScoreUnits: number;
  private remainingNotes: number;

  constructor(readonly chart: LoadedChart) {
    this.index = new ChartIndex(chart.notes, chart.notesByLane);
    this.remainingScoreUnits = chart.totalScoringUnits;
    this.remainingNotes = chart.noteCount;
    for (const note of chart.notes) this.states.set(note.id, "pending");
  }

  getState(noteId: string): NoteRuntimeState {
    return this.states.get(noteId) ?? "pending";
  }

  getRemainingScoringUnits(): number {
    return this.remainingScoreUnits;
  }

  getRemainingSummary(): { noteCount: number; scoreUnits: number } {
    return {
      noteCount: this.remainingNotes,
      scoreUnits: this.remainingScoreUnits,
    };
  }

  isComplete(): boolean {
    return this.remainingScoreUnits === 0;
  }

  visible(chartTime: number, approachSeconds: number): ChartNote[] {
    const visible = this.index
      .visible(chartTime, approachSeconds)
      .filter(
        (note) =>
          !["completed", "missed", "broken"].includes(this.getState(note.id)),
      );
    for (const active of this.activeHolds) {
      if (active && !visible.some((note) => note.id === active.note.id))
        visible.push(active.note);
    }
    return visible.sort(
      (left, right) => left.time - right.time || left.lane - right.lane,
    );
  }

  press(lane: Lane, chartTime: number): RuntimeEvent[] {
    if (this.paused) return [];

    const active = this.activeHolds[lane];
    if (active) {
      if (active.holding) return [];
      if (active.awaitingRegrab && chartTime <= active.regrabDeadline) {
        active.holding = true;
        active.awaitingRegrab = false;
        this.states.set(active.note.id, "holding");
        return [{ kind: "holdRegrab", note: active.note }];
      }
      return [];
    }

    const laneNotes = this.chart.notesByLane[lane];
    while (this.laneCursors[lane] < laneNotes.length) {
      const note = laneNotes[this.laneCursors[lane]];
      if (this.getState(note.id) !== "pending") {
        this.laneCursors[lane] += 1;
        continue;
      }

      const offsetMs = (chartTime - note.time) * 1000;
      const judgement = classifyHitOffset(offsetMs);
      if (!judgement) return [];

      this.laneCursors[lane] += 1;
      this.remainingNotes -= 1;
      this.remainingScoreUnits -= 1;
      if (note.type === "hold") {
        this.states.set(note.id, "holding");
        this.activeHolds[lane] = {
          note,
          holding: true,
          awaitingRegrab: false,
          regrabDeadline: Number.POSITIVE_INFINITY,
        };
      } else {
        this.states.set(note.id, "completed");
      }
      return [{ kind: "judgement", note, judgement, offsetMs }];
    }
    return [];
  }

  release(lane: Lane, chartTime: number): RuntimeEvent[] {
    if (this.paused) return [];
    const active = this.activeHolds[lane];
    if (!active?.holding) return [];

    const tailTime = active.note.time + active.note.duration;
    if (chartTime >= tailTime - RULESET.windowsMs.holdReleaseGrace / 1000) {
      return this.completeHold(lane, active);
    }
    return this.breakHold(lane, active, "released");
  }

  update(chartTime: number): RuntimeEvent[] {
    if (this.paused) return [];
    const events: RuntimeEvent[] = [];
    const goodSeconds = RULESET.windowsMs.good / 1000;

    while (this.globalCursor < this.chart.notes.length) {
      const note = this.chart.notes[this.globalCursor];
      if (note.time + goodSeconds >= chartTime) break;
      this.globalCursor += 1;
      if (this.getState(note.id) !== "pending") continue;

      const scoreUnits = scoringUnitsForNote(note);
      this.states.set(note.id, "missed");
      this.remainingNotes -= 1;
      this.remainingScoreUnits -= scoreUnits;
      events.push({
        kind: "miss",
        note,
        offsetMs: (chartTime - note.time) * 1000,
        scoreUnits,
      });
    }

    for (const lane of [0, 1, 2, 3] as Lane[]) {
      const active = this.activeHolds[lane];
      if (!active) continue;
      const tailTime = active.note.time + active.note.duration;

      if (active.holding && chartTime >= tailTime) {
        events.push(...this.completeHold(lane, active));
      } else if (active.awaitingRegrab && chartTime > active.regrabDeadline) {
        events.push(...this.breakHold(lane, active, "regrab-timeout"));
      }
    }
    return events;
  }

  pause(): void {
    this.paused = true;
  }

  resume(chartTime: number): void {
    this.paused = false;
    for (const active of this.activeHolds) {
      if (!active) continue;
      active.holding = false;
      active.awaitingRegrab = true;
      active.regrabDeadline =
        chartTime + RULESET.windowsMs.holdRegrabGrace / 1000;
    }
  }

  private completeHold(lane: Lane, active: ActiveHold): RuntimeEvent[] {
    this.activeHolds[lane] = null;
    this.states.set(active.note.id, "completed");
    this.remainingScoreUnits -= 1;
    return [{ kind: "holdComplete", note: active.note }];
  }

  private breakHold(
    lane: Lane,
    active: ActiveHold,
    reason: "released" | "regrab-timeout",
  ): RuntimeEvent[] {
    this.activeHolds[lane] = null;
    this.states.set(active.note.id, "broken");
    this.remainingScoreUnits -= 1;
    return [{ kind: "holdBreak", note: active.note, reason }];
  }
}
