import { describe, expect, it } from "vitest";
import licenses from "./music-licenses.json";
import { SONG_CATALOG } from "./catalog";
import {
  MANDPOP_TEMPLATE_MANIFEST,
  validateMandopopTemplates,
} from "./mandopopTemplates";

describe("华语流行本地导入清单", () => {
  it("展示五首歌曲和十五个明确未完成的制谱模板", () => {
    const songs = SONG_CATALOG.filter((song) => song.category === "mandopop");
    expect(songs.map((song) => song.title)).toEqual([
      "晴天",
      "七里香",
      "夜曲",
      "稻香",
      "青花瓷",
    ]);
    expect(MANDPOP_TEMPLATE_MANIFEST.songs).toHaveLength(5);
    expect(
      MANDPOP_TEMPLATE_MANIFEST.songs.flatMap((song) =>
        Object.values(song.charts),
      ),
    ).toHaveLength(15);
    expect(validateMandopopTemplates()).toEqual([]);
  });

  it("不内置录音且不预填未经测量的音频数据或音符", () => {
    expect(licenses.bundledAudio).toEqual([]);
    for (const song of MANDPOP_TEMPLATE_MANIFEST.songs) {
      expect(song.expectedDuration).toBeNull();
      expect(song.firstBeatOffsetMs).toBeNull();
      expect(song.tempoMap).toBeNull();
      for (const chart of Object.values(song.charts))
        expect(chart.notes).toEqual([]);
    }
  });
});
