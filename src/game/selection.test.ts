import { describe, expect, it, vi } from "vitest";
import {
  loadSelection,
  saveSelection,
  SELECTION_STORAGE_KEY,
} from "./selection";

const songIds = ["chromatic-run", "midnight-arcade"];

describe("选曲记忆", () => {
  it("首次访问默认首曲 Easy", () => {
    const storage = { getItem: vi.fn(() => null) };
    expect(loadSelection(songIds, storage)).toMatchObject({
      songId: "chromatic-run",
      difficulty: "easy",
    });
  });

  it("读取上次歌曲和难度，并兼容无版本旧结构", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === "neon-pulse:last-selection"
          ? JSON.stringify({ songId: "midnight-arcade", difficulty: "hard" })
          : null,
      ),
    };
    expect(loadSelection(songIds, storage)).toMatchObject({
      songId: "midnight-arcade",
      difficulty: "hard",
    });
  });

  it("损坏或未知歌曲安全回退且保存使用版本化键", () => {
    const broken = { getItem: vi.fn(() => "{broken") };
    expect(loadSelection(songIds, broken).difficulty).toBe("easy");
    const setItem = vi.fn();
    saveSelection(
      { version: 1, songId: "chromatic-run", difficulty: "normal" },
      { setItem },
    );
    expect(setItem).toHaveBeenCalledWith(
      SELECTION_STORAGE_KEY,
      expect.stringContaining('"version":1'),
    );
  });

  it("旧玩家没有选曲键时从最近一局正式成绩迁移选择", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === "neon-pulse:records"
          ? JSON.stringify({
              entries: {
                "chromatic-run:easy": { updatedAt: "2026-01-01" },
                "midnight-arcade:hard": { updatedAt: "2026-02-01" },
              },
            })
          : null,
      ),
    };
    expect(loadSelection(songIds, storage)).toMatchObject({
      songId: "midnight-arcade",
      difficulty: "hard",
    });
  });
});
