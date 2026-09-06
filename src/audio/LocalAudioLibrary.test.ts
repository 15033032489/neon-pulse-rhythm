import { describe, expect, it } from "vitest";
import {
  LocalAudioImportError,
  LocalAudioLibrary,
  validateLocalAudioDuration,
  type LocalAudioFile,
} from "./LocalAudioLibrary";

const file = (name = "local.mp3", size = 32): LocalAudioFile =>
  ({
    name,
    size,
    type: "audio/mpeg",
    lastModified: 1,
    arrayBuffer: async () => new ArrayBuffer(size),
  }) as LocalAudioFile;

const buffer = (duration: number) => ({ duration }) as AudioBuffer;

describe("本地音频内存库", () => {
  it("只缓存限定数量并在替换、淘汰和清理时释放对象 URL", async () => {
    const revoked: string[] = [];
    let sequence = 0;
    const library = new LocalAudioLibrary(2, {
      createObjectURL: () => `blob:test-${++sequence}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    await library.importFile("a", file("a.mp3"), async () => buffer(100));
    await library.importFile("b", file("b.mp3"), async () => buffer(101));
    await library.importFile("c", file("c.mp3"), async () => buffer(102));
    expect(library.has("a")).toBe(false);
    expect(library.size()).toBe(2);
    expect(revoked).toContain("blob:test-1");
    library.clearAll();
    expect(library.size()).toBe(0);
    expect(new Set(revoked)).toEqual(
      new Set(["blob:test-1", "blob:test-2", "blob:test-3"]),
    );
  });

  it("拒绝空文件和损坏音频并释放临时 URL", async () => {
    const revoked: string[] = [];
    const library = new LocalAudioLibrary(2, {
      createObjectURL: () => "blob:failed",
      revokeObjectURL: (url) => revoked.push(url),
    });
    await expect(
      library.importFile("a", file("empty.mp3", 0), async () => buffer(10)),
    ).rejects.toMatchObject({ code: "empty" });
    await expect(
      library.importFile("a", file(), async () => {
        throw new Error("decode");
      }),
    ).rejects.toBeInstanceOf(LocalAudioImportError);
    expect(revoked).toEqual(["blob:failed"]);
  });

  it("未提供合法基准时不猜测同步，提供基准后检测时长差", () => {
    expect(validateLocalAudioDuration(240, null).status).toBe("unverified");
    expect(validateLocalAudioDuration(240, 241).status).toBe("matched");
    expect(validateLocalAudioDuration(240, 246).status).toBe("mismatch");
  });
});
