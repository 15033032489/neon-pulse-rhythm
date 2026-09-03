import {
  DIFFICULTIES,
  scoringUnitsForNote,
  type ChartDefinition,
  type ChartLoadResult,
  type ChartNote,
  type DifficultyId,
  type Lane,
  type SongDefinition,
} from "../game/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const noteOrder = (left: ChartNote, right: ChartNote) =>
  left.time - right.time ||
  left.lane - right.lane ||
  left.id.localeCompare(right.id);

export function parseChart(
  input: unknown,
  song: SongDefinition,
): ChartLoadResult {
  if (!isRecord(input))
    return { ok: false, errors: ["谱面根节点必须是 JSON 对象。"] };

  const errors: string[] = [];
  const warnings: string[] = [];

  const id =
    typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
  const songId =
    typeof input.songId === "string" && input.songId.trim()
      ? input.songId.trim()
      : "";
  const difficulty = DIFFICULTIES.includes(input.difficulty as DifficultyId)
    ? (input.difficulty as DifficultyId)
    : null;
  const level = isFiniteNumber(input.level) ? input.level : Number.NaN;

  if (!id) errors.push("谱面缺少有效的 id。");
  if (songId !== song.id) errors.push(`谱面的 songId 必须是 “${song.id}”。`);
  if (!difficulty) errors.push("difficulty 必须是 easy、normal 或 hard。");
  if (!Number.isInteger(level) || level < 1 || level > 99) {
    errors.push("level 必须是 1 到 99 之间的整数。");
  }
  if (!Array.isArray(input.notes)) errors.push("notes 必须是数组。");

  const notes: ChartNote[] = [];
  const noteIds = new Set<string>();

  if (Array.isArray(input.notes)) {
    input.notes.forEach((rawNote, index) => {
      const label = `notes[${index}]`;
      if (!isRecord(rawNote)) {
        errors.push(`${label} 必须是对象。`);
        return;
      }

      const noteId =
        typeof rawNote.id === "string" && rawNote.id.trim()
          ? rawNote.id.trim()
          : "";
      const time = isFiniteNumber(rawNote.time) ? rawNote.time : Number.NaN;
      const lane = rawNote.lane;
      const type = rawNote.type;

      if (!noteId) errors.push(`${label}.id 必须是非空字符串。`);
      if (noteId && noteIds.has(noteId))
        errors.push(`${label}.id “${noteId}” 重复。`);
      if (noteId) noteIds.add(noteId);
      if (!Number.isFinite(time) || time < 0)
        errors.push(`${label}.time 必须是非负有限数。`);
      if (
        !Number.isInteger(lane) ||
        (lane as number) < 0 ||
        (lane as number) > 3
      ) {
        errors.push(`${label}.lane 必须是 0、1、2 或 3。`);
      }
      if (type !== "tap" && type !== "hold") {
        errors.push(`${label}.type 必须是 tap 或 hold。`);
      }

      let duration: number | undefined;
      if (type === "hold") {
        duration = isFiniteNumber(rawNote.duration)
          ? rawNote.duration
          : Number.NaN;
        if (!Number.isFinite(duration) || duration <= 0) {
          errors.push(`${label}.duration 必须是正有限数。`);
        }
      }

      if (
        !noteId ||
        !Number.isFinite(time) ||
        time < 0 ||
        !Number.isInteger(lane) ||
        (lane as number) < 0 ||
        (lane as number) > 3 ||
        (type !== "tap" && type !== "hold") ||
        (type === "hold" &&
          (!Number.isFinite(duration) || (duration as number) <= 0))
      ) {
        return;
      }

      const endTime = time + (duration ?? 0);
      if (endTime > song.duration + 0.001) {
        errors.push(
          `${label} 的结束时间 ${endTime.toFixed(3)}s 超出歌曲时长。`,
        );
        return;
      }

      notes.push(
        type === "hold"
          ? {
              id: noteId,
              time,
              lane: lane as Lane,
              type,
              duration: duration as number,
            }
          : { id: noteId, time, lane: lane as Lane, type },
      );
    });
  }

  if (notes.length === 0) errors.push("谱面至少需要一个有效音符。");

  const sortedNotes = [...notes].sort(noteOrder);
  if (notes.some((note, index) => note !== sortedNotes[index])) {
    warnings.push("音符未按时间排序，已在加载时自动排序。");
  }

  const notesByLane: [ChartNote[], ChartNote[], ChartNote[], ChartNote[]] = [
    [],
    [],
    [],
    [],
  ];
  for (const note of sortedNotes) notesByLane[note.lane].push(note);

  for (const laneNotes of notesByLane) {
    for (let index = 0; index < laneNotes.length - 1; index += 1) {
      const note = laneNotes[index];
      const next = laneNotes[index + 1];
      if (
        note.type === "hold" &&
        next.time < note.time + note.duration - 0.001
      ) {
        errors.push(
          `轨道 ${note.lane + 1} 的音符 “${next.id}” 与 Hold “${note.id}” 重叠。`,
        );
      }
    }
  }

  if (errors.length > 0 || !difficulty) return { ok: false, errors };

  const definition: ChartDefinition = {
    id,
    songId,
    difficulty,
    level,
    notes: sortedNotes,
  };

  return {
    ok: true,
    chart: {
      ...definition,
      song,
      noteCount: sortedNotes.length,
      notesByLane,
      totalScoringUnits: sortedNotes.reduce(
        (total, note) => total + scoringUnitsForNote(note),
        0,
      ),
    },
    warnings,
  };
}
