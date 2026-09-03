import easyData from "./chromatic-run-easy.json";
import normalData from "./chromatic-run-normal.json";
import hardData from "./chromatic-run-hard.json";
import midnightEasyData from "./midnight-arcade-easy.json";
import midnightNormalData from "./midnight-arcade-normal.json";
import midnightHardData from "./midnight-arcade-hard.json";
import { DEMO_SONG, SONG_CATALOG, findSong } from "../songs/catalog";
import { parseChart } from "./parseChart";
import type { ChartLoadResult, DifficultyId } from "../game/types";

const RAW_CHARTS: Record<string, unknown> = {
  "chromatic-run:easy": easyData,
  "chromatic-run:normal": normalData,
  "chromatic-run:hard": hardData,
  "midnight-arcade:easy": midnightEasyData,
  "midnight-arcade:normal": midnightNormalData,
  "midnight-arcade:hard": midnightHardData,
};

export { DEMO_SONG, SONG_CATALOG };

export function loadBuiltInChart(
  songId: string,
  difficulty: DifficultyId,
): ChartLoadResult {
  const song = findSong(songId);
  if (!song) return { ok: false, errors: [`找不到歌曲 “${songId}”。`] };
  const rawChart = RAW_CHARTS[`${songId}:${difficulty}`];
  if (!rawChart) {
    return {
      ok: false,
      errors: [`歌曲 “${song.title}” 没有 ${difficulty} 谱面。`],
    };
  }
  return parseChart(rawChart, song);
}

export const DEFAULT_CHART_RESULT = loadBuiltInChart(DEMO_SONG.id, "normal");
