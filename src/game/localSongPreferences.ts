export const LOCAL_SONG_PREFERENCES_VERSION = 1;
export const LOCAL_SONG_PREFERENCES_KEY = "neon-pulse:local-song-preferences";

export interface LocalSongPreference {
  audioVersion: string;
  userOffsetMs: number;
  lastDecodedDuration: number | null;
}

export interface LocalSongPreferenceBook {
  version: typeof LOCAL_SONG_PREFERENCES_VERSION;
  entries: Record<string, LocalSongPreference>;
}

export const emptyLocalSongPreferenceBook = (): LocalSongPreferenceBook => ({
  version: LOCAL_SONG_PREFERENCES_VERSION,
  entries: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeEntry = (value: unknown): LocalSongPreference | null => {
  if (!isRecord(value)) return null;
  return {
    audioVersion:
      typeof value.audioVersion === "string" && value.audioVersion.trim()
        ? value.audioVersion.trim().slice(0, 80)
        : "玩家本地合法副本 · 版本待核验",
    userOffsetMs:
      typeof value.userOffsetMs === "number" &&
      Number.isFinite(value.userOffsetMs)
        ? Math.round(Math.min(500, Math.max(-500, value.userOffsetMs)))
        : 0,
    lastDecodedDuration:
      typeof value.lastDecodedDuration === "number" &&
      Number.isFinite(value.lastDecodedDuration) &&
      value.lastDecodedDuration > 0
        ? value.lastDecodedDuration
        : null,
  };
};

export function loadLocalSongPreferences(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): LocalSongPreferenceBook {
  try {
    const raw = storage.getItem(LOCAL_SONG_PREFERENCES_KEY);
    if (!raw) return emptyLocalSongPreferenceBook();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.entries))
      return emptyLocalSongPreferenceBook();
    const entries: Record<string, LocalSongPreference> = {};
    for (const [songId, value] of Object.entries(parsed.entries)) {
      const entry = normalizeEntry(value);
      if (entry) entries[songId] = entry;
    }
    return { version: LOCAL_SONG_PREFERENCES_VERSION, entries };
  } catch {
    return emptyLocalSongPreferenceBook();
  }
}

export function saveLocalSongPreferences(
  book: LocalSongPreferenceBook,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(LOCAL_SONG_PREFERENCES_KEY, JSON.stringify(book));
  } catch {
    // Local metadata is optional. Audio bytes are never written here.
  }
}

export function updateLocalSongPreference(
  book: LocalSongPreferenceBook,
  songId: string,
  update: Partial<LocalSongPreference>,
): LocalSongPreferenceBook {
  const current = book.entries[songId] ??
    normalizeEntry({}) ?? {
      audioVersion: "玩家本地合法副本 · 版本待核验",
      userOffsetMs: 0,
      lastDecodedDuration: null,
    };
  const normalized = normalizeEntry({ ...current, ...update }) ?? current;
  return {
    version: LOCAL_SONG_PREFERENCES_VERSION,
    entries: { ...book.entries, [songId]: normalized },
  };
}
