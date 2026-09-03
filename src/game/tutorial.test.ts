import { describe, expect, it, vi } from "vitest";
import {
  loadTutorialCompleted,
  saveTutorialCompleted,
  tutorialStepAfterNext,
} from "./tutorial";

describe("首次游玩教程", () => {
  it("安全读取并保存完成状态", () => {
    expect(loadTutorialCompleted({ getItem: () => null })).toBe(false);
    expect(loadTutorialCompleted({ getItem: () => "complete" })).toBe(true);
    expect(loadTutorialCompleted({ getItem: () => "broken" })).toBe(false);
    const setItem = vi.fn();
    saveTutorialCompleted({ setItem });
    expect(setItem).toHaveBeenCalledWith("neon-pulse:tutorial:v1", "complete");
  });

  it("完成第四步后结束而不是写入正式成绩", () => {
    expect(tutorialStepAfterNext(0)).toBe(1);
    expect(tutorialStepAfterNext(2)).toBe(3);
    expect(tutorialStepAfterNext(3)).toBeNull();
  });
});
