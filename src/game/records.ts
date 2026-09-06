import type { DifficultyId } from "./types";
import type { Grade, RunFlags } from "./scoring";

export const RECORDS_VERSION = 2;
export const RECORDS_STORAGE_KEY = "neon-pulse:records";

export interface PlayRecord {
  bestScore: number;
  bestAccuracy: number;
  maxCombo: number;
  bestGrade: Grade;
  clear: boolean;
  fc: boolean;
  ap: boolean;
  updatedAt: string;
}

export interface RecordBook {
  version: typeof RECORDS_VERSION;
  entries: Record<string, PlayRecord>;
}

export interface RunRecordInput {
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: Grade;
  flags: RunFlags;
  cleared?: boolean;
}

const gradeRank: Record<Grade, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };
export const recordKey = (
  songId: string,
  difficulty: DifficultyId,
  audioVersion?: string | null,
) =>
  audioVersion?.trim()
    ? `${songId}@${encodeURIComponent(audioVersion.trim())}:${difficulty}`
    : `${songId}:${difficulty}`;

export const emptyRecordBook = (): RecordBook => ({
  version: RECORDS_VERSION,
  entries: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizePlayRecord = (value: unknown): PlayRecord | null => {
  if (!isRecord(value)) return null;
  const bestGrade = ["S", "A", "B", "C", "D"].includes(String(value.bestGrade))
    ? (value.bestGrade as Grade)
    : "D";
  return {
    bestScore: Math.min(
      1_000_000,
      Math.max(0, Math.round(finiteOr(value.bestScore, 0))),
    ),
    bestAccuracy: Math.min(100, Math.max(0, finiteOr(value.bestAccuracy, 0))),
    maxCombo: Math.max(0, Math.round(finiteOr(value.maxCombo, 0))),
    bestGrade,
    clear: value.clear === true,
    fc: value.fc === true,
    ap: value.ap === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
};

export function loadRecords(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): RecordBook {
  try {
    const raw = storage.getItem(RECORDS_STORAGE_KEY);
    if (!raw) return emptyRecordBook();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.entries))
      return emptyRecordBook();
    const entries: Record<string, PlayRecord> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      const record = normalizePlayRecord(value);
      if (record) entries[key] = record;
    }
    return { version: RECORDS_VERSION, entries };
  } catch {
    return emptyRecordBook();
  }
}

export function saveRecords(
  book: RecordBook,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(book));
  } catch {
    // Records are optional when storage is unavailable.
  }
}

export function mergeRecord(
  book: RecordBook,
  songId: string,
  difficulty: DifficultyId,
  run: RunRecordInput,
  timestamp = new Date().toISOString(),
  audioVersion?: string | null,
): { book: RecordBook; record: PlayRecord; newRecord: boolean } {
  const key = recordKey(songId, difficulty, audioVersion);
  const previous = book.entries[key];
  const record: PlayRecord = {
    bestScore: Math.max(previous?.bestScore ?? 0, run.score),
    bestAccuracy: Math.max(previous?.bestAccuracy ?? 0, run.accuracy),
    maxCombo: Math.max(previous?.maxCombo ?? 0, run.maxCombo),
    bestGrade:
      !previous || gradeRank[run.grade] > gradeRank[previous.bestGrade]
        ? run.grade
        : previous.bestGrade,
    clear: Boolean(previous?.clear || run.cleared),
    fc: Boolean(previous?.fc || run.flags.fc),
    ap: Boolean(previous?.ap || run.flags.ap),
    updatedAt: timestamp,
  };
  const newRecord = run.score > (previous?.bestScore ?? 0);
  return {
    book: {
      version: RECORDS_VERSION,
      entries: { ...book.entries, [key]: record },
    },
    record,
    newRecord,
  };
}
