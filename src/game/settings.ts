export const SETTINGS_VERSION = 2;
export const SETTINGS_STORAGE_KEY = "neon-pulse:settings";
export const LEGACY_SETTINGS_STORAGE_KEY = "neon-pulse:settings:v1";

export interface GameSettings {
  version: typeof SETTINGS_VERSION;
  noteSpeed: number;
  audioOffsetMs: number;
  masterVolume: number;
  musicVolume: number;
  hitVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  version: SETTINGS_VERSION,
  noteSpeed: 1,
  audioOffsetMs: 0,
  masterVolume: 0.8,
  musicVolume: 0.78,
  hitVolume: 0.72,
  muted: false,
};

export const SETTINGS_LIMITS = {
  noteSpeed: { minimum: 0.75, maximum: 1.75 },
  audioOffsetMs: { minimum: -200, maximum: 200 },
  volume: { minimum: 0, maximum: 1 },
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
