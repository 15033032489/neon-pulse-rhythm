export type ProductPhase =
  | "idle"
  | "starting"
  | "countdown"
  | "playing"
  | "pausing"
  | "paused"
  | "resuming"
  | "results";

export type StatsPanelMode = "waiting" | "live" | "last-result";
export type StageHudMode = "selection" | "live" | "result";

export interface ProductDisplayState {
  statsPanel: StatsPanelMode;
  stageHud: StageHudMode;
  showRuntimeMetrics: boolean;
}

export function formatClockTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function deriveProductDisplayState(
  phase: ProductPhase,
  hasLastResult: boolean,
): ProductDisplayState {
  if (phase === "idle") {
    return {
      statsPanel: hasLastResult ? "last-result" : "waiting",
      stageHud: "selection",
      showRuntimeMetrics: false,
    };
  }
  if (phase === "results") {
    return {
      statsPanel: "last-result",
      stageHud: "result",
      showRuntimeMetrics: false,
    };
  }
  return {
    statsPanel: "live",
    stageHud: "live",
    showRuntimeMetrics: true,
  };
}
