import type { Lane } from "./types";

export const SETTINGS_VERSION = 3;
export const SETTINGS_STORAGE_KEY = "neon-pulse:settings";
export const LEGACY_SETTINGS_STORAGE_KEY = "neon-pulse:settings:v1";
export const DEFAULT_LANE_BINDINGS = ["KeyD", "KeyF", "KeyJ", "KeyK"] as const;

export type LaneBindings = [string, string, string, string];

export interface GameSettings {
  version: typeof SETTINGS_VERSION;
  noteSpeed: number;
  /** Judgement timeline offset. Positive values judge later. */
  audioOffsetMs: number;
  /** Rendering-only offset. Positive values draw notes later. */
  visualOffsetMs: number;
  masterVolume: number;
  musicVolume: number;
  hitVolume: number;
  effectIntensity: number;
  screenShake: boolean;
  haptics: boolean;
  laneBindings: LaneBindings;
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  version: SETTINGS_VERSION,
  noteSpeed: 1,
  audioOffsetMs: 0,
  visualOffsetMs: 0,
  masterVolume: 0.8,
  musicVolume: 0.78,
  hitVolume: 0.72,
  effectIntensity: 0.8,
  screenShake: true,
  haptics: true,
  laneBindings: [...DEFAULT_LANE_BINDINGS],
  muted: false,
};

export const SETTINGS_LIMITS = {
  noteSpeed: { minimum: 0.75, maximum: 1.75 },
  audioOffsetMs: { minimum: -200, maximum: 200 },
  visualOffsetMs: { minimum: -250, maximum: 250 },
  volume: { minimum: 0, maximum: 1 },
  effectIntensity: { minimum: 0, maximum: 1 },
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const numberOrDefault = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback;

export const areBindingsUnique = (bindings: readonly string[]): boolean =>
  bindings.length === 4 && new Set(bindings).size === 4;

export const isUsableBinding = (code: unknown): code is string =>
  typeof code === "string" &&
  code.length > 0 &&
  !["Escape", "Space", "Tab", "Enter"].includes(code);

export function normalizeBindings(value: unknown): LaneBindings {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(isUsableBinding) ||
    !areBindingsUnique(value)
  ) {
    return [...DEFAULT_LANE_BINDINGS];
  }
  return [value[0], value[1], value[2], value[3]];
}

export function bindingMap(bindings: LaneBindings): Record<string, Lane> {
  return Object.fromEntries(
    bindings.map((code, lane) => [code, lane as Lane]),
  ) as Record<string, Lane>;
}

export function bindingLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith("Arrow")) return code.replace("Arrow", "").toUpperCase();
  return code.replace(/^(Numpad|Bracket)/, "").toUpperCase();
}

export function migrateSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const candidate = value as Record<string, unknown>;

  return {
    version: SETTINGS_VERSION,
    noteSpeed: numberOrDefault(
      candidate.noteSpeed,
      DEFAULT_SETTINGS.noteSpeed,
      SETTINGS_LIMITS.noteSpeed.minimum,
      SETTINGS_LIMITS.noteSpeed.maximum,
    ),
    audioOffsetMs: numberOrDefault(
      candidate.audioOffsetMs,
      DEFAULT_SETTINGS.audioOffsetMs,
      SETTINGS_LIMITS.audioOffsetMs.minimum,
      SETTINGS_LIMITS.audioOffsetMs.maximum,
    ),
    visualOffsetMs: numberOrDefault(
      candidate.visualOffsetMs,
      DEFAULT_SETTINGS.visualOffsetMs,
      SETTINGS_LIMITS.visualOffsetMs.minimum,
      SETTINGS_LIMITS.visualOffsetMs.maximum,
    ),
    masterVolume: numberOrDefault(
      candidate.masterVolume,
      DEFAULT_SETTINGS.masterVolume,
      0,
      1,
    ),
    musicVolume: numberOrDefault(
      candidate.musicVolume,
      DEFAULT_SETTINGS.musicVolume,
      0,
      1,
    ),
    hitVolume: numberOrDefault(
      candidate.hitVolume,
      DEFAULT_SETTINGS.hitVolume,
      0,
      1,
    ),
    effectIntensity: numberOrDefault(
      candidate.effectIntensity,
      DEFAULT_SETTINGS.effectIntensity,
      0,
      1,
    ),
    screenShake:
      typeof candidate.screenShake === "boolean"
        ? candidate.screenShake
        : DEFAULT_SETTINGS.screenShake,
    haptics:
      typeof candidate.haptics === "boolean"
        ? candidate.haptics
        : DEFAULT_SETTINGS.haptics,
    laneBindings: normalizeBindings(candidate.laneBindings),
    muted: typeof candidate.muted === "boolean" ? candidate.muted : false,
  };
}

const parseStoredSettings = (raw: string | null): GameSettings | null => {
  if (!raw) return null;
  try {
    return migrateSettings(JSON.parse(raw));
  } catch {
    return null;
  }
};

export function loadSettings(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): GameSettings {
  try {
    return (
      parseStoredSettings(storage.getItem(SETTINGS_STORAGE_KEY)) ??
      parseStoredSettings(storage.getItem(LEGACY_SETTINGS_STORAGE_KEY)) ?? {
        ...DEFAULT_SETTINGS,
      }
    );
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: GameSettings,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is optional; gameplay remains available without persistence.
  }
}
