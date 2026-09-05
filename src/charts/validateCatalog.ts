import { SONG_CATALOG, loadBuiltInChart } from ".";
import {
  applyHoldCompletion,
  applyJudgement,
  calculateNormalizedScore,
  createInitialStats,
  judgementCount,
  RULESET,
} from "../game/scoring";
import type { DifficultyId } from "../game/types";

const DIFFICULTIES: DifficultyId[] = ["easy", "normal", "hard"];

/** Performs strict development-time checks for every bundled song and chart. */
export function validateBuiltInCatalog(): string[] {
  const errors: string[] = [];
  const songIds = new Set<string>();
  const chartIds = new Set<string>();

  for (const song of SONG_CATALOG) {
    if (songIds.has(song.id)) errors.push(`[${song.id}] 歌曲 ID 重复。`);
    songIds.add(song.id);
    for (const difficulty of DIFFICULTIES) {
      const context = `[${song.id}/${difficulty}]`;
      const result = loadBuiltInChart(song.id, difficulty);
      if (!result.ok) {
        result.errors.forEach((error) => errors.push(`${context} ${error}`));
        continue;
      }
      if (result.warnings.length)
        result.warnings.forEach((warning) =>
          errors.push(
            `${context} ${warning.replace("已在加载时自动排序", "必须在 JSON 中预先排序")}`,
          ),
        );
      const { chart } = result;
      if (chartIds.has(chart.id))
        errors.push(`${context} 谱面 ID “${chart.id}” 重复。`);
      chartIds.add(chart.id);
      let perfectStats = createInitialStats();
      chart.notes.forEach((note, index) => {
        const end = note.time + (note.type === "hold" ? note.duration : 0);
        if (note.lane < 0 || note.lane > 3)
          errors.push(`${context} notes[${index}] 轨道必须是 0～3。`);
        if (note.time < 0 || end > song.duration + 0.001)
          errors.push(`${context} notes[${index}] 时间超出歌曲范围。`);
        perfectStats = applyJudgement(perfectStats, "perfect", 0);
        if (note.type === "hold")
          perfectStats = applyHoldCompletion(perfectStats);
      });
      if (judgementCount(perfectStats) !== chart.noteCount)
        errors.push(`${context} 主判定总数与谱面音符数不一致。`);
      if (
        perfectStats.processedScoreUnits !== chart.totalScoringUnits ||
        calculateNormalizedScore(perfectStats, chart.totalScoringUnits) !==
          RULESET.normalizedMaximum
      )
        errors.push(`${context} 理论最高分不是 1,000,000。`);
    }
  }
  return errors;
}
