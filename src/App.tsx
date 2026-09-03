import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { SynthEngine, type CalibrationClock } from "./audio/SynthEngine";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DifficultySelector } from "./components/DifficultySelector";
import { ResultPanel } from "./components/ResultPanel";
import { DEMO_SONG, loadBuiltInChart } from "./charts";
import {
  analyzeCalibration,
  type CalibrationResult,
  type CalibrationSample,
} from "./game/calibration";
import { ChartRuntime, type RuntimeEvent } from "./game/chartRuntime";
import {
  loadRecords,
  mergeRecord,
  recordKey,
  saveRecords,
  type RecordBook,
} from "./game/records";
import {
  applyHoldBreak,
  applyHoldCompletion,
  applyJudgement,
  calculateAccuracy,
  calculateGrade,
  calculateNormalizedScore,
  calculateRunFlags,
  createInitialStats,
  RULESET,
  summarizeTiming,
  type GameStats,
  type Grade,
  type Judgement,
  type RunFlags,
  type TimingSummary,
} from "./game/scoring";
import { finalizeRun, type FinishReason } from "./game/session";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_LIMITS,
  type GameSettings,
} from "./game/settings";
import {
  LANE_KEYS,
  type ChartNote,
  type DifficultyId,
  type Lane,
  type LoadedChart,
} from "./game/types";

type GamePhase =
  | "idle"
  | "starting"
  | "countdown"
  | "playing"
  | "pausing"
  | "paused"
  | "resuming"
  | "results";

interface ClockSnapshot {
  rawTime: number;
  chartTime: number;
  frameTime: number;
}

interface HitEffect {
  id: number;
  lane: Lane;
  judgement: Judgement;
  label: string;
  offsetMs: number | null;
  bornAt: number;
}

interface RunResult {
  reason: FinishReason;
  stats: GameStats;
  score: number;
  accuracy: number;
  grade: Grade;
  flags: RunFlags;
  timing: TimingSummary;
  newRecord: boolean;
}

type NoteStyle = CSSProperties & {
  "--note-y": string;
  "--hold-length"?: string;
};
type LaneStyle = CSSProperties & { "--lane-index": number };

const BASE_APPROACH_SECONDS = 2.15;
const ACTIVE_PHASES: GamePhase[] = ["countdown", "playing"];
const FOCUS_PHASES: GamePhase[] = [
  "starting",
  "countdown",
  "playing",
  "pausing",
  "paused",
  "resuming",
];
const KEY_TO_LANE: Record<string, Lane> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
};
const PHASE_LABELS: Record<GamePhase, string> = {
  idle: "SYSTEM READY",
  starting: "AUDIO BOOT",
  countdown: "SYNCING",
  playing: "LIVE",
  pausing: "HOLDING",
  paused: "PAUSED",
  resuming: "RESUMING",
  results: "RESULTS",
};

const CHART_RESULTS = {
  easy: loadBuiltInChart(DEMO_SONG.id, "easy"),
  normal: loadBuiltInChart(DEMO_SONG.id, "normal"),
  hard: loadBuiltInChart(DEMO_SONG.id, "hard"),
} satisfies Record<DifficultyId, ReturnType<typeof loadBuiltInChart>>;

const DIFFICULTY_LEVELS: Record<DifficultyId, number | null> = {
  easy: CHART_RESULTS.easy.ok ? CHART_RESULTS.easy.chart.level : null,
  normal: CHART_RESULTS.normal.ok ? CHART_RESULTS.normal.chart.level : null,
  hard: CHART_RESULTS.hard.ok ? CHART_RESULTS.hard.chart.level : null,
};

const emptyPressedLanes = (): [boolean, boolean, boolean, boolean] => [
  false,
  false,
  false,
  false,
];
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const formatScore = (score: number) => score.toString().padStart(7, "0");
const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};

export default function App() {
  const [difficulty, setDifficulty] = useState<DifficultyId>("normal");
  const chartResult = CHART_RESULTS[difficulty];
  const chart = chartResult.ok ? chartResult.chart : null;
  const chartRef = useRef<LoadedChart | null>(chart);
  chartRef.current = chart;

  const [phase, setPhase] = useState<GamePhase>("idle");
  const phaseRef = useRef<GamePhase>("idle");
  const [stats, setStats] = useState<GameStats>(() => createInitialStats());
  const statsRef = useRef(stats);
  const [clock, setClock] = useState<ClockSnapshot>({
    rawTime: 0,
    chartTime: 0,
    frameTime: performance.now(),
  });
  const clockRef = useRef(clock);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  const [records, setRecords] = useState<RecordBook>(() => loadRecords());
  const recordsRef = useRef(records);
  const [pressedLanes, setPressedLanes] = useState(emptyPressedLanes);
  const [effects, setEffects] = useState<HitEffect[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [noteTravelPixels, setNoteTravelPixels] = useState(0);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );

  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationTapCount, setCalibrationTapCount] = useState(0);
  const [calibrationResult, setCalibrationResult] =
    useState<CalibrationResult | null>(null);
  const calibrationRunningRef = useRef(false);
  const calibrationClockRef = useRef<CalibrationClock | null>(null);
  const calibrationSamplesRef = useRef<CalibrationSample[]>([]);
  const calibrationSeenBeatsRef = useRef(new Set<number>());

  const engineRef = useRef<SynthEngine | null>(null);
  const runtimeRef = useRef<ChartRuntime | null>(null);
  const audioStartTimeRef = useRef(0);
  const runIdRef = useRef(0);
  const pressedCodesRef = useRef(new Set<string>());
  const pointerLanesRef = useRef(new Map<number, Lane>());
  const accessibleLaneKeysRef = useRef(new Set<Lane>());
  const lastAccessibleActivationRef = useRef<number[]>([0, 0, 0, 0]);
  const effectIdRef = useRef(0);
  const focusLostDuringTransitionRef = useRef(false);
  const laneFieldRef = useRef<HTMLDivElement | null>(null);
  const judgeLineRef = useRef<HTMLDivElement | null>(null);

  const setGamePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateClock = useCallback((next: ClockSnapshot) => {
    clockRef.current = next;
    setClock(next);
  }, []);

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new SynthEngine();
    return engineRef.current;
  }, []);

  const laneIsPressed = useCallback((lane: Lane) => {
    for (const code of pressedCodesRef.current)
      if (KEY_TO_LANE[code] === lane) return true;
    for (const pointerLane of pointerLanesRef.current.values())
      if (pointerLane === lane) return true;
    return accessibleLaneKeysRef.current.has(lane);
  }, []);

  const refreshPressedLanes = useCallback(() => {
    const next = emptyPressedLanes();
    for (const lane of [0, 1, 2, 3] as Lane[]) next[lane] = laneIsPressed(lane);
    setPressedLanes(next);
  }, [laneIsPressed]);

  const clearPressedInputs = useCallback(() => {
    pressedCodesRef.current.clear();
    pointerLanesRef.current.clear();
    accessibleLaneKeysRef.current.clear();
    setPressedLanes(emptyPressedLanes());
  }, []);

  const readAudioClock = useCallback((): ClockSnapshot => {
    const engine = engineRef.current;
    if (!engine || audioStartTimeRef.current === 0) return clockRef.current;
    const rawTime = engine.getCurrentTime() - audioStartTimeRef.current;
    return {
      rawTime,
      chartTime: rawTime - settingsRef.current.audioOffsetMs / 1000,
      frameTime: performance.now(),
    };
  }, []);

  const addEffect = useCallback(
    (
      lane: Lane,
      judgement: Judgement,
      label: string,
      offsetMs: number | null,
    ) => {
      const effect: HitEffect = {
        id: (effectIdRef.current += 1),
        lane,
        judgement,
        label,
        offsetMs,
        bornAt: performance.now(),
      };
      setEffects((current) => [...current.slice(-11), effect]);
    },
    [],
  );

  const finishGame = useCallback(
    (reason: FinishReason) => {
      if (phaseRef.current === "idle" || phaseRef.current === "results") return;
      const currentChart = chartRef.current;
      if (!currentChart) return;
      runIdRef.current += 1;
      const finalized = finalizeRun(
        statsRef.current,
        runtimeRef.current?.getRemainingScoringUnits() ?? 0,
        reason,
      );
      statsRef.current = finalized.stats;
      setStats(finalized.stats);
      const accuracy = calculateAccuracy(finalized.stats);
      const score = calculateNormalizedScore(
        finalized.stats,
        currentChart.totalScoringUnits,
      );
      const grade = calculateGrade(accuracy);
      const flags = calculateRunFlags(
        finalized.stats,
        currentChart.totalScoringUnits,
      );
      let newRecord = false;

      if (finalized.shouldPersist) {
        const merged = mergeRecord(
          recordsRef.current,
          currentChart.song.id,
          currentChart.difficulty,
          {
            score,
            accuracy,
            maxCombo: finalized.stats.maxCombo,
            grade,
            flags,
          },
        );
        recordsRef.current = merged.book;
        setRecords(merged.book);
        saveRecords(merged.book);
        newRecord = merged.newRecord;
      }

      setResult({
        reason,
        stats: finalized.stats,
        score,
        accuracy,
        grade,
        flags,
        timing: summarizeTiming(finalized.stats.timingOffsetsMs),
        newRecord,
      });
      setAbandonOpen(false);
      clearPressedInputs();
      engineRef.current?.stopAll();
      void engineRef.current?.suspend();
      setGamePhase("results");
    },
    [clearPressedInputs, setGamePhase],
  );

  const commitRuntimeEvents = useCallback(
    (events: RuntimeEvent[]) => {
      if (!events.length) return;
      let next = statsRef.current;
      for (const event of events) {
        if (event.kind === "judgement") {
          next = applyJudgement(next, event.judgement, event.offsetMs);
          addEffect(
            event.note.lane,
            event.judgement,
            event.judgement.toUpperCase(),
            event.offsetMs,
          );
          engineRef.current?.playHit(event.note.lane, event.judgement);
        } else if (event.kind === "miss") {
          for (let unit = 0; unit < event.units; unit += 1)
            next = applyJudgement(next, "miss");
          addEffect(
            event.note.lane,
            "miss",
            event.note.type === "hold" ? "HOLD MISS" : "MISS",
            null,
          );
        } else if (event.kind === "holdComplete") {
          next = applyHoldCompletion(next);
          addEffect(event.note.lane, "perfect", "HOLD COMPLETE", null);
          engineRef.current?.playHit(event.note.lane, "perfect");
        } else if (event.kind === "holdBreak") {
          next = applyHoldBreak(next);
          addEffect(
            event.note.lane,
            "miss",
            event.reason === "released" ? "HOLD BREAK" : "REGRAB MISSED",
            null,
          );
        } else {
          addEffect(event.note.lane, "great", "HOLD REGRAB", null);
        }
      }
      statsRef.current = next;
      setStats(next);
      if (next.life <= 0) finishGame("failed");
    },
    [addEffect, finishGame],
  );

  const pressLane = useCallback(
    (lane: Lane) => {
      if (phaseRef.current !== "playing") return;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const nextClock = readAudioClock();
      commitRuntimeEvents(runtime.update(nextClock.chartTime));
      if (phaseRef.current !== "playing") return;
      commitRuntimeEvents(runtime.press(lane, nextClock.chartTime));
    },
    [commitRuntimeEvents, readAudioClock],
  );

  const releaseLane = useCallback(
    (lane: Lane) => {
      if (phaseRef.current !== "playing" || laneIsPressed(lane)) return;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const nextClock = readAudioClock();
      commitRuntimeEvents(runtime.release(lane, nextClock.chartTime));
    },
    [commitRuntimeEvents, laneIsPressed, readAudioClock],
  );

  const startGame = useCallback(async () => {
    const currentChart = chartRef.current;
    if (!currentChart) {
      setAudioError(
        chartResult.ok ? "当前谱面不可用。" : chartResult.errors.join(" "),
      );
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    focusLostDuringTransitionRef.current = document.hidden;
    setGamePhase("starting");
    clearPressedInputs();
    const initialStats = createInitialStats();
    statsRef.current = initialStats;
    setStats(initialStats);
    runtimeRef.current = new ChartRuntime(currentChart);
    setEffects([]);
    setResult(null);
    setAudioError(null);
    setUiMessage(null);
    setAutoPaused(false);

    try {
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      const startTime = await engine.start(currentChart, 3);
      if (runId !== runIdRef.current) return;
      audioStartTimeRef.current = startTime;
      updateClock(readAudioClock());
      if (focusLostDuringTransitionRef.current || document.hidden) {
        runtimeRef.current.pause();
        await engine.suspend();
        if (runId !== runIdRef.current) return;
        updateClock(readAudioClock());
        setAutoPaused(true);
        setGamePhase("paused");
        return;
      }
      setGamePhase("countdown");
    } catch (error) {
      if (runId !== runIdRef.current) return;
      engineRef.current?.stopAll();
      setAudioError(
        error instanceof Error ? error.message : "浏览器无法启动音频系统。",
      );
      setGamePhase("idle");
    }
  }, [
    chartResult,
    clearPressedInputs,
    getEngine,
    readAudioClock,
    setGamePhase,
    updateClock,
  ]);

  const pauseGame = useCallback(
    async (automatic = false) => {
      if (!ACTIVE_PHASES.includes(phaseRef.current)) return;
      const runId = runIdRef.current;
      const previousPhase = phaseRef.current as "countdown" | "playing";
      runtimeRef.current?.pause();
      setGamePhase("pausing");
      clearPressedInputs();
      try {
        await engineRef.current?.suspend();
      } catch (error) {
        runtimeRef.current?.resume(clockRef.current.chartTime);
        if (runId !== runIdRef.current) return;
        setAudioError(
          error instanceof Error ? error.message : "无法暂停音频时钟。",
        );
        setGamePhase(previousPhase);
        return;
      }
      if (runId !== runIdRef.current || phaseRef.current !== "pausing") return;
      updateClock(readAudioClock());
      setAutoPaused(automatic);
      setGamePhase("paused");
    },
    [clearPressedInputs, readAudioClock, setGamePhase, updateClock],
  );

  const resumeGame = useCallback(async () => {
    if (phaseRef.current !== "paused") return;
    const runId = runIdRef.current;
    focusLostDuringTransitionRef.current = document.hidden;
    setGamePhase("resuming");
    setAudioError(null);
    try {
      await engineRef.current?.resume();
      if (
        runId !== runIdRef.current ||
        (phaseRef.current as GamePhase) !== "resuming"
      )
        return;
      if (focusLostDuringTransitionRef.current || document.hidden) {
        await engineRef.current?.suspend();
        if (runId !== runIdRef.current) return;
        setAutoPaused(true);
        setGamePhase("paused");
        return;
      }
      const next = readAudioClock();
      runtimeRef.current?.resume(next.chartTime);
      updateClock(next);
      setAutoPaused(false);
      setUiMessage("若暂停前正在 Hold，请在 250ms 内重新按住对应轨道。");
      setGamePhase(next.rawTime < 0 ? "countdown" : "playing");
    } catch (error) {
      if (runId !== runIdRef.current) return;
      setAudioError(
        error instanceof Error ? error.message : "无法继续音频播放。",
      );
      setGamePhase("paused");
    }
  }, [readAudioClock, setGamePhase, updateClock]);

  const requestAbandon = useCallback(async () => {
    if (ACTIVE_PHASES.includes(phaseRef.current)) await pauseGame(false);
    if (phaseRef.current === "paused") setAbandonOpen(true);
  }, [pauseGame]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setUiMessage("浏览器未允许全屏；游戏仍可正常运行。");
    }
  }, []);

  const recordCalibrationTap = useCallback(() => {
    const calibrationClock = calibrationClockRef.current;
    const engine = engineRef.current;
    if (!calibrationRunningRef.current || !calibrationClock || !engine) return;
    const now = engine.getCurrentTime();
    const beatIndex = Math.round(
      (now - calibrationClock.firstBeatTime) / calibrationClock.beatDuration,
    );
    const totalBeats =
      calibrationClock.warmupBeats + calibrationClock.sampleBeats;
    if (
      beatIndex < 0 ||
      beatIndex >= totalBeats ||
      calibrationSeenBeatsRef.current.has(beatIndex)
    )
      return;
    const expected =
      calibrationClock.firstBeatTime +
      beatIndex * calibrationClock.beatDuration;
    calibrationSeenBeatsRef.current.add(beatIndex);
    calibrationSamplesRef.current.push({
      beatIndex,
      deviationMs: (now - expected) * 1000,
    });
    setCalibrationTapCount(calibrationSamplesRef.current.length);
  }, []);

  const startCalibration = useCallback(async () => {
    try {
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      calibrationSamplesRef.current = [];
      calibrationSeenBeatsRef.current.clear();
      setCalibrationTapCount(0);
      setCalibrationResult(null);
      calibrationClockRef.current = await engine.startCalibration();
      calibrationRunningRef.current = true;
      setCalibrationRunning(true);
    } catch (error) {
      setCalibrationResult({
        ok: false,
        recommendedOffsetMs: 0,
        acceptedSamples: [],
        ignoredCount: 0,
        message: error instanceof Error ? error.message : "无法启动校准音频。",
      });
    }
  }, [getEngine]);

  const closeCalibration = useCallback(() => {
    calibrationRunningRef.current = false;
    setCalibrationRunning(false);
    calibrationClockRef.current = null;
    engineRef.current?.stopAll();
    setCalibrationOpen(false);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    engineRef.current?.setVolumes(settings);
  }, [settings]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    calibrationRunningRef.current = calibrationRunning;
  }, [calibrationRunning]);

  useEffect(() => {
    if (!uiMessage) return;
    const timeout = window.setTimeout(() => setUiMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [uiMessage]);

  useEffect(() => {
    const focused = FOCUS_PHASES.includes(phase);
    document.body.classList.toggle("game-focus", focused);
    return () => document.body.classList.remove("game-focus");
  }, [phase]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useLayoutEffect(() => {
    const field = laneFieldRef.current;
    const judgeLine = judgeLineRef.current;
    if (!field || !judgeLine) return;
    const measure = () => {
      const fieldRect = field.getBoundingClientRect();
      const judgeRect = judgeLine.getBoundingClientRect();
      setNoteTravelPixels(Math.max(0, judgeRect.top - fieldRect.top));
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(field);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [phase]);

  useEffect(() => {
    if (!ACTIVE_PHASES.includes(phase)) return;
    let animationFrame = 0;
    const tick = () => {
      if (!ACTIVE_PHASES.includes(phaseRef.current)) return;
      engineRef.current?.pumpScheduler();
      const nextClock = readAudioClock();
      updateClock(nextClock);
      setEffects((current) =>
        current.filter((effect) => nextClock.frameTime - effect.bornAt <= 900),
      );
      if (phaseRef.current === "countdown" && nextClock.rawTime >= 0)
        setGamePhase("playing");
      if (phaseRef.current === "playing") {
        const runtime = runtimeRef.current;
        if (runtime) commitRuntimeEvents(runtime.update(nextClock.chartTime));
        if (
          phaseRef.current === "playing" &&
          (runtime?.isComplete() ||
            nextClock.rawTime >= (chartRef.current?.song.duration ?? 0) + 0.25)
        ) {
          finishGame("complete");
          return;
        }
      }
      if (ACTIVE_PHASES.includes(phaseRef.current))
        animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    commitRuntimeEvents,
    finishGame,
    phase,
    readAudioClock,
    setGamePhase,
    updateClock,
  ]);

  useEffect(() => {
    if (!calibrationRunning) return;
    let animationFrame = 0;
    const tick = () => {
      const calibrationClock = calibrationClockRef.current;
      const engine = engineRef.current;
      if (!calibrationRunningRef.current || !calibrationClock || !engine)
        return;
      const total = calibrationClock.warmupBeats + calibrationClock.sampleBeats;
      const endTime =
        calibrationClock.firstBeatTime +
        (total - 1) * calibrationClock.beatDuration +
        0.32;
      if (engine.getCurrentTime() >= endTime) {
        calibrationRunningRef.current = false;
        setCalibrationRunning(false);
        setCalibrationResult(analyzeCalibration(calibrationSamplesRef.current));
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [calibrationRunning]);

  useEffect(() => {
    const pauseForFocusLoss = () => {
      focusLostDuringTransitionRef.current = true;
      void pauseGame(true);
    };
    const onVisibility = () => {
      if (document.hidden) pauseForFocusLoss();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pauseForFocusLoss);
    window.addEventListener("pagehide", pauseForFocusLoss);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", pauseForFocusLoss);
      window.removeEventListener("pagehide", pauseForFocusLoss);
    };
  }, [pauseGame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (calibrationOpen) {
        if (
          !event.repeat &&
          (event.code === "Space" || KEY_TO_LANE[event.code] !== undefined)
        ) {
          event.preventDefault();
          recordCalibrationTap();
        }
        if (event.code === "Escape" && !event.repeat) closeCalibration();
        return;
      }
      if (event.code === "Escape" && !event.repeat) {
        if (abandonOpen) setAbandonOpen(false);
        else if (ACTIVE_PHASES.includes(phaseRef.current))
          void pauseGame(false);
        return;
      }
      const lane = KEY_TO_LANE[event.code];
      if (lane === undefined) return;
      event.preventDefault();
      if (event.repeat || pressedCodesRef.current.has(event.code)) return;
      pressedCodesRef.current.add(event.code);
      refreshPressedLanes();
      pressLane(lane);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const lane = KEY_TO_LANE[event.code];
      if (lane === undefined) return;
      pressedCodesRef.current.delete(event.code);
      refreshPressedLanes();
      releaseLane(lane);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    abandonOpen,
    calibrationOpen,
    closeCalibration,
    pauseGame,
    pressLane,
    recordCalibrationTap,
    refreshPressedLanes,
    releaseLane,
  ]);

  useEffect(() => () => engineRef.current?.dispose(), []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, lane: Lane) => {
      event.preventDefault();
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (pointerLanesRef.current.has(event.pointerId)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerLanesRef.current.set(event.pointerId, lane);
      refreshPressedLanes();
      pressLane(lane);
    },
    [pressLane, refreshPressedLanes],
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const lane = pointerLanesRef.current.get(event.pointerId);
      pointerLanesRef.current.delete(event.pointerId);
      refreshPressedLanes();
      if (lane !== undefined) releaseLane(lane);
    },
    [refreshPressedLanes, releaseLane],
  );

  const handleAccessibleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, lane: Lane) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || accessibleLaneKeysRef.current.has(lane)) return;
      accessibleLaneKeysRef.current.add(lane);
      lastAccessibleActivationRef.current[lane] = performance.now();
      refreshPressedLanes();
      pressLane(lane);
    },
    [pressLane, refreshPressedLanes],
  );

  const handleAccessibleKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, lane: Lane) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      accessibleLaneKeysRef.current.delete(lane);
      refreshPressedLanes();
      releaseLane(lane);
    },
    [refreshPressedLanes, releaseLane],
  );

  const approachSeconds = BASE_APPROACH_SECONDS / settings.noteSpeed;
  const visibleNotes = useMemo(() => {
    if (!runtimeRef.current || phase === "idle" || phase === "results")
      return [];
    return runtimeRef.current.visible(clock.chartTime, approachSeconds);
  }, [approachSeconds, clock.chartTime, phase, stats.judgedUnits]);

  const liveAccuracy = calculateAccuracy(stats);
  const liveScore = chart
    ? calculateNormalizedScore(stats, chart.totalScoringUnits)
    : 0;
  const progress = chart ? clamp(clock.rawTime / chart.song.duration, 0, 1) : 0;
  const latestEffect = effects.at(-1);
  const countdownValue = clock.rawTime > -1 ? 1 : clock.rawTime > -2 ? 2 : 3;
  const isBusy = ["starting", "pausing", "resuming"].includes(phase);
  const isSettingsLocked = FOCUS_PHASES.includes(phase);
  const isSessionActive = phase !== "idle" && phase !== "results";
  const audioState = engineRef.current?.getState() ?? "uninitialized";
  const selectedRecord = chart
    ? records.entries[recordKey(chart.song.id, chart.difficulty)]
    : undefined;

  const updateSetting = <Key extends keyof GameSettings>(
    key: Key,
    value: GameSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const renderNote = (note: ChartNote) => {
    const state = runtimeRef.current?.getState(note.id) ?? "pending";
    const headProgress =
      state === "holding"
        ? 1
        : clamp(
            1 - (note.time - clock.chartTime) / approachSeconds,
            -0.05,
            1.08,
          );
    if (note.type === "tap") {
      return (
        <div
          className="falling-note is-tap"
          data-note-type="tap"
          key={note.id}
          style={
            { "--note-y": `${headProgress * noteTravelPixels}px` } as NoteStyle
          }
          aria-hidden="true"
        >
          <i className="note-head">
            <b>◆</b>
          </i>
        </div>
      );
    }
    const tailProgress = clamp(
      1 - (note.time + note.duration - clock.chartTime) / approachSeconds,
      -0.08,
      1.08,
    );
    const holdLength = Math.max(
      24,
      (headProgress - tailProgress) * noteTravelPixels,
    );
    return (
      <div
        className={`falling-note is-hold ${state === "holding" ? "is-held" : ""}`}
        data-note-type="hold"
        key={note.id}
        style={
          {
            "--note-y": `${headProgress * noteTravelPixels}px`,
            "--hold-length": `${holdLength}px`,
          } as NoteStyle
        }
        aria-hidden="true"
      >
        <span className="hold-body">
          <em>HOLD</em>
        </span>
        <b className="hold-tail">▬</b>
        <i className="note-head">
          <b>▰</b>
        </i>
      </div>
    );
  };

  return (
    <main
      className={`app-shell phase-${phase} ${FOCUS_PHASES.includes(phase) ? "is-focus-mode" : ""}`}
    >
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <span className="eyebrow">SYNTHETIC AUDIO SYSTEM</span>
            <h1>
              NEON <em>PULSE</em>
            </h1>
          </div>
        </div>
        <div className="system-status">
          <span
            className={`status-dot ${audioState === "running" ? "is-live" : ""}`}
          />
          <span>{PHASE_LABELS[phase]}</span>
          <b>
            {audioState === "uninitialized"
              ? "AUDIO STANDBY"
              : audioState.toUpperCase()}
          </b>
        </div>
      </header>

      {(audioError || uiMessage) && (
        <div
          className={`runtime-error ${audioError ? "is-error" : "is-info"}`}
          role={audioError ? "alert" : "status"}
        >
          {audioError ? `AUDIO ERROR · ${audioError}` : uiMessage}
        </div>
      )}

      <section className="game-layout" aria-label="Neon Pulse 四键节奏游戏台">
        <aside className="side-card stats-card" aria-label="实时成绩">
          <div className="card-heading">
            <span className="card-label">LIVE DATA</span>
            <span className="tiny-index">01 / STATUS</span>
          </div>
          <div className="score-block">
            <span>SCORE / 1M</span>
            <strong data-testid="score">{formatScore(liveScore)}</strong>
          </div>
          <div className="primary-stats">
            <div>
              <span>COMBO</span>
              <strong data-testid="combo">{stats.combo}</strong>
            </div>
            <div>
              <span>MAX COMBO</span>
              <strong>{stats.maxCombo}</strong>
            </div>
            <div>
              <span>ACCURACY</span>
              <strong>{liveAccuracy.toFixed(2)}%</strong>
            </div>
          </div>
          <div className="life-readout">
            <div>
              <span>SIGNAL / LIFE</span>
              <b>{stats.life}%</b>
            </div>
            <div
              className="life-track"
              role="meter"
              aria-label="生命值"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={stats.life}
            >
              <span style={{ width: `${stats.life}%` }} />
            </div>
          </div>
          <div className="judgement-list" aria-label="判定统计">
            {(["perfect", "great", "good", "miss"] as Judgement[]).map(
              (judgement) => (
                <div key={judgement} className={`count-${judgement}`}>
                  <span>{judgement.toUpperCase()}</span>
                  <b>{String(stats.counts[judgement]).padStart(2, "0")}</b>
                </div>
              ),
            )}
          </div>
          <div className="hold-readout">
            <span>
              HOLD COMPLETE <b>{stats.holdCompleted}</b>
            </span>
            <span>
              BREAK <b>{stats.holdBroken}</b>
            </span>
          </div>
          <div className="time-readout">
            <span>{formatTime(clock.rawTime)}</span>
            <i>
              <b style={{ transform: `scaleX(${progress})` }} />
            </i>
            <span>{formatTime(chart?.song.duration ?? 0)}</span>
          </div>
        </aside>

        <section className="stage-card" aria-label="演奏区域">
          <div className="stage-topline">
            <div>
              <span>NOW PLAYING</span>
              <b>
                {DEMO_SONG.title} · {difficulty.toUpperCase()}
              </b>
            </div>
            <div className="stage-live-stats">
              <span>
                {liveAccuracy.toFixed(1)}% · LIFE {stats.life}
              </span>
              <b>
                {stats.combo}
                <small> COMBO</small>
              </b>
            </div>
            <div className="stage-toolbar">
              {ACTIVE_PHASES.includes(phase) && (
                <button
                  type="button"
                  onClick={() => void pauseGame(false)}
                  aria-label="暂停"
                >
                  Ⅱ
                </button>
              )}
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={fullscreen ? "退出全屏" : "进入全屏"}
              >
                {fullscreen ? "⊡" : "⛶"}
              </button>
              <span className="stage-state">
                <i /> {PHASE_LABELS[phase]}
              </span>
            </div>
          </div>
          <div className="stage-progress">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>

          <div
            className="lane-field"
            ref={laneFieldRef}
            data-chart-time={clock.chartTime.toFixed(4)}
            data-visible-notes={visibleNotes.length}
          >
            <div className="perspective-grid" aria-hidden="true" />
            {LANE_KEYS.map((key, laneIndex) => {
              const lane = laneIndex as Lane;
              const laneEffect = [...effects]
                .reverse()
                .find(
                  (effect) =>
                    effect.lane === lane &&
                    clock.frameTime - effect.bornAt < 280,
                );
              return (
                <div
                  className={`lane lane-${lane} ${pressedLanes[lane] ? "is-pressed" : ""} ${laneEffect && laneEffect.judgement !== "miss" ? "is-hit" : ""}`}
                  key={key}
                >
                  <div className="lane-rail" aria-hidden="true" />
                  {visibleNotes
                    .filter((note) => note.lane === lane)
                    .map(renderNote)}
                  <button
                    type="button"
                    className="lane-key"
                    aria-label={`${key} 键，第 ${lane + 1} 轨；点击或按住以演奏`}
                    aria-keyshortcuts={key}
                    tabIndex={phase === "playing" ? 0 : -1}
                    onPointerDown={(event) => handlePointerDown(event, lane)}
                    onPointerUp={releasePointer}
                    onPointerCancel={releasePointer}
                    onLostPointerCapture={releasePointer}
                    onKeyDown={(event) => handleAccessibleKeyDown(event, lane)}
                    onKeyUp={(event) => handleAccessibleKeyUp(event, lane)}
                    onClick={(event) => {
                      if (
                        event.detail === 0 &&
                        performance.now() -
                          lastAccessibleActivationRef.current[lane] >
                          500
                      )
                        pressLane(lane);
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <span>{key}</span>
                    <small>
                      LANE 0{lane + 1} · {lane % 2 === 0 ? "◆" : "▰"}
                    </small>
                  </button>
                </div>
              );
            })}

            <div className="judge-line" ref={judgeLineRef} aria-hidden="true">
              <span>SYNC</span>
              <i />
            </div>
            {effects
              .filter((effect) => effect.judgement !== "miss")
              .map((effect) => (
                <div
                  className={`note-burst burst-${effect.judgement}`}
                  key={`burst-${effect.id}`}
                  style={{ "--lane-index": effect.lane } as LaneStyle}
                  aria-hidden="true"
                >
                  {Array.from({ length: 8 }, (_, index) => (
                    <i key={index} />
                  ))}
                </div>
              ))}
            {latestEffect && (
              <div
                className={`judgement-popup judgement-${latestEffect.judgement}`}
                key={`judge-${latestEffect.id}`}
                aria-live="polite"
              >
                <strong>{latestEffect.label}</strong>
                {latestEffect.offsetMs !== null && (
                  <span>
                    {Math.abs(latestEffect.offsetMs) < 1
                      ? "ON BEAT"
                      : `${latestEffect.offsetMs < 0 ? "EARLY" : "LATE"} ${Math.abs(Math.round(latestEffect.offsetMs))}ms`}
                  </span>
                )}
              </div>
            )}
            {latestEffect?.judgement === "perfect" && (
              <div
                className="impact-flash"
                key={`impact-${latestEffect.id}`}
                aria-hidden="true"
              />
            )}

            {phase === "idle" && (
              <div className="game-overlay intro-overlay upgraded-intro">
                <div className="intro-kicker">
                  <i /> ORIGINAL SYNTH TRACK
                </div>
                <h2>
                  CHROMATIC
                  <br />
                  <em>RUN</em>
                </h2>
                <p>{DEMO_SONG.subtitle}</p>
                <DifficultySelector
                  value={difficulty}
                  levels={DIFFICULTY_LEVELS}
                  onChange={setDifficulty}
                />
                {chart && (
                  <div className="intro-specs">
                    <span>
                      <b>{chart.song.bpm}</b> BPM
                    </span>
                    <span>
                      <b>{chart.notes.length}</b> NOTES
                    </span>
                    <span>
                      <b>LV.{chart.level}</b> {difficulty.toUpperCase()}
                    </span>
                  </div>
                )}
                {!chartResult.ok && (
                  <div className="chart-error" role="alert">
                    <b>谱面加载失败</b>
                    {chartResult.errors.map((error) => (
                      <span key={error}>{error}</span>
                    ))}
                  </div>
                )}
                {chartResult.ok && chartResult.warnings.length > 0 && (
                  <p className="chart-warning">
                    {chartResult.warnings.join(" ")}
                  </p>
                )}
                <button
                  type="button"
                  className="start-button"
                  onClick={() => void startGame()}
                  disabled={!chart}
                >
                  <span>START SESSION</span>
                  <i>▶</i>
                </button>
                <small>D · F · J · K / MOUSE / MULTI-TOUCH</small>
              </div>
            )}

            {phase === "starting" && (
              <div className="game-overlay loading-overlay" aria-live="polite">
                <div className="loading-ring" />
                <b>INITIALIZING AUDIO</b>
                <span>正在锁定 Web Audio 时钟</span>
              </div>
            )}
            {phase === "countdown" && (
              <div
                className="countdown-overlay"
                aria-live="assertive"
                key={countdownValue}
              >
                <span>GET READY</span>
                <strong>{countdownValue}</strong>
                <i />
              </div>
            )}
            {phase === "pausing" && (
              <div className="game-overlay loading-overlay">
                <div className="loading-ring" />
                <b>HOLDING CLOCK</b>
              </div>
            )}
            {(phase === "paused" || phase === "resuming") && (
              <div className="game-overlay pause-overlay">
                <span className="overlay-index">// AUDIO TIMELINE FROZEN</span>
                <h2>PAUSED</h2>
                <p>
                  {autoPaused
                    ? "检测到页面失焦，已自动暂停；进行中的 Hold 不会因此失败。"
                    : "音频时钟与谱面位置已冻结。继续后请重新按住进行中的 Hold。"}
                </p>
                <button
                  type="button"
                  className="start-button compact"
                  onClick={() => void resumeGame()}
                  disabled={phase === "resuming"}
                >
                  <span>{phase === "resuming" ? "RESUMING…" : "CONTINUE"}</span>
                  <i>▶</i>
                </button>
                <div className="overlay-actions">
                  <button type="button" onClick={() => void startGame()}>
                    重新开始
                  </button>
                  <button type="button" onClick={() => setAbandonOpen(true)}>
                    放弃本局
                  </button>
                </div>
              </div>
            )}
            {phase === "results" && result && (
              <ResultPanel
                {...result}
                onReplay={() => void startGame()}
                onBack={() => {
                  setResult(null);
                  setGamePhase("idle");
                  updateClock({
                    rawTime: 0,
                    chartTime: 0,
                    frameTime: performance.now(),
                  });
                }}
              />
            )}
          </div>

          <div className="stage-footer">
            <span>
              INPUT <b>D F J K</b>
            </span>
            <span>
              OFFSET{" "}
              <b>
                {settings.audioOffsetMs >= 0 ? "+" : ""}
                {settings.audioOffsetMs}ms
              </b>
            </span>
            <span>
              SPEED <b>{settings.noteSpeed.toFixed(2)}×</b>
            </span>
          </div>
        </section>

        <aside className="side-card control-card" aria-label="歌曲与控制设置">
          <div className="card-heading">
            <span className="card-label">CONTROL DECK</span>
            <span className="tiny-index">02 / CONFIG</span>
          </div>
          <div className="track-card">
            <span className="track-number">NP / 001</span>
            <div className="track-art" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div>
              <h2>{DEMO_SONG.title}</h2>
              <p>{DEMO_SONG.artist}</p>
            </div>
            <div className="track-tags">
              <span>{DEMO_SONG.bpm} BPM</span>
              <span>
                {difficulty.toUpperCase()}{" "}
                {chart ? `LV.${chart.level}` : "ERROR"}
              </span>
            </div>
          </div>
          <DifficultySelector
            value={difficulty}
            levels={DIFFICULTY_LEVELS}
            disabled={isSettingsLocked}
            onChange={setDifficulty}
          />
          {selectedRecord && (
            <div className="best-record">
              <span>PERSONAL BEST</span>
              <b>{formatScore(selectedRecord.bestScore)}</b>
              <small>
                {selectedRecord.bestAccuracy.toFixed(2)}% ·{" "}
                {selectedRecord.bestGrade} RANK{" "}
                {selectedRecord.ap ? "· AP" : selectedRecord.fc ? "· FC" : ""}
              </small>
            </div>
          )}

          <div className="control-actions">
            {(phase === "idle" || phase === "results") && (
              <button
                className="deck-primary"
                type="button"
                onClick={() => void startGame()}
                disabled={!chart}
              >
                <span>{phase === "results" ? "REPLAY" : "START"}</span>
                <b>{phase === "results" ? "↻" : "▶"}</b>
              </button>
            )}
            {ACTIVE_PHASES.includes(phase) && (
              <button
                className="deck-primary"
                type="button"
                onClick={() => void pauseGame(false)}
              >
                <span>PAUSE</span>
                <b>Ⅱ</b>
              </button>
            )}
            {phase === "paused" && (
              <button
                className="deck-primary"
                type="button"
                onClick={() => void resumeGame()}
              >
                <span>CONTINUE</span>
                <b>▶</b>
              </button>
            )}
            {isBusy && (
              <button className="deck-primary" type="button" disabled>
                <span>PLEASE WAIT</span>
                <b>···</b>
              </button>
            )}
            {isSessionActive && (
              <div className="secondary-actions">
                <button
                  type="button"
                  onClick={() => void startGame()}
                  disabled={isBusy}
                >
                  重新开始
                </button>
                <button
                  type="button"
                  onClick={() => void requestAbandon()}
                  disabled={isBusy}
                >
                  放弃本局
                </button>
              </div>
            )}
          </div>

          <div className="settings-panel">
            <div className="settings-heading">
              <span>PLAY / SOUND SETTINGS</span>
              <button
                type="button"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
                disabled={isSettingsLocked}
              >
                RESET
              </button>
            </div>
            <label className="range-control">
              <span>
                <b>NOTE SPEED</b>
                <output>{settings.noteSpeed.toFixed(2)}×</output>
              </span>
              <input
                type="range"
                min={SETTINGS_LIMITS.noteSpeed.minimum}
                max={SETTINGS_LIMITS.noteSpeed.maximum}
                step="0.05"
                value={settings.noteSpeed}
                disabled={isSettingsLocked}
                onChange={(event) =>
                  updateSetting("noteSpeed", Number(event.target.value))
                }
              />
              <small>
                SLOWER <i /> FASTER
              </small>
            </label>
            <label className="range-control">
              <span>
                <b>AUDIO OFFSET</b>
                <output>
                  {settings.audioOffsetMs >= 0 ? "+" : ""}
                  {settings.audioOffsetMs}ms
                </output>
              </span>
              <input
                type="range"
                min={SETTINGS_LIMITS.audioOffsetMs.minimum}
                max={SETTINGS_LIMITS.audioOffsetMs.maximum}
                step="5"
                value={settings.audioOffsetMs}
                disabled={isSettingsLocked}
                onChange={(event) =>
                  updateSetting("audioOffsetMs", Number(event.target.value))
                }
              />
              <small>
                EARLIER <i /> LATER
              </small>
            </label>
            <p className="offset-help">
              正值让谱面/判定更晚，负值让它们更早；所有设置保存在当前设备。
            </p>
            {(
              [
                ["masterVolume", "MASTER"],
                ["musicVolume", "MUSIC"],
                ["hitVolume", "HIT SFX"],
              ] as const
            ).map(([key, label]) => (
              <label className="range-control volume-control" key={key}>
                <span>
                  <b>{label}</b>
                  <output>{Math.round(settings[key] * 100)}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings[key]}
                  onChange={(event) =>
                    updateSetting(key, Number(event.target.value))
                  }
                />
              </label>
            ))}
            <div className="sound-actions">
              <button
                type="button"
                className={settings.muted ? "is-muted" : ""}
                onClick={() => updateSetting("muted", !settings.muted)}
                aria-pressed={settings.muted}
              >
                {settings.muted ? "🔇 取消静音" : "🔊 静音"}
              </button>
              <button
                type="button"
                onClick={() => setCalibrationOpen(true)}
                disabled={isSettingsLocked}
              >
                16 拍延迟校准
              </button>
            </div>
          </div>

          <div className="utility-actions">
            <button type="button" onClick={() => void toggleFullscreen()}>
              {fullscreen ? "退出全屏" : "进入全屏"}
            </button>
          </div>
          <div className="keyboard-hint">
            {LANE_KEYS.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
            <span>键盘 / 鼠标 / 多点触控</span>
          </div>
        </aside>
      </section>

      <footer className="app-footer">
        <span>
          WEB AUDIO CLOCK / {RULESET.windowsMs.perfect}ms PERFECT WINDOW
        </span>
        <span>ESC TO PAUSE · ORIGINAL SYNTHESIS · NO EXTERNAL ASSETS</span>
      </footer>

      <ConfirmDialog
        open={abandonOpen}
        onCancel={() => setAbandonOpen(false)}
        onConfirm={() => finishGame("abandoned")}
      />
      <CalibrationPanel
        open={calibrationOpen}
        running={calibrationRunning}
        tappedBeats={calibrationTapCount}
        result={calibrationResult}
        currentOffsetMs={settings.audioOffsetMs}
        onClose={closeCalibration}
        onStart={() => void startCalibration()}
        onTap={recordCalibrationTap}
        onPreview={() => void getEngine().playCalibrationPreview()}
        onApply={(offsetMs) => {
          updateSetting("audioOffsetMs", offsetMs);
          setCalibrationOpen(false);
          engineRef.current?.stopAll();
        }}
      />
    </main>
  );
}
