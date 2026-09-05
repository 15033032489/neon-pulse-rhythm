import type { DifficultyId } from "./types";

export const SELECTION_VERSION = 1;
export const SELECTION_STORAGE_KEY = "neon-pulse:selection";
export const LEGACY_SELECTION_STORAGE_KEY = "neon-pulse:last-selection";

export interface MenuSelection {
  version: typeof SELECTION_VERSION;
  songId: string;
  difficulty: DifficultyId;
}

const isDifficulty = (value: unknown): value is DifficultyId =>
  value === "easy" || value === "normal" || value === "hard";

export function normalizeSelection(
  value: unknown,
  validSongIds: readonly string[],
): MenuSelection | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.songId !== "string" ||
    !validSongIds.includes(candidate.songId) ||
    !isDifficulty(candidate.difficulty)
  )
    return null;
  return {
    version: SELECTION_VERSION,
    songId: candidate.songId,
    difficulty: candidate.difficulty,
  };
}

export function loadSelection(
  validSongIds: readonly string[],
  storage: Pick<Storage, "getItem"> = window.localStorage,
): MenuSelection {
  const fallback: MenuSelection = {
    version: SELECTION_VERSION,
    songId: validSongIds[0] ?? "chromatic-run",
    difficulty: "easy",
  };
  for (const key of [SELECTION_STORAGE_KEY, LEGACY_SELECTION_STORAGE_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const normalized = normalizeSelection(JSON.parse(raw), validSongIds);
      if (normalized) return normalized;
    } catch {
      // Continue to older compatible sources before falling back.
    }
  }
  try {
    const recordsRaw = storage.getItem("neon-pulse:records");
    if (recordsRaw) {
      const parsed = JSON.parse(recordsRaw) as {
        entries?: Record<string, { updatedAt?: unknown }>;
      };
      const recent = Object.entries(parsed.entries ?? {})
        .map(([key, record]) => {
          const separator = key.lastIndexOf(":");
          return {
            songId: key.slice(0, separator),
            difficulty: key.slice(separator + 1),
            updatedAt:
              typeof record?.updatedAt === "string" ? record.updatedAt : "",
          };
        })
        .filter(
          (entry) =>
            validSongIds.includes(entry.songId) &&
            isDifficulty(entry.difficulty),
        )
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )[0];
      if (recent && isDifficulty(recent.difficulty))
        return {
          version: SELECTION_VERSION,
          songId: recent.songId,
          difficulty: recent.difficulty,
        };
    }
  } catch {
    // Corrupt record history must not prevent the first-visit Easy fallback.
  }
  return fallback;
}

export function saveSelection(
  selection: MenuSelection,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Selection persistence is optional when browser storage is unavailable.
  }
}
