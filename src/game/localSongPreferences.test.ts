import { describe, expect, it } from "vitest";
import {
  loadLocalSongPreferences,
  LOCAL_SONG_PREFERENCES_KEY,
  saveLocalSongPreferences,
  updateLocalSongPreference,
} from "./localSongPreferences";

describe("本地歌曲偏移元数据", () => {
  it("按歌曲保存独立偏移且不包含音频二进制或文件名", () => {
    const book = updateLocalSongPreference(
      loadLocalSongPreferences({ getItem: () => null }),
      "song-a",
      { userOffsetMs: 36, lastDecodedDuration: 233.4 },
    );
    let saved = "";
    saveLocalSongPreferences(book, {
      setItem: (key, value) => {
        expect(key).toBe(LOCAL_SONG_PREFERENCES_KEY);
        saved = value;
      },
    });
    expect(JSON.parse(saved).entries["song-a"]).toEqual({
      audioVersion: "玩家本地合法副本 · 版本待核验",
      userOffsetMs: 36,
      lastDecodedDuration: 233.4,
    });
    expect(saved).not.toMatch(/fileName|arrayBuffer|blob:/i);
  });

  it("损坏存档安全回退并限制偏移范围", () => {
    expect(
      loadLocalSongPreferences({ getItem: () => "not-json" }).entries,
    ).toEqual({});
    const loaded = loadLocalSongPreferences({
      getItem: () =>
        JSON.stringify({
          entries: { x: { userOffsetMs: 9000, lastDecodedDuration: -1 } },
        }),
    });
    expect(loaded.entries.x.userOffsetMs).toBe(500);
    expect(loaded.entries.x.lastDecodedDuration).toBeNull();
  });
});
