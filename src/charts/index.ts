import easyData from "./chromatic-run-easy.json";
import normalData from "./chromatic-run-normal.json";
import hardData from "./chromatic-run-hard.json";
import midnightEasyData from "./midnight-arcade-easy.json";
import midnightNormalData from "./midnight-arcade-normal.json";
import midnightHardData from "./midnight-arcade-hard.json";
import beethoven5EasyData from "./beethoven-5-op67-easy.json";
import beethoven5NormalData from "./beethoven-5-op67-normal.json";
import beethoven5HardData from "./beethoven-5-op67-hard.json";
import mozart40EasyData from "./mozart-40-k550-easy.json";
import mozart40NormalData from "./mozart-40-k550-normal.json";
import mozart40HardData from "./mozart-40-k550-hard.json";
import newWorldEasyData from "./dvorak-9-op95-easy.json";
import newWorldNormalData from "./dvorak-9-op95-normal.json";
import newWorldHardData from "./dvorak-9-op95-hard.json";
import odeEasyData from "./beethoven-9-op125-easy.json";
import odeNormalData from "./beethoven-9-op125-normal.json";
import odeHardData from "./beethoven-9-op125-hard.json";
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
  "beethoven-5-op67:easy": beethoven5EasyData,
  "beethoven-5-op67:normal": beethoven5NormalData,
  "beethoven-5-op67:hard": beethoven5HardData,
  "mozart-40-k550:easy": mozart40EasyData,
  "mozart-40-k550:normal": mozart40NormalData,
  "mozart-40-k550:hard": mozart40HardData,
  "dvorak-9-op95:easy": newWorldEasyData,
  "dvorak-9-op95:normal": newWorldNormalData,
  "dvorak-9-op95:hard": newWorldHardData,
  "beethoven-9-op125:easy": odeEasyData,
  "beethoven-9-op125:normal": odeNormalData,
  "beethoven-9-op125:hard": odeHardData,
};

export { DEMO_SONG, SONG_CATALOG };

export function loadBuiltInChart(
  songId: string,
  difficulty: DifficultyId,
): ChartLoadResult {
  const song = findSong(songId);
  if (!song) return { ok: false, errors: [`找不到歌曲 “${songId}”。`] };
  if (song.audioMode === "local-import") {
    return {
      ok: false,
      errors: [
        `歌曲 “${song.title}” 需要先导入有权使用的匹配音频；当前仅提供待制谱模板。`,
      ],
    };
  }
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
