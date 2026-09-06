import rawTemplates from "./mandopop-chart-templates.json";
import { SONG_CATALOG } from "./catalog";
import type { DifficultyId } from "../game/types";

export interface DraftChartTemplate {
  status: "draft";
  description: string;
  notes: [];
}

export interface MandopopSongTemplate {
  songId: string;
  audioVersion: string;
  expectedDuration: null;
  firstBeatOffsetMs: null;
  previewStart: null;
  previewDuration: number;
  tempoMap: null;
  charts: Record<DifficultyId, DraftChartTemplate>;
}

interface MandopopTemplateManifest {
  version: number;
  status: "awaiting-matched-audio";
  notice: string;
  songs: MandopopSongTemplate[];
}

export const MANDPOP_TEMPLATE_MANIFEST =
  rawTemplates as MandopopTemplateManifest;

export function getMandopopTemplate(
  songId: string,
): MandopopSongTemplate | null {
  return (
    MANDPOP_TEMPLATE_MANIFEST.songs.find((song) => song.songId === songId) ??
    null
  );
}

/** Validates draft metadata without pretending empty templates are playable charts. */
export function validateMandopopTemplates(): string[] {
  const errors: string[] = [];
  const templateIds = new Set<string>();
  const mandopopSongs = SONG_CATALOG.filter(
    (song) => song.category === "mandopop",
  );

  for (const template of MANDPOP_TEMPLATE_MANIFEST.songs) {
    const context = `[${template.songId}]`;
    if (templateIds.has(template.songId))
      errors.push(`${context} 制谱模板歌曲 ID 重复。`);
    templateIds.add(template.songId);
    const song = mandopopSongs.find(
      (candidate) => candidate.id === template.songId,
    );
    if (!song) errors.push(`${context} 找不到对应的华语流行歌曲。`);
    if (song?.audioMode !== "local-import")
      errors.push(`${context} 必须使用 local-import 音频模式。`);
    if (
      template.expectedDuration !== null ||
      template.firstBeatOffsetMs !== null ||
      template.previewStart !== null ||
      template.tempoMap !== null
    )
      errors.push(`${context} 未测量前不得预填时长、第一拍、试听点或速度表。`);
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const draft = template.charts[difficulty];
      if (!draft || draft.status !== "draft")
        errors.push(`${context}/${difficulty} 缺少明确的 draft 模板。`);
      if (!draft?.description.trim())
        errors.push(`${context}/${difficulty} 缺少制谱方向。`);
      if (draft && draft.notes.length !== 0)
        errors.push(`${context}/${difficulty} 未匹配音频前不得伪造音符。`);
    }
  }

  for (const song of mandopopSongs) {
    if (!templateIds.has(song.id))
      errors.push(`[${song.id}] 缺少华语流行制谱模板。`);
    if (
      song.bpm !== 0 ||
      song.duration !== 0 ||
      song.expectedDuration !== null ||
      song.firstBeatOffsetMs !== null
    )
      errors.push(`[${song.id}] 未获得匹配音频前不得填写推测的 BPM 或时长。`);
  }

  if (mandopopSongs.length !== 5)
    errors.push(`华语流行歌曲应为 5 首，当前为 ${mandopopSongs.length} 首。`);
  if (MANDPOP_TEMPLATE_MANIFEST.songs.length !== 5)
    errors.push("华语流行模板应覆盖 5 首歌曲。");
  return errors;
}
