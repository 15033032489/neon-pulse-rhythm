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
import { SONG_CATALOG, loadBuiltInChart } from "./charts";
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
  applyMissedNote,
  calculateAccuracy,
  calculateGrade,
  calculateRunFlags,
  createInitialStats,
  judgementCount,
  RULESET,
  summarizeTiming,
  type GameStats,
  type Grade,
  type Judgement,
  type RunFlags,
  type TimingSummary,
} from "./game/scoring";
import {
  calculateSessionScore,
  createRunSession,
  finalizeRun,
  type FinishReason,
  type RunSession,
} from "./game/session";
import {
  bindingLabel,
  bindingMap,
  DEFAULT_LANE_BINDINGS,
  DEFAULT_SETTINGS,
  isUsableBinding,
  loadSettings,
  saveSettings,
  SETTINGS_LIMITS,
  type GameSettings,
} from "./game/settings";
import {
  summarizeChart,
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
  songId: string;
  songTitle: string;
  difficulty: DifficultyId;
  noteCount: number;
  maxScoreUnits: number;
  reason: FinishReason;
  stats: GameStats;
  score: number;
  accuracy: number;
  grade: Grade;
  flags: RunFlags;
  timing: TimingSummary;
  newRecord: boolean;
  previousBestScore: number;
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

const DIFFICULTIES: DifficultyId[] = ["easy", "normal", "hard"];
const BUILT_IN_CHART_RESULTS = Object.fromEntries(
  SONG_CATALOG.map((song) => [
    song.id,
    Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [
        difficulty,
        loadBuiltInChart(song.id, difficulty),
      ]),
    ) as Record<DifficultyId, ReturnType<typeof loadBuiltInChart>>,
  ]),
) as Record<string, Record<DifficultyId, ReturnType<typeof loadBuiltInChart>>>;

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
const blocksGameplayInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], .dialog-backdrop, .settings-panel",
    ),
  );

export default function App() {
  const [menuSongId, setMenuSongId] = useState(SONG_CATALOG[0].id);
  const [menuDifficulty, setMenuDifficulty] = useState<DifficultyId>("normal");
  const selectedSong =
    SONG_CATALOG.find((song) => song.id === menuSongId) ?? SONG_CATALOG[0];
  const chartResults = BUILT_IN_CHART_RESULTS[menuSongId];
  const chartResult = chartResults[menuDifficulty];
  const chart = chartResult.ok ? chartResult.chart : null;
  const difficultyLevels = Object.fromEntries(
    DIFFICULTIES.map((value) => [
      value,
      chartResults[value].ok ? chartResults[value].chart.level : null,
    ]),
  ) as Record<DifficultyId, number | null>;
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
  const difficultyDetails = Object.fromEntries(
    DIFFICULTIES.map((value) => {
      const candidate = chartResults[value];
      return [
        value,
        candidate.ok
          ? {
              ...summarizeChart(candidate.chart),
              bestScore:
                records.entries[recordKey(menuSongId, value)]?.bestScore ?? 0,
            }
          : null,
      ];
    }),
  ) as Record<
    DifficultyId,
    (ReturnType<typeof summarizeChart> & { bestScore: number }) | null
  >;
  const [pressedLanes, setPressedLanes] = useState(emptyPressedLanes);
  const [effects, setEffects] = useState<HitEffect[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [session, setSession] = useState<RunSession | null>(null);
  const sessionRef = useRef<RunSession | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [noteTravelPixels, setNoteTravelPixels] = useState(0);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [bindingLane, setBindingLane] = useState<Lane | null>(null);
  const [comboMilestone, setComboMilestone] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [, setAudioStateRevision] = useState(0);

  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationTapCount, setCalibrationTapCount] = useState(0);
  const [calibrationResult, setCalibrationResult] =
    useState<CalibrationResult | null>(null);
  const calibrationRunningRef = useRef(false);
  const calibrationClockRef = useRef<CalibrationClock | null>(null);
  const calibrationSamplesRef = useRef<CalibrationSample[]>([]);
  const calibrationSeenBeatsRef = useRef(new Set<number>());
  const calibrationPreviewTimerRef = useRef<number | null>(null);

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
  const bindingMapRef = useRef(bindingMap(settings.laneBindings));
  const milestoneTimerRef = useRef<number | null>(null);
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
      if (bindingMapRef.current[code] === lane) return true;
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

  const returnToMenu = useCallback(
    (completedResult: RunResult | null) => {
      runIdRef.current += 1;
      if (completedResult) setLastResult(completedResult);
      sessionRef.current = null;
      setSession(null);
      runtimeRef.current = null;
      audioStartTimeRef.current = 0;
      const initialStats = createInitialStats();
      statsRef.current = initialStats;
      setStats(initialStats);
      setEffects([]);
      setResult(null);
      setAutoPaused(false);
      setAbandonOpen(false);
      setComboMilestone(null);
      setUiMessage(null);
      clearPressedInputs();
      if (milestoneTimerRef.current)
        window.clearTimeout(milestoneTimerRef.current);
      milestoneTimerRef.current = null;
      engineRef.current?.stopAll();
      void engineRef.current
        ?.suspend()
        .finally(() => setAudioStateRevision((revision) => revision + 1));
      updateClock({
        rawTime: 0,
        chartTime: 0,
        frameTime: performance.now(),
      });
      setGamePhase("idle");
    },
    [clearPressedInputs, setGamePhase, updateClock],
  );

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
      const currentSession = sessionRef.current;
      if (!currentSession) return;
      runIdRef.current += 1;
      const finalized = finalizeRun(
        statsRef.current,
        runtimeRef.current?.getRemainingSummary() ?? {
          noteCount: 0,
          scoreUnits: 0,
        },
        reason,
      );
      statsRef.current = finalized.stats;
      setStats(finalized.stats);
      const accuracy = calculateAccuracy(
        finalized.stats,
        currentSession.maxScoreUnits,
      );
      const score = calculateSessionScore(finalized.stats, currentSession);
      const grade = calculateGrade(accuracy);
      const flags = calculateRunFlags(
        finalized.stats,
        currentSession.noteCount,
        currentSession.maxScoreUnits,
      );
      let newRecord = false;
      const previousBestScore =
        recordsRef.current.entries[
          recordKey(currentSession.songId, currentSession.difficulty)
        ]?.bestScore ?? 0;

      if (finalized.shouldPersist) {
        const merged = mergeRecord(
          recordsRef.current,
          currentSession.songId,
          currentSession.difficulty,
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
        songId: currentSession.songId,
        songTitle: currentSession.songTitle,
        difficulty: currentSession.difficulty,
        noteCount: currentSession.noteCount,
        maxScoreUnits: currentSession.maxScoreUnits,
        reason,
        stats: finalized.stats,
        score,
        accuracy,
        grade,
        flags,
        timing: summarizeTiming(finalized.stats.timingOffsetsMs),
        newRecord,
        previousBestScore,
      });
      setAbandonOpen(false);
      clearPressedInputs();
      engineRef.current?.stopAll();
      void engineRef.current
        ?.suspend()
        .finally(() => setAudioStateRevision((revision) => revision + 1));
      setGamePhase("results");
    },
    [clearPressedInputs, setGamePhase],
  );

  const commitRuntimeEvents = useCallback(
    (events: RuntimeEvent[]) => {
      if (!events.length) return;
      let next = statsRef.current;
      const previousCombo = statsRef.current.combo;
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
          if (
            settingsRef.current.haptics &&
            !reducedMotion &&
            typeof navigator.vibrate === "function"
          ) {
            navigator.vibrate(event.judgement === "perfect" ? 10 : 6);
          }
        } else if (event.kind === "miss") {
          next = applyMissedNote(next, event.scoreUnits);
          addEffect(
            event.note.lane,
            "miss",
            event.note.type === "hold" ? "HOLD MISS" : "MISS",
            null,
          );
          engineRef.current?.playMiss(event.note.lane);
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
          engineRef.current?.playMiss(event.note.lane);
        } else {
          addEffect(event.note.lane, "great", "HOLD REGRAB", null);
        }
      }
      statsRef.current = next;
      setStats(next);
      if (next.combo !== previousCombo && [50, 100, 200].includes(next.combo)) {
        setComboMilestone(next.combo);
        if (milestoneTimerRef.current)
          window.clearTimeout(milestoneTimerRef.current);
        milestoneTimerRef.current = window.setTimeout(
          () => setComboMilestone(null),
          900,
        );
      }
      if (next.life <= 0) finishGame("failed");
    },
    [addEffect, finishGame, reducedMotion],
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

  const startGame = useCallback(
    async (requestedChart?: LoadedChart) => {
      const currentChart = requestedChart ?? chart;
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
      const nextSession = createRunSession(currentChart);
      sessionRef.current = nextSession;
      setSession(nextSession);
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
    },
    [
      chart,
      chartResult,
      clearPressedInputs,
      getEngine,
      readAudioClock,
      setGamePhase,
      updateClock,
    ],
  );

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
    setCalibrationTapCount(
      calibrationSamplesRef.current.filter(
        (sample) => sample.beatIndex >= calibrationClock.warmupBeats,
      ).length,
    );
  }, []);

  const startCalibration = useCallback(async () => {
    try {
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      calibrationSamplesRef.current = [];
      calibrationSeenBeatsRef.current.clear();
      if (calibrationPreviewTimerRef.current)
        window.clearTimeout(calibrationPreviewTimerRef.current);
      calibrationPreviewTimerRef.current = null;
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
        medianDeviationMs: 0,
        message: error instanceof Error ? error.message : "无法启动校准音频。",
      });
    }
  }, [getEngine]);

  const stopCalibration = useCallback(async (closePanel: boolean) => {
    calibrationRunningRef.current = false;
    setCalibrationRunning(false);
    calibrationClockRef.current = null;
    calibrationSamplesRef.current = [];
    calibrationSeenBeatsRef.current.clear();
    setCalibrationTapCount(0);
    if (calibrationPreviewTimerRef.current)
      window.clearTimeout(calibrationPreviewTimerRef.current);
    calibrationPreviewTimerRef.current = null;
    engineRef.current?.stopAll();
    if (!FOCUS_PHASES.includes(phaseRef.current)) {
      try {
        await engineRef.current?.suspend();
        setAudioStateRevision((revision) => revision + 1);
      } catch {
        // Calibration cleanup must never block the menu.
      }
    }
    if (closePanel) {
      setCalibrationResult(null);
      setCalibrationOpen(false);
    }
  }, []);

  const closeCalibration = useCallback(() => {
    void stopCalibration(true);
  }, [stopCalibration]);

  const previewCalibration = useCallback(async () => {
    try {
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      await engine.playCalibrationPreview();
      if (calibrationPreviewTimerRef.current)
        window.clearTimeout(calibrationPreviewTimerRef.current);
      calibrationPreviewTimerRef.current = window.setTimeout(() => {
        engine.stopAll();
        void engine
          .suspend()
          .finally(() => setAudioStateRevision((revision) => revision + 1));
        calibrationPreviewTimerRef.current = null;
        setCalibrationRunning(false);
      }, 2300);
    } catch (error) {
      setCalibrationResult({
        ok: false,
        recommendedOffsetMs: 0,
        acceptedSamples: [],
        ignoredCount: 0,
        medianDeviationMs: 0,
        message: error instanceof Error ? error.message : "无法播放试听节拍。",
      });
    }
  }, [getEngine]);

  useEffect(() => {
    settingsRef.current = settings;
    bindingMapRef.current = bindingMap(settings.laneBindings);
    saveSettings(settings);
    engineRef.current?.setVolumes(settings);
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
            nextClock.rawTime >=
              (sessionRef.current?.chart.song.duration ?? 0) + 0.25)
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
        const analyzed = analyzeCalibration(calibrationSamplesRef.current);
        calibrationRunningRef.current = false;
        setCalibrationRunning(false);
        calibrationClockRef.current = null;
        engine.stopAll();
        void engine
          .suspend()
          .finally(() => setAudioStateRevision((revision) => revision + 1));
        setCalibrationResult(analyzed);
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
      if (bindingLane !== null) {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.code === "Escape") {
          setBindingLane(null);
          return;
        }
        if (!isUsableBinding(event.code)) {
          setUiMessage("该按键保留给界面操作，请选择其他按键。");
          return;
        }
        const conflict = settingsRef.current.laneBindings.findIndex(
          (code, lane) => code === event.code && lane !== bindingLane,
        );
        if (conflict >= 0) {
          setUiMessage(
            `${bindingLabel(event.code)} 已用于第 ${conflict + 1} 轨，不能重复。`,
          );
          return;
        }
        const nextBindings = [
          ...settingsRef.current.laneBindings,
        ] as GameSettings["laneBindings"];
        nextBindings[bindingLane] = event.code;
        updateSetting("laneBindings", nextBindings);
        setBindingLane(null);
        return;
      }
      if (calibrationOpen) {
        if (
          !event.repeat &&
          (event.code === "Space" ||
            bindingMapRef.current[event.code] !== undefined)
        ) {
          event.preventDefault();
          recordCalibrationTap();
        }
        if (event.code === "Escape" && !event.repeat) closeCalibration();
        return;
      }
      if (blocksGameplayInput(event.target)) return;
      if (event.code === "Escape" && !event.repeat) {
        if (abandonOpen) setAbandonOpen(false);
        else if (ACTIVE_PHASES.includes(phaseRef.current))
          void pauseGame(false);
        return;
      }
      if (abandonOpen) return;
      const lane = bindingMapRef.current[event.code];
      if (lane === undefined) return;
      event.preventDefault();
      if (event.repeat || pressedCodesRef.current.has(event.code)) return;
      pressedCodesRef.current.add(event.code);
      refreshPressedLanes();
      pressLane(lane);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const lane = bindingMapRef.current[event.code];
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
    bindingLane,
    calibrationOpen,
    closeCalibration,
    pauseGame,
    pressLane,
    recordCalibrationTap,
    refreshPressedLanes,
    releaseLane,
  ]);

  useEffect(
    () => () => {
      if (milestoneTimerRef.current)
        window.clearTimeout(milestoneTimerRef.current);
      if (calibrationPreviewTimerRef.current)
        window.clearTimeout(calibrationPreviewTimerRef.current);
      calibrationRunningRef.current = false;
      calibrationClockRef.current = null;
      calibrationSamplesRef.current = [];
      calibrationSeenBeatsRef.current.clear();
      engineRef.current?.dispose();
    },
    [],
  );

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
  const visualChartTime = clock.rawTime - settings.visualOffsetMs / 1000;
  const visibleNotes = useMemo(() => {
    if (!runtimeRef.current || phase === "idle" || phase === "results")
      return [];
    return runtimeRef.current.visible(visualChartTime, approachSeconds);
  }, [approachSeconds, phase, stats.judgedNotes, visualChartTime]);

  const liveAccuracy = session ? calculateAccuracy(stats) : 100;
  const liveScore = session ? calculateSessionScore(stats, session) : 0;
  const progress = session
    ? clamp(clock.rawTime / session.chart.song.duration, 0, 1)
    : 0;
  const latestEffect = effects.at(-1);
  const countdownValue = clock.rawTime > -1 ? 1 : clock.rawTime > -2 ? 2 : 3;
  const isBusy = ["starting", "pausing", "resuming"].includes(phase);
  const isSettingsLocked = FOCUS_PHASES.includes(phase);
  const isSessionActive = phase !== "idle" && phase !== "results";
  const audioState = engineRef.current?.getState() ?? "uninitialized";
  const selectedRecord = chart
    ? records.entries[recordKey(chart.song.id, chart.difficulty)]
    : undefined;
  const displayedResult = phase === "results" ? result : lastResult;
  const panelStats = displayedResult?.stats ?? stats;
  const panelScore = displayedResult?.score ?? liveScore;
  const panelAccuracy = displayedResult?.accuracy ?? liveAccuracy;
  const panelMode = displayedResult && !isSessionActive ? "last" : "live";
  const stageSong = session?.chart.song ?? selectedSong;
  const stageDifficulty = session?.difficulty ?? menuDifficulty;

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
            1 - (note.time - visualChartTime) / approachSeconds,
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
      1 - (note.time + note.duration - visualChartTime) / approachSeconds,
      -0.08,
      1.08,
    );
    const holdLength = Math.max(
      24,
      (headProgress - tailProgress) * noteTravelPixels,
    );
    const holdEnding =
      state === "holding" &&
      note.time + note.duration - visualChartTime <= 0.45;
    return (
      <div
        className={`falling-note is-hold ${state === "holding" ? "is-held" : ""} ${holdEnding ? "is-ending" : ""}`}
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
          <span>
            {calibrationOpen
              ? calibrationRunning
                ? "CALIBRATING"
                : "CALIBRATION READY"
              : PHASE_LABELS[phase]}
          </span>
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
        <aside
          className="side-card stats-card"
          aria-label={panelMode === "live" ? "实时成绩" : "上一局结果"}
        >
          <div className="card-heading">
            <span className="card-label">
              {panelMode === "live" ? "实时数据" : "上一局结果"}
            </span>
            <span className="tiny-index">
              {displayedResult
                ? `${displayedResult.songTitle} · ${displayedResult.difficulty.toUpperCase()}`
                : "等待开始"}
            </span>
          </div>
          <div className="score-block">
            <span>SCORE / 1M</span>
            <strong data-testid="score">{formatScore(panelScore)}</strong>
          </div>
          <div className="primary-stats">
            <div>
              <span>COMBO</span>
              <strong data-testid="combo">{panelStats.combo}</strong>
            </div>
            <div>
              <span>MAX COMBO</span>
              <strong>{panelStats.maxCombo}</strong>
            </div>
            <div>
              <span>ACCURACY</span>
              <strong>{panelAccuracy.toFixed(2)}%</strong>
            </div>
          </div>
          <div className="life-readout">
            <div>
              <span>SIGNAL / LIFE</span>
              <b>{panelStats.life}%</b>
            </div>
            <div
              className="life-track"
              role="meter"
              aria-label="生命值"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={panelStats.life}
            >
              <span style={{ width: `${panelStats.life}%` }} />
            </div>
          </div>
          <div className="judgement-list" aria-label="判定统计">
            {(["perfect", "great", "good", "miss"] as Judgement[]).map(
              (judgement) => (
                <div key={judgement} className={`count-${judgement}`}>
                  <span>{judgement.toUpperCase()}</span>
                  <b>{String(panelStats.counts[judgement]).padStart(2, "0")}</b>
                </div>
              ),
            )}
          </div>
          <div className="hold-readout">
            <span>
              HOLD COMPLETE <b>{panelStats.holdCompleted}</b>
            </span>
            <span>
              BREAK <b>{panelStats.holdBroken}</b>
            </span>
            <span>
              主判定 <b>{judgementCount(panelStats)}</b>
              {displayedResult ? ` / ${displayedResult.noteCount}` : ""}
            </span>
          </div>
          {panelMode === "live" && (
            <div className="time-readout">
              <span>{formatTime(clock.rawTime)}</span>
              <i>
                <b style={{ transform: `scaleX(${progress})` }} />
              </i>
              <span>{formatTime(session?.chart.song.duration ?? 0)}</span>
            </div>
          )}
        </aside>

        <section
          className={`stage-card ${
            settings.screenShake &&
            settings.effectIntensity > 0 &&
            !reducedMotion &&
            latestEffect &&
            clock.frameTime - latestEffect.bornAt < 180
              ? `shake-${latestEffect.judgement}`
              : ""
          }`}
          style={
            { "--effect-intensity": settings.effectIntensity } as CSSProperties
          }
          aria-label="演奏区域"
        >
          <div className="stage-topline">
            <div>
              <span>NOW PLAYING</span>
              <b>
                {stageSong.title} · {stageDifficulty.toUpperCase()}
              </b>
            </div>
            <div className="stage-live-stats">
              <span>
                SCORE <b>{formatScore(liveScore)}</b>
              </span>
              <span>
                ACC <b>{liveAccuracy.toFixed(1)}%</b>
              </span>
              <span className={stats.life < 30 ? "is-low-life" : ""}>
                LIFE <b>{stats.life}%</b>
              </span>
              <span>
                {stageDifficulty.toUpperCase()} · {Math.round(progress * 100)}%
              </span>
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
            {settings.laneBindings.map((code, laneIndex) => {
              const lane = laneIndex as Lane;
              const key = bindingLabel(code);
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

            {FOCUS_PHASES.includes(phase) && (
              <div
                className={`combo-hud ${stats.combo === 0 ? "is-zero" : ""} ${comboMilestone ? "is-milestone" : ""}`}
                aria-live="polite"
              >
                <strong>{stats.combo}</strong>
                <span>
                  {comboMilestone ? `${comboMilestone} MILESTONE` : "COMBO"}
                </span>
              </div>
            )}

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
                  {selectedSong.title.split(" ")[0].toUpperCase()}
                  <br />
                  <em>
                    {selectedSong.title
                      .split(" ")
                      .slice(1)
                      .join(" ")
                      .toUpperCase()}
                  </em>
                </h2>
                <p>{selectedSong.subtitle}</p>
                {chart && (
                  <div className="intro-specs">
                    <span>
                      <b>{chart.song.bpm}</b> BPM
                    </span>
                    <span>
                      <b>{chart.noteCount}</b> 音符
                    </span>
                    <span>
                      <b>LV.{chart.level}</b> {menuDifficulty.toUpperCase()}
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
                <small>在歌曲面板选择曲目与难度，然后开始演奏</small>
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
                onReplay={() => {
                  const replay = loadBuiltInChart(
                    result.songId,
                    result.difficulty,
                  );
                  if (replay.ok) {
                    setMenuSongId(result.songId);
                    setMenuDifficulty(result.difficulty);
                    void startGame(replay.chart);
                  }
                }}
                onBack={() => returnToMenu(result)}
              />
            )}
          </div>

          <div className="stage-footer">
            <span>
              INPUT <b>{settings.laneBindings.map(bindingLabel).join(" ")}</b>
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
            <span>
              VISUAL{" "}
              <b>
                {settings.visualOffsetMs >= 0 ? "+" : ""}
                {settings.visualOffsetMs}ms
              </b>
            </span>
          </div>
        </section>

        <aside className="side-card control-card" aria-label="歌曲与控制设置">
          <div className="card-heading">
            <span className="card-label">CONTROL DECK</span>
            <span className="tiny-index">02 / CONFIG</span>
          </div>
          <div className="song-selector" aria-label="选择歌曲">
            {SONG_CATALOG.map((song, index) => (
              <button
                type="button"
                className={song.id === menuSongId ? "is-selected" : ""}
                onClick={() => setMenuSongId(song.id)}
                disabled={isSettingsLocked}
                aria-pressed={song.id === menuSongId}
                key={song.id}
              >
                <span
                  className={`song-art art-${song.accent}`}
                  aria-hidden="true"
                >
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <small>NP / {String(index + 1).padStart(3, "0")}</small>
                  <b>{song.title}</b>
                  <em>{song.artist}</em>
                </span>
                <span className="song-meta">
                  {song.bpm} BPM · {formatTime(song.duration)}
                </span>
              </button>
            ))}
          </div>
          <div className="track-card selected-track-summary">
            <span className="track-number">SELECTED TRACK</span>
            <div>
              <h2>{selectedSong.title}</h2>
              <p>{selectedSong.subtitle}</p>
            </div>
            <div className="track-tags">
              <span>{selectedSong.bpm} BPM</span>
              <span>{formatTime(selectedSong.duration)}</span>
              <span>
                {menuDifficulty.toUpperCase()}{" "}
                {chart ? `LV.${chart.level}` : "ERROR"}
              </span>
            </div>
          </div>
          <DifficultySelector
            value={menuDifficulty}
            levels={difficultyLevels}
            details={difficultyDetails}
            disabled={isSettingsLocked}
            onChange={setMenuDifficulty}
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
              <span>演奏与声音设置</span>
              <button
                type="button"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
                disabled={isSettingsLocked}
              >
                全部重置
              </button>
            </div>
            <label className="range-control">
              <span>
                <b>音符速度</b>
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
                慢 <i /> 快
              </small>
            </label>
            <label className="range-control">
              <span>
                <b>判定偏移</b>
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
                更早 <i /> 更晚
              </small>
            </label>
            <label className="range-control">
              <span>
                <b>视觉偏移</b>
                <output>
                  {settings.visualOffsetMs >= 0 ? "+" : ""}
                  {settings.visualOffsetMs}ms
                </output>
              </span>
              <input
                type="range"
                min={SETTINGS_LIMITS.visualOffsetMs.minimum}
                max={SETTINGS_LIMITS.visualOffsetMs.maximum}
                step="5"
                value={settings.visualOffsetMs}
                disabled={isSettingsLocked}
                onChange={(event) =>
                  updateSetting("visualOffsetMs", Number(event.target.value))
                }
              />
              <small>
                更早显示 <i /> 更晚显示
              </small>
            </label>
            <p className="offset-help">
              判定偏移只改变按键时机，视觉偏移只改变音符位置。正值更晚，负值更早。
            </p>
            {(
              [
                ["masterVolume", "主音量"],
                ["musicVolume", "音乐音量"],
                ["hitVolume", "打击音量"],
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
            <label className="range-control volume-control">
              <span>
                <b>特效强度</b>
                <output>{Math.round(settings.effectIntensity * 100)}%</output>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.effectIntensity}
                onChange={(event) =>
                  updateSetting("effectIntensity", Number(event.target.value))
                }
              />
            </label>
            <div className="toggle-grid">
              <button
                type="button"
                className={settings.screenShake ? "is-on" : ""}
                onClick={() =>
                  updateSetting("screenShake", !settings.screenShake)
                }
                aria-pressed={settings.screenShake}
              >
                轻微震屏 {settings.screenShake ? "开" : "关"}
              </button>
              <button
                type="button"
                className={settings.haptics ? "is-on" : ""}
                onClick={() => updateSetting("haptics", !settings.haptics)}
                aria-pressed={settings.haptics}
              >
                触觉反馈 {settings.haptics ? "开" : "关"}
              </button>
            </div>
            <div className="key-settings" aria-label="自定义键位">
              <div>
                <b>四轨键位</b>
                <button
                  type="button"
                  onClick={() =>
                    updateSetting("laneBindings", [...DEFAULT_LANE_BINDINGS])
                  }
                  disabled={isSettingsLocked}
                >
                  恢复 D/F/J/K
                </button>
              </div>
              <div className="key-binding-grid">
                {settings.laneBindings.map((code, laneIndex) => {
                  const lane = laneIndex as Lane;
                  return (
                    <button
                      type="button"
                      className={bindingLane === lane ? "is-listening" : ""}
                      onClick={() => setBindingLane(lane)}
                      disabled={isSettingsLocked}
                      aria-label={`设置第 ${lane + 1} 轨按键，当前 ${bindingLabel(code)}`}
                      key={lane}
                    >
                      <small>轨道 {lane + 1}</small>
                      <kbd>
                        {bindingLane === lane ? "…" : bindingLabel(code)}
                      </kbd>
                    </button>
                  );
                })}
              </div>
              {bindingLane !== null && (
                <p role="status">
                  请按下第 {bindingLane + 1} 轨的新按键；Esc 取消。
                </p>
              )}
            </div>
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
                4 预热拍 + 16 样本校准
              </button>
            </div>
          </div>

          <div className="utility-actions">
            <button type="button" onClick={() => void toggleFullscreen()}>
              {fullscreen ? "退出全屏" : "进入全屏"}
            </button>
          </div>
          <div className="keyboard-hint">
            {settings.laneBindings.map((code, lane) => (
              <kbd key={lane}>{bindingLabel(code)}</kbd>
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
        onPreview={() => void previewCalibration()}
        onApply={(offsetMs) => {
          updateSetting("audioOffsetMs", offsetMs);
          void stopCalibration(true);
        }}
      />
    </main>
  );
}
