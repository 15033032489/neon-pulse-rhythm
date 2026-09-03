import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  areBindingsUnique,
  loadSettings,
  migrateSettings,
  SETTINGS_STORAGE_KEY,
} from "./settings";

describe("设置迁移", () => {
  it("把旧版速度和偏移升级为带版本号的完整结构", () => {
    expect(migrateSettings({ noteSpeed: 1.5, audioOffsetMs: -35 })).toEqual({
      ...DEFAULT_SETTINGS,
      noteSpeed: 1.5,
      audioOffsetMs: -35,
    });
  });

  it("限制越界数值并修复错误类型", () => {
    expect(
      migrateSettings({
        noteSpeed: 99,
        audioOffsetMs: -999,
        masterVolume: 2,
        musicVolume: -1,
        hitVolume: "loud",
        muted: true,
      }),
    ).toMatchObject({
      version: 3,
      noteSpeed: 1.75,
      audioOffsetMs: -200,
      masterVolume: 1,
      musicVolume: 0,
      hitVolume: DEFAULT_SETTINGS.hitVolume,
      muted: true,
    });
  });

  it("检测重复键位并让损坏键位回退到 D/F/J/K", () => {
    expect(areBindingsUnique(["KeyD", "KeyF", "KeyJ", "KeyD"])).toBe(false);
    expect(
      migrateSettings({ laneBindings: ["KeyD", "KeyF", "KeyJ", "KeyD"] })
        .laneBindings,
    ).toEqual(DEFAULT_SETTINGS.laneBindings);
  });

  it("损坏的 localStorage 数据不会阻止启动", () => {
    const storage = {
      getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? "{bad" : null),
    };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});
