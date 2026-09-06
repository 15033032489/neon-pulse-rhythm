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
import { createPortal } from "react-dom";
import { SynthEngine, type CalibrationClock } from "./audio/SynthEngine";
import {
  LocalAudioImportError,
  LocalAudioLibrary,
  validateLocalAudioDuration,
  type DurationValidation,
} from "./audio/LocalAudioLibrary";
import { CalibrationPanel } from "./components/CalibrationPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DifficultySelector } from "./components/DifficultySelector";
import { ResultPanel } from "./components/ResultPanel";
import { TutorialPanel } from "./components/TutorialPanel";
import { SONG_CATALOG, loadBuiltInChart } from "./charts";
import { validateBuiltInCatalog } from "./charts/validateCatalog";
import {
  analyzeCalibration,
  type CalibrationResult,
  type CalibrationSample,
} from "./game/calibration";
import { ChartRuntime, type RuntimeEvent } from "./game/chartRuntime";
import { AudioActivityController } from "./game/audioActivity";
import {
  deriveProductDisplayState,
  formatClockTime,
} from "./game/displayState";
import {
  loadRecords,
  mergeRecord,
  recordKey,
  saveRecords,
  type RecordBook,
} from "./game/records";
import {
  loadLocalSongPreferences,
  saveLocalSongPreferences,
  updateLocalSongPreference,
  type LocalSongPreferenceBook,
} from "./game/localSongPreferences";
import {
  loadSelection,
  saveSelection,
  SELECTION_VERSION,
} from "./game/selection";
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
  shouldFailRun,
  shouldPersistRun,
  type FinishReason,
  type PlayMode,
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
  loadTutorialCompleted,
  saveTutorialCompleted,
  tutorialStepAfterNext,
} from "./game/tutorial";
import {
  summarizeChart,
  type ChartNote,
  type DifficultyId,
  type Lane,
  type LoadedChart,
  type SongCategory,
} from "./game/types";
import { getMandopopTemplate } from "./songs/mandopopTemplates";

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
  songEnglishTitle?: string;
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
  mode: PlayMode;
  audioVersion?: string;
}

interface LocalAudioUiState {
  status: "missing" | "loading" | "ready" | "error";
  fileName?: string;
  duration?: number;
  validation?: DurationValidation;
  message?: string;
}

type NoteStyle = CSSProperties & {
  "--note-y": string;
  "--hold-length"?: string;
};
type LaneStyle = CSSProperties & { "--lane-index": number };
type ControlTab = "gameplay" | "sound" | "keys";

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
const SONG_IDS = SONG_CATALOG.map((song) => song.id);
const CONTROL_TABS: Array<{ id: ControlTab; label: string }> = [
  { id: "gameplay", label: "玩法" },
  { id: "sound", label: "声音" },
  { id: "keys", label: "键位" },
];
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

if (import.meta.env.DEV) {
  const catalogErrors = validateBuiltInCatalog();
  if (catalogErrors.length)
    console.error(`内置谱面验证失败：\n${catalogErrors.join("\n")}`);
}

const emptyPressedLanes = (): [boolean, boolean, boolean, boolean] => [
  false,
  false,
  false,
  false,
];
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const formatScore = (score: number) => score.toString().padStart(7, "0");
const signedMilliseconds = (value: number) =>
  `${value > 0 ? "正 " : value < 0 ? "负 " : ""}${Math.abs(value)} 毫秒`;
const difficultyFeatures = (
  difficulty: DifficultyId,
  summary: ReturnType<typeof summarizeChart>,
): string[] => {
  const features = [
    difficulty === "easy" ? "入门" : difficulty === "normal" ? "进阶" : "挑战",
  ];
  if (summary.longestAlternation >= 8) features.push("快速换手");
  if (summary.chordRatio >= 0.12) features.push("双押较多");
  if (summary.notesDuringHolds >= 4) features.push("长按复合");
  if (summary.peakNps >= 8 && features.length < 3) features.push("高密度");
  return features.slice(0, 3);
};
const songBpmLabel = (song: (typeof SONG_CATALOG)[number]) =>
  song.audioMode === "local-import" ? "待测" : String(song.bpm);
const songDurationLabel = (
  song: (typeof SONG_CATALOG)[number],
  importedDuration?: number,
) =>
  importedDuration
    ? formatClockTime(importedDuration)
    : song.audioMode === "local-import"
      ? "待测"
      : formatClockTime(song.duration);
const blocksGameplayInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], .dialog-backdrop, .settings-panel",
    ),
  );

export default function App() {
  const [initialSelection] = useState(() => loadSelection(SONG_IDS));
  const [songCategory, setSongCategory] = useState<SongCategory>(
    () =>
      SONG_CATALOG.find((song) => song.id === initialSelection.songId)
        ?.category ?? "original",
  );
  const [menuSongId, setMenuSongId] = useState(initialSelection.songId);
  const [menuDifficulty, setMenuDifficulty] = useState<DifficultyId>(
    initialSelection.difficulty,
  );
  const [playMode, setPlayMode] = useState<PlayMode>("standard");
  const selectedSong =
    SONG_CATALOG.find((song) => song.id === menuSongId) ?? SONG_CATALOG[0];
  const visibleSongs = SONG_CATALOG.filter(
    (song) => song.category === songCategory,
  );
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
  const [localSongPreferences, setLocalSongPreferences] =
    useState<LocalSongPreferenceBook>(() => loadLocalSongPreferences());
  const [localAudioUi, setLocalAudioUi] = useState<
    Record<string, LocalAudioUiState>
  >({});
  const localAudioLibraryRef = useRef<LocalAudioLibrary | null>(null);
  if (!localAudioLibraryRef.current)
    localAudioLibraryRef.current = new LocalAudioLibrary(2);
  const selectedLocalTemplate = getMandopopTemplate(menuSongId);
  const selectedLocalPreference =
    localSongPreferences.entries[menuSongId] ?? null;
  const selectedLocalAudio = localAudioUi[menuSongId] ?? {
    status: "missing" as const,
  };
  const draftDifficultyDetails = selectedLocalTemplate
    ? (Object.fromEntries(
        DIFFICULTIES.map((difficulty) => [
          difficulty,
          {
            status: "draft" as const,
            description: selectedLocalTemplate.charts[difficulty].description,
          },
        ]),
      ) as Record<DifficultyId, { status: "draft"; description: string }>)
    : undefined;
  const difficultyDetails = Object.fromEntries(
    DIFFICULTIES.map((value) => {
      const candidate = chartResults[value];
      return [
        value,
        candidate.ok
          ? (() => {
              const summary = summarizeChart(candidate.chart);
              return {
                ...summary,
                description: candidate.chart.description,
                bestScore:
                  records.entries[
                    recordKey(
                      menuSongId,
                      value,
                      selectedSong.audioMode === "local-import"
                        ? selectedLocalPreference?.audioVersion
                        : null,
                    )
                  ]?.bestScore ?? 0,
                features: difficultyFeatures(value, summary),
              };
            })()
          : null,
      ];
    }),
  ) as Record<
    DifficultyId,
    | (ReturnType<typeof summarizeChart> & {
        bestScore: number;
        description: string;
        features: string[];
      })
    | null
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
  const [comboBreak, setComboBreak] = useState(false);
  const [activeControlTab, setActiveControlTab] =
    useState<ControlTab>("gameplay");
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [compactControls, setCompactControls] = useState(
    () => window.matchMedia("(max-width: 920px)").matches,
  );
  const [previewSongId, setPreviewSongId] = useState<string | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(
    () => !loadTutorialCompleted(),
  );
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialActionComplete, setTutorialActionComplete] = useState(false);
  const [tutorialBeatPlaying, setTutorialBeatPlaying] = useState(false);
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
  const previewTimerRef = useRef<number | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewRequestRef = useRef(0);
  const tutorialTimerRef = useRef<number | null>(null);
  const tutorialHoldStartedRef = useRef<number | null>(null);
  const auxiliaryAudioRef = useRef(new AudioActivityController());
  const localImportRequestRef = useRef(new Map<string, number>());

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
  const comboBreakTimerRef = useRef<number | null>(null);
  const controlTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
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

  const updateLocalPreference = useCallback(
    (
      songId: string,
      update: Parameters<typeof updateLocalSongPreference>[2],
    ) => {
      setLocalSongPreferences((current) => {
        const next = updateLocalSongPreference(current, songId, update);
        saveLocalSongPreferences(next);
        return next;
      });
    },
    [],
  );

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
      setComboBreak(false);
      setUiMessage(null);
      clearPressedInputs();
      if (milestoneTimerRef.current)
        window.clearTimeout(milestoneTimerRef.current);
      milestoneTimerRef.current = null;
      if (comboBreakTimerRef.current)
        window.clearTimeout(comboBreakTimerRef.current);
      comboBreakTimerRef.current = null;
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
      chartTime:
        rawTime -
        (sessionRef.current?.audioOffsetMs ??
          settingsRef.current.audioOffsetMs) /
          1000,
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
          recordKey(
            currentSession.songId,
            currentSession.difficulty,
            currentSession.audioVersion,
          )
        ]?.bestScore ?? 0;

      if (shouldPersistRun(currentSession, finalized)) {
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
            cleared: reason === "complete",
          },
          undefined,
          currentSession.audioVersion,
        );
        recordsRef.current = merged.book;
        setRecords(merged.book);
        saveRecords(merged.book);
        newRecord = merged.newRecord;
      }

      setResult({
        songId: currentSession.songId,
        songTitle: currentSession.songTitle,
        songEnglishTitle: currentSession.songEnglishTitle,
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
        mode: currentSession.mode,
        audioVersion: currentSession.audioVersion,
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
      if (previousCombo > 0 && next.combo === 0) {
        setComboBreak(true);
        if (comboBreakTimerRef.current)
          window.clearTimeout(comboBreakTimerRef.current);
        comboBreakTimerRef.current = window.setTimeout(
          () => setComboBreak(false),
          720,
        );
      }
      const mode = sessionRef.current?.mode ?? "standard";
      if (shouldFailRun(next.life, mode)) finishGame("failed");
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
    async (requestedChart?: LoadedChart, requestedMode?: PlayMode) => {
      auxiliaryAudioRef.current.stop();
      setPreviewSongId(null);
      setTutorialOpen(false);
      setSettingsDrawerOpen(false);
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
      const nextSession = createRunSession(
        currentChart,
        requestedMode ?? playMode,
        currentChart.song.audioMode === "local-import"
          ? localSongPreferences.entries[currentChart.song.id]?.audioVersion
          : undefined,
        currentChart.song.audioMode === "local-import"
          ? (localSongPreferences.entries[currentChart.song.id]?.userOffsetMs ??
              0)
          : undefined,
      );
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
      updateClock({
        rawTime: -3.12,
        chartTime:
          -3.12 -
          (nextSession.audioOffsetMs ?? settingsRef.current.audioOffsetMs) /
            1000,
        frameTime: performance.now(),
      });

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
      playMode,
      readAudioClock,
      setGamePhase,
      localSongPreferences.entries,
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
    if (
      selectedSong.audioMode === "local-import" &&
      !localAudioLibraryRef.current?.has(selectedSong.id)
    ) {
      setCalibrationResult({
        ok: false,
        recommendedOffsetMs: 0,
        acceptedSamples: [],
        ignoredCount: 0,
        medianDeviationMs: 0,
        message: "请先选择本地音频，再为这首歌保存独立偏移。",
      });
      return;
    }
    try {
      auxiliaryAudioRef.current.stop();
      setPreviewSongId(null);
      setTutorialOpen(false);
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
      auxiliaryAudioRef.current.start("calibration", () => engine.stopAll());
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
  }, [getEngine, selectedSong.audioMode, selectedSong.id]);

  const stopCalibration = useCallback(async (closePanel: boolean) => {
    auxiliaryAudioRef.current.stop("calibration");
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
      auxiliaryAudioRef.current.stop();
      setPreviewSongId(null);
      setTutorialOpen(false);
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      await engine.playCalibrationPreview();
      auxiliaryAudioRef.current.start("calibration", () => engine.stopAll());
      if (calibrationPreviewTimerRef.current)
        window.clearTimeout(calibrationPreviewTimerRef.current);
      calibrationPreviewTimerRef.current = window.setTimeout(() => {
        auxiliaryAudioRef.current.stop("calibration");
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

  const stopSongPreview = useCallback(() => {
    const stopped = auxiliaryAudioRef.current.stop("preview");
    previewRequestRef.current += 1;
    if (!stopped) {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
      if (previewFrameRef.current)
        cancelAnimationFrame(previewFrameRef.current);
      previewTimerRef.current = null;
      previewFrameRef.current = null;
      setPreviewSongId(null);
    }
  }, []);

  const clearLocalAudio = useCallback(
    (songId: string) => {
      if (previewSongId === songId) stopSongPreview();
      localAudioLibraryRef.current?.clear(songId);
      setLocalAudioUi((current) => ({
        ...current,
        [songId]: {
          status: "missing",
          message: "本地文件访问已释放；需要时请重新选择。",
        },
      }));
    },
    [previewSongId, stopSongPreview],
  );

  const importLocalAudio = useCallback(
    async (songId: string, file: File) => {
      const song = SONG_CATALOG.find((candidate) => candidate.id === songId);
      if (!song || song.audioMode !== "local-import") return;
      stopSongPreview();
      const requestId = (localImportRequestRef.current.get(songId) ?? 0) + 1;
      localImportRequestRef.current.set(songId, requestId);
      setLocalAudioUi((current) => ({
        ...current,
        [songId]: { status: "loading", message: "正在浏览器内解码…" },
      }));
      setAudioError(null);
      try {
        const engine = getEngine();
        const imported = await localAudioLibraryRef.current?.importFile(
          songId,
          file,
          (data) => engine.decodeLocalAudio(data),
        );
        if (
          !imported ||
          localImportRequestRef.current.get(songId) !== requestId
        )
          return;
        const validation = validateLocalAudioDuration(
          imported.asset.duration,
          song.expectedDuration,
        );
        setLocalAudioUi((current) => {
          const next = { ...current };
          for (const evictedSongId of imported.evictedSongIds)
            next[evictedSongId] = {
              status: "missing",
              message: "为控制内存占用，较早导入的音频已释放，请重新选择。",
            };
          next[songId] = {
            status: "ready",
            fileName: imported.asset.fileName,
            duration: imported.asset.duration,
            validation,
            message: validation.message,
          };
          return next;
        });
        updateLocalPreference(songId, {
          audioVersion: song.audioVersion ?? "玩家本地合法副本 · 版本待核验",
          lastDecodedDuration: imported.asset.duration,
        });
        setUiMessage(
          "音频已在本机内存中解码；没有上传任何文件。可先试听并校准。 ",
        );
      } catch (error) {
        if (
          error instanceof LocalAudioImportError &&
          error.code === "cancelled"
        )
          return;
        const message =
          error instanceof Error
            ? error.message
            : "无法读取本地音频，请检查文件格式。";
        setLocalAudioUi((current) => ({
          ...current,
          [songId]: { status: "error", message },
        }));
        setAudioError(message);
      }
    },
    [getEngine, stopSongPreview, updateLocalPreference],
  );

  const toggleSongPreview = useCallback(
    async (songId: string) => {
      if (previewSongId === songId) {
        stopSongPreview();
        return;
      }
      if (
        !["idle", "results"].includes(phaseRef.current) ||
        calibrationRunningRef.current
      )
        return;
      if (calibrationOpen) await stopCalibration(true);
      setTutorialOpen(false);
      const song = SONG_CATALOG.find((candidate) => candidate.id === songId);
      if (!song) return;
      const importedAsset =
        song.audioMode === "local-import"
          ? localAudioLibraryRef.current?.get(songId)
          : null;
      const candidate = BUILT_IN_CHART_RESULTS[songId]?.normal;
      if (song.audioMode === "local-import" && !importedAsset) {
        setAudioError("请先选择本地音频；文件只会在当前浏览器内读取。 ");
        return;
      }
      if (song.audioMode !== "local-import" && !candidate?.ok) {
        setAudioError("该歌曲缺少可试听的 Normal 谱面。 ");
        return;
      }
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      const engine = getEngine();
      engine.setVolumes(settingsRef.current);
      auxiliaryAudioRef.current.start("preview", () => {
        if (previewTimerRef.current)
          window.clearTimeout(previewTimerRef.current);
        if (previewFrameRef.current)
          cancelAnimationFrame(previewFrameRef.current);
        previewTimerRef.current = null;
        previewFrameRef.current = null;
        engine.stopAll();
        if (previewRequestRef.current === requestId) {
          void engine
            .suspend()
            .finally(() => setAudioStateRevision((revision) => revision + 1));
        }
        setPreviewSongId(null);
      });
      setPreviewSongId(songId);
      setAudioError(null);
      try {
        const isCurrent = () =>
          requestId === previewRequestRef.current &&
          auxiliaryAudioRef.current.current() === "preview";
        const endTime =
          song.audioMode === "local-import" && importedAsset
            ? await engine.startLocalPreview(
                importedAsset.buffer,
                song.previewStart ?? 0,
                song.previewDuration ?? 10,
                isCurrent,
              )
            : candidate?.ok
              ? await engine.startPreview(candidate.chart, 10, isCurrent)
              : null;
        if (
          endTime === null ||
          requestId !== previewRequestRef.current ||
          auxiliaryAudioRef.current.current() !== "preview"
        )
          return;
        setAudioStateRevision((revision) => revision + 1);
        const pump = () => {
          if (auxiliaryAudioRef.current.current() !== "preview") return;
          engine.pumpScheduler();
          previewFrameRef.current = requestAnimationFrame(pump);
        };
        previewFrameRef.current = requestAnimationFrame(pump);
        const remainingMs = Math.max(
          0,
          (endTime - engine.getCurrentTime()) * 1000,
        );
        previewTimerRef.current = window.setTimeout(
          () => auxiliaryAudioRef.current.stop("preview"),
          remainingMs + 80,
        );
      } catch (error) {
        auxiliaryAudioRef.current.stop("preview");
        setAudioError(
          error instanceof Error ? error.message : "无法启动歌曲试听。",
        );
      }
    },
    [
      calibrationOpen,
      getEngine,
      previewSongId,
      stopCalibration,
      stopSongPreview,
    ],
  );

  const closeTutorial = useCallback((markComplete = false) => {
    auxiliaryAudioRef.current.stop("tutorial");
    if (tutorialTimerRef.current) window.clearTimeout(tutorialTimerRef.current);
    tutorialTimerRef.current = null;
    tutorialHoldStartedRef.current = null;
    setTutorialBeatPlaying(false);
    setTutorialOpen(false);
    setTutorialStep(0);
    setTutorialActionComplete(false);
    if (markComplete) saveTutorialCompleted();
  }, []);

  const openTutorial = useCallback(async () => {
    stopSongPreview();
    if (calibrationOpen) await stopCalibration(true);
    setSettingsDrawerOpen(false);
    setTutorialStep(0);
    setTutorialActionComplete(false);
    setTutorialOpen(true);
  }, [calibrationOpen, stopCalibration, stopSongPreview]);

  const playTutorialBeat = useCallback(async () => {
    if (!tutorialOpen || !["idle", "results"].includes(phaseRef.current))
      return;
    stopSongPreview();
    const engine = getEngine();
    engine.setVolumes(settingsRef.current);
    auxiliaryAudioRef.current.start("tutorial", () => {
      if (tutorialTimerRef.current)
        window.clearTimeout(tutorialTimerRef.current);
      tutorialTimerRef.current = null;
      engine.stopAll();
      void engine
        .suspend()
        .finally(() => setAudioStateRevision((revision) => revision + 1));
      setTutorialBeatPlaying(false);
    });
    setTutorialBeatPlaying(true);
    try {
      const endTime = await engine.playTutorialPulse(tutorialStep);
      tutorialTimerRef.current = window.setTimeout(
        () => auxiliaryAudioRef.current.stop("tutorial"),
        Math.max(0, (endTime - engine.getCurrentTime()) * 1000) + 60,
      );
    } catch (error) {
      auxiliaryAudioRef.current.stop("tutorial");
      setAudioError(
        error instanceof Error ? error.message : "无法播放教学节拍。",
      );
    }
  }, [getEngine, stopSongPreview, tutorialOpen, tutorialStep]);

  const tutorialLanePress = useCallback(
    (_lane: Lane) => {
      if (!tutorialOpen) return;
      if (tutorialStep === 2) {
        tutorialHoldStartedRef.current = performance.now();
        setTutorialActionComplete(false);
      } else {
        setTutorialActionComplete(true);
      }
    },
    [tutorialOpen, tutorialStep],
  );

  const tutorialLaneRelease = useCallback(
    (_lane?: Lane) => {
      if (!tutorialOpen || tutorialStep !== 2) return;
      const started = tutorialHoldStartedRef.current;
      if (started === null) return;
      tutorialHoldStartedRef.current = null;
      if (performance.now() - started >= 500) setTutorialActionComplete(true);
      else setUiMessage("Hold 需要持续按住至少半秒再松开。");
    },
    [tutorialOpen, tutorialStep],
  );

  const advanceTutorial = useCallback(() => {
    const next = tutorialStepAfterNext(tutorialStep);
    auxiliaryAudioRef.current.stop("tutorial");
    if (next === null) {
      closeTutorial(true);
      return;
    }
    setTutorialStep(next);
    setTutorialActionComplete(next === 3);
  }, [closeTutorial, tutorialStep]);

  useEffect(() => {
    settingsRef.current = settings;
    bindingMapRef.current = bindingMap(settings.laneBindings);
    saveSettings(settings);
    engineRef.current?.setVolumes(settings);
  }, [settings]);

  useEffect(() => {
    saveSelection({
      version: SELECTION_VERSION,
      songId: menuSongId,
      difficulty: menuDifficulty,
    });
  }, [menuDifficulty, menuSongId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 920px)");
    const update = () => {
      setCompactControls(media.matches);
      if (!media.matches) setSettingsDrawerOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!settingsDrawerOpen) return;
    requestAnimationFrame(() => {
      const index = CONTROL_TABS.findIndex(
        (tab) => tab.id === activeControlTab,
      );
      controlTabRefs.current[index]?.focus();
    });
  }, [activeControlTab, settingsDrawerOpen]);

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
    const locked = tutorialOpen || calibrationOpen || settingsDrawerOpen;
    document.body.classList.toggle("dialog-lock", locked);
    return () => document.body.classList.remove("dialog-lock");
  }, [calibrationOpen, compactControls, settingsDrawerOpen, tutorialOpen]);

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
        auxiliaryAudioRef.current.stop("calibration");
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
      stopSongPreview();
      if (tutorialOpen) closeTutorial(false);
      if (calibrationOpen) closeCalibration();
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
  }, [
    calibrationOpen,
    closeCalibration,
    closeTutorial,
    pauseGame,
    stopSongPreview,
    tutorialOpen,
  ]);

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
      if (tutorialOpen) {
        if (event.repeat) return;
        if (event.code === "Escape") {
          event.preventDefault();
          closeTutorial(false);
          return;
        }
        const tutorialLane = bindingMapRef.current[event.code];
        if (tutorialLane !== undefined) {
          event.preventDefault();
          pressedCodesRef.current.add(event.code);
          tutorialLanePress(tutorialLane);
        }
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
      if (event.code === "Escape" && !event.repeat && settingsDrawerOpen) {
        event.preventDefault();
        setSettingsDrawerOpen(false);
        requestAnimationFrame(() => settingsTriggerRef.current?.focus());
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
      if (tutorialOpen) {
        tutorialLaneRelease(lane);
        return;
      }
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
    closeTutorial,
    pauseGame,
    pressLane,
    recordCalibrationTap,
    refreshPressedLanes,
    releaseLane,
    settingsDrawerOpen,
    tutorialLanePress,
    tutorialLaneRelease,
    tutorialOpen,
  ]);

  useEffect(
    () => () => {
      if (milestoneTimerRef.current)
        window.clearTimeout(milestoneTimerRef.current);
      if (comboBreakTimerRef.current)
        window.clearTimeout(comboBreakTimerRef.current);
      if (calibrationPreviewTimerRef.current)
        window.clearTimeout(calibrationPreviewTimerRef.current);
      calibrationRunningRef.current = false;
      calibrationClockRef.current = null;
      calibrationSamplesRef.current = [];
      calibrationSeenBeatsRef.current.clear();
      auxiliaryAudioRef.current.stop();
      localAudioLibraryRef.current?.clearAll();
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

  const liveAccuracy = session ? calculateAccuracy(stats) : 0;
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
  const displayedResult = phase === "results" ? result : lastResult;
  const displayState = deriveProductDisplayState(
    phase,
    Boolean(displayedResult),
  );
  const panelStats = displayedResult?.stats ?? stats;
  const panelScore = displayedResult?.score ?? liveScore;
  const panelAccuracy = displayedResult?.accuracy ?? liveAccuracy;
  const stageSong = session?.chart.song ?? selectedSong;
  const stageDifficulty = session?.difficulty ?? menuDifficulty;
  const selectedBest =
    records.entries[
      recordKey(
        menuSongId,
        menuDifficulty,
        selectedSong.audioMode === "local-import"
          ? selectedLocalPreference?.audioVersion
          : null,
      )
    ] ?? null;

  const updateSetting = <Key extends keyof GameSettings>(
    key: Key,
    value: GameSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const handleRangeKey = <Key extends keyof GameSettings>(
    event: ReactKeyboardEvent<HTMLInputElement>,
    key: Key,
    step: number,
    minimum: number,
    maximum: number,
  ) => {
    if (
      !["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)
    )
      return;
    const current = settings[key];
    if (typeof current !== "number") return;
    event.preventDefault();
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    const multiplier = event.shiftKey ? 5 : 1;
    const next = clamp(
      current + direction * step * multiplier,
      minimum,
      maximum,
    );
    updateSetting(key, next as GameSettings[Key]);
  };

  const handleLocalOffsetKey = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    songId: string,
  ) => {
    if (
      !["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)
    )
      return;
    event.preventDefault();
    const current = localSongPreferences.entries[songId]?.userOffsetMs ?? 0;
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    updateLocalPreference(songId, {
      userOffsetMs: clamp(
        current + direction * (event.shiftKey ? 10 : 1),
        -500,
        500,
      ),
    });
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
      className={`app-shell phase-${phase} mode-${session?.mode ?? playMode} ${FOCUS_PHASES.includes(phase) ? "is-focus-mode" : ""}`}
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
          aria-label={
            displayState.statsPanel === "live"
              ? "实时成绩"
              : displayState.statsPanel === "last-result"
                ? "上一局结果"
                : "等待开始"
          }
        >
          <div className="card-heading">
            <span className="card-label">
              {displayState.statsPanel === "live"
                ? "实时数据"
                : displayState.statsPanel === "last-result"
                  ? "上一局结果"
                  : "演奏状态"}
            </span>
            <span className="tiny-index">
              {displayedResult
                ? `${displayedResult.songTitle} · ${displayedResult.difficulty.toUpperCase()}`
                : `${selectedSong.title} · ${menuDifficulty.toUpperCase()}`}
            </span>
          </div>
          {displayState.statsPanel === "waiting" ? (
            <div className="waiting-state" data-testid="waiting-state">
              <span>WAITING</span>
              <strong>等待开始</strong>
              <p>
                音符到达判定线时按{" "}
                {settings.laneBindings.map(bindingLabel).join(" / ")}； Hold
                需要持续按住。
              </p>
              <div className="waiting-goal">
                <b>本次目标</b>
                <span>
                  {chart?.description ??
                    selectedLocalTemplate?.charts[menuDifficulty].description ??
                    "请选择可用谱面"}
                </span>
              </div>
              <dl>
                <div>
                  <dt>BPM</dt>
                  <dd>{songBpmLabel(selectedSong)}</dd>
                </div>
                <div>
                  <dt>时长</dt>
                  <dd>
                    {songDurationLabel(
                      selectedSong,
                      selectedLocalAudio.duration,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>音符</dt>
                  <dd>{chart?.noteCount ?? "--"}</dd>
                </div>
              </dl>
              <div className="personal-best">
                <span>个人最佳</span>
                {selectedBest ? (
                  <b>
                    {formatScore(selectedBest.bestScore)} ·{" "}
                    {selectedBest.bestGrade}
                  </b>
                ) : (
                  <b>
                    {selectedSong.audioMode === "local-import"
                      ? "谱面完成后才会记录"
                      : "尚无正式成绩"}
                  </b>
                )}
              </div>
            </div>
          ) : (
            <>
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
                      <b>
                        {String(panelStats.counts[judgement]).padStart(2, "0")}
                      </b>
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
            </>
          )}
          {displayState.statsPanel === "live" ? (
            <div className="time-readout">
              <span>{formatClockTime(clock.rawTime)}</span>
              <i>
                <b style={{ transform: `scaleX(${progress})` }} />
              </i>
              <span>{formatClockTime(session?.chart.song.duration ?? 0)}</span>
            </div>
          ) : displayState.statsPanel === "waiting" ? (
            <div
              className="time-readout waiting-time"
              data-testid="waiting-time"
            >
              <span>0:00</span>
              <i>
                <b style={{ transform: "scaleX(0)" }} />
              </i>
              <span>
                {songDurationLabel(selectedSong, selectedLocalAudio.duration)}
              </span>
            </div>
          ) : null}
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
              <span>
                {displayState.showRuntimeMetrics ? "NOW PLAYING" : "已选择"}
              </span>
              <b>
                <span className="stage-song-title">{stageSong.title}</span>
                {stageSong.englishTitle && (
                  <em className="stage-song-subtitle">
                    {stageSong.englishTitle}
                  </em>
                )}
                <small>{stageDifficulty.toUpperCase()}</small>
              </b>
            </div>
            {displayState.showRuntimeMetrics ? (
              <div className="stage-live-stats" data-testid="live-hud">
                <span>
                  SCORE <b>{formatScore(liveScore)}</b>
                </span>
                <span>
                  ACC <b>{liveAccuracy.toFixed(1)}%</b>
                </span>
                <span
                  className={`hud-life ${stats.life < 30 ? "is-low-life" : ""}`}
                >
                  LIFE <b>{stats.life}%</b>
                  <i aria-hidden="true">
                    <em style={{ width: `${stats.life}%` }} />
                  </i>
                </span>
                <span>
                  {stageDifficulty.toUpperCase()} · {Math.round(progress * 100)}
                  %
                </span>
                {session?.mode === "practice" && (
                  <span className="hud-practice">PRACTICE</span>
                )}
              </div>
            ) : (
              <div className="stage-selection-meta" data-testid="selection-hud">
                <span>{songBpmLabel(selectedSong)} BPM</span>
                <span>
                  {songDurationLabel(selectedSong, selectedLocalAudio.duration)}
                </span>
                <span>{chart?.noteCount ?? "--"} 音符</span>
                <span>
                  {menuDifficulty.toUpperCase()} · LV.{chart?.level ?? "--"}
                </span>
              </div>
            )}
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

            {FOCUS_PHASES.includes(phase) && stats.combo > 0 && (
              <div
                className={`combo-hud ${comboMilestone ? "is-milestone" : ""}`}
                aria-live="polite"
              >
                <strong>{stats.combo}</strong>
                <span>
                  {comboMilestone ? `${comboMilestone} MILESTONE` : "COMBO"}
                </span>
              </div>
            )}
            {FOCUS_PHASES.includes(phase) && comboBreak && (
              <div className="combo-break" aria-live="polite">
                COMBO BREAK
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
                aria-hidden="true"
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
                  <i />
                  {selectedSong.category === "classical"
                    ? "PUBLIC DOMAIN · ORIGINAL SYNTH ARRANGEMENT"
                    : selectedSong.category === "mandopop"
                      ? "LOCAL AUDIO · NEVER UPLOADED"
                      : "ORIGINAL SYNTH TRACK"}
                </div>
                <h2
                  className={
                    selectedSong.title.length > 10 ? "is-long-title" : ""
                  }
                >
                  <span className="title-primary">
                    {selectedSong.category !== "original"
                      ? selectedSong.title
                      : selectedSong.title.split(" ")[0].toUpperCase()}
                  </span>
                  <em className="title-secondary">
                    {selectedSong.category !== "original"
                      ? selectedSong.englishTitle
                      : selectedSong.title
                          .split(" ")
                          .slice(1)
                          .join(" ")
                          .toUpperCase()}
                  </em>
                </h2>
                <p>{selectedSong.subtitle}</p>
                {selectedSong.licenseLabel && (
                  <span
                    className={`public-domain-badge ${selectedSong.category === "mandopop" ? "is-local-audio" : ""}`}
                  >
                    {selectedSong.licenseLabel}
                  </span>
                )}
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
                {!chartResult.ok &&
                  selectedSong.audioMode !== "local-import" && (
                    <div className="chart-error" role="alert">
                      <b>谱面加载失败</b>
                      {chartResult.errors.map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                    </div>
                  )}
                {selectedSong.audioMode === "local-import" && (
                  <div className="local-track-intro" role="status">
                    <b>
                      {selectedLocalAudio.status === "ready"
                        ? "本地音频已就绪，可试听与校准"
                        : "请选择你有权使用的本地音频"}
                    </b>
                    <span>
                      正式谱面将在匹配音频版本并完成测量后制作，当前不能开始演奏。
                    </span>
                  </div>
                )}
                {chartResult.ok && chartResult.warnings.length > 0 && (
                  <p className="chart-warning">
                    {chartResult.warnings.join(" ")}
                  </p>
                )}
                <small>
                  {selectedSong.audioMode === "local-import"
                    ? "文件只保留在当前浏览器内存中，刷新后需要重新选择"
                    : "在歌曲面板选择曲目与难度，然后开始演奏"}
                </small>
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
                    setPlayMode(result.mode);
                    void startGame(replay.chart, result.mode);
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
            <span className="card-label">演奏控制</span>
            <span className="tiny-index">TRACK / CONFIG</span>
          </div>

          <div className="control-primary">
            <div
              className="song-category-filter"
              role="tablist"
              aria-label="曲目分类"
            >
              {(
                [
                  ["original", "原创电子"],
                  ["classical", "经典交响"],
                  ["mandopop", "华语流行"],
                ] as const
              ).map(([category, label]) => (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={songCategory === category}
                  className={songCategory === category ? "is-active" : ""}
                  disabled={isSettingsLocked}
                  onClick={() => {
                    if (songCategory === category) return;
                    stopSongPreview();
                    setSongCategory(category);
                    const firstSong = SONG_CATALOG.find(
                      (song) => song.category === category,
                    );
                    if (firstSong) setMenuSongId(firstSong.id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="song-selector" aria-label="选择歌曲">
              {visibleSongs.map((song) => (
                <div
                  className={`song-option ${song.id === menuSongId ? "is-selected" : ""}`}
                  key={song.id}
                >
                  <button
                    type="button"
                    className="song-select-button"
                    onClick={() => {
                      stopSongPreview();
                      setMenuSongId(song.id);
                    }}
                    disabled={isSettingsLocked}
                    aria-pressed={song.id === menuSongId}
                  >
                    <span
                      className={`song-art art-${song.accent}`}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="song-copy">
                      <small>
                        TRACK{" "}
                        {String(SONG_CATALOG.indexOf(song) + 1).padStart(
                          2,
                          "0",
                        )}
                      </small>
                      <b
                        className={`song-title-cn ${song.title.length > 10 ? "is-long-title" : ""}`}
                      >
                        {song.title}
                      </b>
                      {song.englishTitle && (
                        <span className="song-title-en song-english-title">
                          {song.englishTitle}
                        </span>
                      )}
                      <em>{song.artist}</em>
                      <span className="song-meta">
                        {songBpmLabel(song)} BPM ·{" "}
                        {songDurationLabel(
                          song,
                          localAudioUi[song.id]?.duration,
                        )}
                      </span>
                      {song.audioMode === "local-import" && (
                        <span
                          className={`song-audio-status is-${localAudioUi[song.id]?.status ?? "missing"}`}
                        >
                          {localAudioUi[song.id]?.status === "ready"
                            ? "● 已导入"
                            : localAudioUi[song.id]?.status === "loading"
                              ? "◌ 解码中"
                              : localAudioUi[song.id]?.status === "error"
                                ? "! 导入失败"
                                : "○ 未导入"}
                        </span>
                      )}
                      {song.movement && (
                        <span className="song-work-meta">
                          {song.movement} · {song.workNumber}
                        </span>
                      )}
                      {song.licenseLabel && (
                        <span className="song-license-tag">
                          {song.licenseLabel}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`song-preview-button ${previewSongId === song.id ? "is-playing" : ""}`}
                    onClick={() => void toggleSongPreview(song.id)}
                    disabled={
                      isSettingsLocked ||
                      calibrationOpen ||
                      tutorialOpen ||
                      (song.audioMode === "local-import" &&
                        localAudioUi[song.id]?.status !== "ready")
                    }
                    aria-pressed={previewSongId === song.id}
                    aria-label={`${previewSongId === song.id ? "停止" : "试听"} ${song.title}`}
                  >
                    <span className="preview-icon" aria-hidden="true">
                      {previewSongId === song.id ? "■" : "▶"}
                    </span>
                    <span className="preview-label">
                      {localAudioUi[song.id]?.status === "loading"
                        ? "解码"
                        : previewSongId === song.id
                          ? "停止"
                          : "试听"}
                    </span>
                    <span className="preview-progress" aria-hidden="true">
                      <i />
                    </span>
                  </button>
                  {song.id === menuSongId &&
                    song.audioMode === "local-import" && (
                      <div className="local-audio-panel">
                        <div className="local-audio-heading">
                          <b>本地音乐导入</b>
                          <span>音频不会上传</span>
                        </div>
                        <p>
                          请选择你拥有合法访问权的音频副本。文件仅在当前页面内解码，
                          不会写入 localStorage 或发送网络请求。
                        </p>
                        <dl>
                          <div>
                            <dt>音频版本</dt>
                            <dd>{song.audioVersion}</dd>
                          </div>
                          <div>
                            <dt>实际时长</dt>
                            <dd>
                              {songDurationLabel(
                                song,
                                localAudioUi[song.id]?.duration,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>BPM / 变速</dt>
                            <dd>待匹配音频后测量</dd>
                          </div>
                        </dl>
                        <div className="local-audio-actions">
                          <label
                            className={`local-file-button ${localAudioUi[song.id]?.status === "loading" ? "is-disabled" : ""}`}
                          >
                            <span>
                              {localAudioUi[song.id]?.status === "loading"
                                ? "正在解码…"
                                : localAudioUi[song.id]?.status === "ready"
                                  ? "更换本地音频"
                                  : "选择本地音频"}
                            </span>
                            <input
                              type="file"
                              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.mp4"
                              disabled={
                                isSettingsLocked ||
                                localAudioUi[song.id]?.status === "loading"
                              }
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file) void importLocalAudio(song.id, file);
                              }}
                              aria-label={`为 ${song.title} 选择本地音频`}
                            />
                          </label>
                          {localAudioUi[song.id]?.status === "ready" && (
                            <button
                              type="button"
                              onClick={() => clearLocalAudio(song.id)}
                            >
                              释放音频
                            </button>
                          )}
                        </div>
                        <label
                          className="local-offset-control"
                          htmlFor={`local-offset-${song.id}`}
                        >
                          <span>
                            <b>歌曲独立偏移</b>
                            <output>
                              {(localSongPreferences.entries[song.id]
                                ?.userOffsetMs ?? 0) >= 0
                                ? "+"
                                : ""}
                              {localSongPreferences.entries[song.id]
                                ?.userOffsetMs ?? 0}
                              ms
                            </output>
                          </span>
                          <input
                            id={`local-offset-${song.id}`}
                            type="range"
                            min={-500}
                            max={500}
                            step={1}
                            value={
                              localSongPreferences.entries[song.id]
                                ?.userOffsetMs ?? 0
                            }
                            onChange={(event) =>
                              updateLocalPreference(song.id, {
                                userOffsetMs: Number(event.currentTarget.value),
                              })
                            }
                            onKeyDown={(event) =>
                              handleLocalOffsetKey(event, song.id)
                            }
                            aria-valuetext={`歌曲独立偏移 ${signedMilliseconds(localSongPreferences.entries[song.id]?.userOffsetMs ?? 0)}`}
                          />
                        </label>
                        <div
                          className={`local-audio-message is-${localAudioUi[song.id]?.validation?.status ?? localAudioUi[song.id]?.status ?? "missing"}`}
                          role={
                            localAudioUi[song.id]?.status === "error"
                              ? "alert"
                              : "status"
                          }
                        >
                          {localAudioUi[song.id]?.message ??
                            (localSongPreferences.entries[song.id]
                              ?.lastDecodedDuration
                              ? `上次已检测 ${formatClockTime(localSongPreferences.entries[song.id].lastDecodedDuration ?? 0)}，刷新后需重新选择文件。`
                              : "未导入音频；试听与演奏已禁用。")}
                        </div>
                        <small>{song.copyrightNotice}</small>
                      </div>
                    )}
                </div>
              ))}
            </div>

            <DifficultySelector
              value={menuDifficulty}
              levels={difficultyLevels}
              details={difficultyDetails}
              drafts={draftDifficultyDetails}
              disabled={isSettingsLocked}
              onChange={setMenuDifficulty}
            />

            <div
              className="play-mode-selector"
              role="radiogroup"
              aria-label="演奏模式"
            >
              {(
                [
                  ["standard", "标准模式", "生命归零时结束，可保存成绩"],
                  ["practice", "练习模式", "可打完整首，不写入正式记录"],
                ] as const
              ).map(([mode, label, description]) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={playMode === mode}
                  className={playMode === mode ? "is-selected" : ""}
                  disabled={isSettingsLocked}
                  onClick={() => {
                    stopSongPreview();
                    setPlayMode(mode);
                  }}
                  key={mode}
                >
                  <b>{label}</b>
                  <span>{description}</span>
                </button>
              ))}
            </div>

            <div className="quick-tools">
              <button
                type="button"
                onClick={() => {
                  stopSongPreview();
                  closeTutorial(false);
                  setCalibrationOpen(true);
                }}
                disabled={
                  isSettingsLocked ||
                  (selectedSong.audioMode === "local-import" &&
                    selectedLocalAudio.status !== "ready")
                }
              >
                延迟校准
              </button>
              <button type="button" onClick={() => void toggleFullscreen()}>
                {fullscreen ? "退出全屏" : "全屏"}
              </button>
              <button
                type="button"
                ref={settingsTriggerRef}
                onClick={() => setSettingsDrawerOpen(true)}
                disabled={isSettingsLocked}
              >
                打开设置
              </button>
            </div>

            <div className="control-actions">
              {(phase === "idle" || phase === "results") && (
                <button
                  className="deck-primary"
                  type="button"
                  onClick={() => void startGame()}
                  disabled={!chart}
                >
                  <span>
                    {selectedSong.audioMode === "local-import"
                      ? "等待匹配音频与制谱"
                      : phase === "results"
                        ? "再次演奏"
                        : "开始演奏"}
                  </span>
                  <b>{phase === "results" ? "↻" : "▶"}</b>
                </button>
              )}
              {ACTIVE_PHASES.includes(phase) && (
                <button
                  className="deck-primary"
                  type="button"
                  onClick={() => void pauseGame(false)}
                >
                  <span>暂停</span>
                  <b>Ⅱ</b>
                </button>
              )}
              {phase === "paused" && (
                <button
                  className="deck-primary"
                  type="button"
                  onClick={() => void resumeGame()}
                >
                  <span>继续</span>
                  <b>▶</b>
                </button>
              )}
              {isBusy && (
                <button className="deck-primary" type="button" disabled>
                  <span>请稍候</span>
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
          </div>

          {settingsDrawerOpen &&
            createPortal(
              <div
                className="settings-panel is-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="游戏设置"
              >
                <div className="settings-heading">
                  <span>游戏设置</span>
                  <div>
                    <button
                      type="button"
                      onClick={() => setSettings(DEFAULT_SETTINGS)}
                      disabled={isSettingsLocked}
                    >
                      全部重置
                    </button>
                    <button
                      type="button"
                      className="drawer-close"
                      onClick={() => {
                        setSettingsDrawerOpen(false);
                        settingsTriggerRef.current?.focus();
                      }}
                      aria-label="关闭设置"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div
                  className="settings-tabs"
                  role="tablist"
                  aria-label="设置分类"
                >
                  {CONTROL_TABS.map((tab, index) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeControlTab === tab.id}
                      aria-controls={`settings-${tab.id}`}
                      tabIndex={activeControlTab === tab.id ? 0 : -1}
                      className={activeControlTab === tab.id ? "is-active" : ""}
                      ref={(element) => {
                        controlTabRefs.current[index] = element;
                      }}
                      onClick={() => setActiveControlTab(tab.id)}
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowLeft" &&
                          event.key !== "ArrowRight"
                        )
                          return;
                        event.preventDefault();
                        const direction = event.key === "ArrowRight" ? 1 : -1;
                        const next =
                          (index + direction + CONTROL_TABS.length) %
                          CONTROL_TABS.length;
                        setActiveControlTab(CONTROL_TABS[next].id);
                        controlTabRefs.current[next]?.focus();
                      }}
                      key={tab.id}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeControlTab === "gameplay" && (
                  <div
                    className="settings-tab-panel"
                    id="settings-gameplay"
                    role="tabpanel"
                  >
                    <label
                      className="range-control"
                      htmlFor="setting-note-speed"
                    >
                      <span>
                        <b>音符速度</b>
                        <output>{settings.noteSpeed.toFixed(2)}×</output>
                      </span>
                      <input
                        id="setting-note-speed"
                        type="range"
                        min={SETTINGS_LIMITS.noteSpeed.minimum}
                        max={SETTINGS_LIMITS.noteSpeed.maximum}
                        step="0.05"
                        value={settings.noteSpeed}
                        disabled={isSettingsLocked}
                        aria-valuetext={`音符速度 ${settings.noteSpeed.toFixed(2)} 倍`}
                        onKeyDown={(event) =>
                          handleRangeKey(
                            event,
                            "noteSpeed",
                            0.05,
                            SETTINGS_LIMITS.noteSpeed.minimum,
                            SETTINGS_LIMITS.noteSpeed.maximum,
                          )
                        }
                        onChange={(event) =>
                          updateSetting("noteSpeed", Number(event.target.value))
                        }
                      />
                    </label>
                    <div className="offset-grid">
                      <label
                        className="range-control"
                        htmlFor="setting-judge-offset"
                      >
                        <span>
                          <b>判定偏移</b>
                          <output>
                            {settings.audioOffsetMs >= 0 ? "+" : ""}
                            {settings.audioOffsetMs}ms
                          </output>
                        </span>
                        <input
                          id="setting-judge-offset"
                          type="range"
                          min={SETTINGS_LIMITS.audioOffsetMs.minimum}
                          max={SETTINGS_LIMITS.audioOffsetMs.maximum}
                          step="5"
                          value={settings.audioOffsetMs}
                          disabled={isSettingsLocked}
                          aria-valuetext={`判定偏移${signedMilliseconds(settings.audioOffsetMs)}`}
                          onKeyDown={(event) =>
                            handleRangeKey(
                              event,
                              "audioOffsetMs",
                              5,
                              SETTINGS_LIMITS.audioOffsetMs.minimum,
                              SETTINGS_LIMITS.audioOffsetMs.maximum,
                            )
                          }
                          onChange={(event) =>
                            updateSetting(
                              "audioOffsetMs",
                              Number(event.target.value),
                            )
                          }
                        />
                      </label>
                      <label
                        className="range-control"
                        htmlFor="setting-visual-offset"
                      >
                        <span>
                          <b>视觉偏移</b>
                          <output>
                            {settings.visualOffsetMs >= 0 ? "+" : ""}
                            {settings.visualOffsetMs}ms
                          </output>
                        </span>
                        <input
                          id="setting-visual-offset"
                          type="range"
                          min={SETTINGS_LIMITS.visualOffsetMs.minimum}
                          max={SETTINGS_LIMITS.visualOffsetMs.maximum}
                          step="5"
                          value={settings.visualOffsetMs}
                          disabled={isSettingsLocked}
                          aria-valuetext={`视觉偏移${signedMilliseconds(settings.visualOffsetMs)}`}
                          onKeyDown={(event) =>
                            handleRangeKey(
                              event,
                              "visualOffsetMs",
                              5,
                              SETTINGS_LIMITS.visualOffsetMs.minimum,
                              SETTINGS_LIMITS.visualOffsetMs.maximum,
                            )
                          }
                          onChange={(event) =>
                            updateSetting(
                              "visualOffsetMs",
                              Number(event.target.value),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="range-control" htmlFor="setting-effects">
                      <span>
                        <b>特效强度</b>
                        <output>
                          {Math.round(settings.effectIntensity * 100)}%
                        </output>
                      </span>
                      <input
                        id="setting-effects"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={settings.effectIntensity}
                        aria-valuetext={`特效强度 ${Math.round(settings.effectIntensity * 100)}%`}
                        onKeyDown={(event) =>
                          handleRangeKey(event, "effectIntensity", 0.05, 0, 1)
                        }
                        onChange={(event) =>
                          updateSetting(
                            "effectIntensity",
                            Number(event.target.value),
                          )
                        }
                      />
                    </label>
                    <p className="offset-help">
                      判定偏移调整按键时机；视觉偏移只改变音符位置。正值更晚，负值更早。
                    </p>
                    <div className="toggle-grid">
                      <button
                        type="button"
                        className={settings.screenShake ? "is-on" : ""}
                        onClick={() =>
                          updateSetting("screenShake", !settings.screenShake)
                        }
                        aria-pressed={settings.screenShake}
                      >
                        震屏 {settings.screenShake ? "开" : "关"}
                      </button>
                      <button
                        type="button"
                        className={settings.haptics ? "is-on" : ""}
                        onClick={() =>
                          updateSetting("haptics", !settings.haptics)
                        }
                        aria-pressed={settings.haptics}
                      >
                        触觉 {settings.haptics ? "开" : "关"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="tutorial-reopen"
                      onClick={() => void openTutorial()}
                      disabled={isSettingsLocked}
                    >
                      重新查看新手教程
                    </button>
                  </div>
                )}

                {activeControlTab === "sound" && (
                  <div
                    className="settings-tab-panel"
                    id="settings-sound"
                    role="tabpanel"
                  >
                    {(
                      [
                        ["masterVolume", "主音量"],
                        ["musicVolume", "音乐音量"],
                        ["hitVolume", "打击音量"],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        className="range-control volume-control"
                        htmlFor={`setting-${key}`}
                        key={key}
                      >
                        <span>
                          <b>{label}</b>
                          <output>{Math.round(settings[key] * 100)}%</output>
                        </span>
                        <input
                          id={`setting-${key}`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={settings[key]}
                          aria-valuetext={`${label} ${Math.round(settings[key] * 100)}%`}
                          onKeyDown={(event) =>
                            handleRangeKey(event, key, 0.01, 0, 1)
                          }
                          onChange={(event) =>
                            updateSetting(key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className={`mute-button ${settings.muted ? "is-muted" : ""}`}
                      onClick={() => updateSetting("muted", !settings.muted)}
                      aria-pressed={settings.muted}
                    >
                      {settings.muted ? "取消静音" : "全部静音"}
                    </button>
                    <p className="settings-note">
                      试听、延迟校准和正式演奏会自动互斥，切换时立即释放旧音频。
                    </p>
                  </div>
                )}

                {activeControlTab === "keys" && (
                  <div
                    className="settings-tab-panel key-settings"
                    id="settings-keys"
                    role="tabpanel"
                    aria-label="自定义键位"
                  >
                    <div>
                      <b>四轨键位</b>
                      <button
                        type="button"
                        onClick={() =>
                          updateSetting("laneBindings", [
                            ...DEFAULT_LANE_BINDINGS,
                          ])
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
                            className={
                              bindingLane === lane ? "is-listening" : ""
                            }
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
                    <p className="settings-note">
                      新键位会立即同步到演奏轨道和底部提示；重复键位无法保存。
                    </p>
                  </div>
                )}
              </div>,
              document.body,
            )}

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
        <span>ESC TO PAUSE · LOCAL FILES STAY ON DEVICE · NO UPLOADS</span>
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
        currentOffsetMs={
          selectedSong.audioMode === "local-import"
            ? (selectedLocalPreference?.userOffsetMs ?? 0)
            : settings.audioOffsetMs
        }
        scopeLabel={
          selectedSong.audioMode === "local-import"
            ? `${selectedSong.title} · 歌曲独立偏移`
            : "全局设备判定偏移"
        }
        onClose={closeCalibration}
        onStart={() => void startCalibration()}
        onTap={recordCalibrationTap}
        onPreview={() => void previewCalibration()}
        onApply={(offsetMs) => {
          if (selectedSong.audioMode === "local-import")
            updateLocalPreference(selectedSong.id, { userOffsetMs: offsetMs });
          else updateSetting("audioOffsetMs", offsetMs);
          void stopCalibration(true);
        }}
      />
      <TutorialPanel
        open={tutorialOpen}
        step={tutorialStep}
        actionComplete={tutorialActionComplete}
        bindings={settings.laneBindings}
        beatPlaying={tutorialBeatPlaying}
        onLanePress={tutorialLanePress}
        onLaneRelease={tutorialLaneRelease}
        onPlayBeat={() => void playTutorialBeat()}
        onNext={advanceTutorial}
        onSkip={() => closeTutorial(true)}
      />
    </main>
  );
}
