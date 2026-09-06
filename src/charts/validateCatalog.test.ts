import { describe, expect, it } from "vitest";
import { validateBuiltInCatalog } from "./validateCatalog";

describe("开发环境内置谱面验证器", () => {
  it("6 首可玩歌曲、18 套谱面和华语流行模板全部满足严格规则", () => {
    expect(validateBuiltInCatalog()).toEqual([]);
  });
});
