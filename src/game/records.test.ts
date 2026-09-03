import { describe, expect, it } from "vitest";
import {
  emptyRecordBook,
  loadRecords,
  mergeRecord,
  RECORDS_STORAGE_KEY,
} from "./records";

describe("成绩记录", () => {
  it("按歌曲和难度合并各项最佳值并标记最高分新纪录", () => {
    const first = mergeRecord(
      emptyRecordBook(),
      "song",
      "hard",
      {
        score: 800_000,
        accuracy: 88,
        maxCombo: 80,
        grade: "B",
        flags: { fc: false, ap: false },
      },
      "2026-01-01",
    );
    const second = mergeRecord(
      first.book,
      "song",
      "hard",
      {
        score: 790_000,
        accuracy: 92,
        maxCombo: 120,
        grade: "A",
        flags: { fc: true, ap: false },
      },
      "2026-01-02",
    );
    expect(first.newRecord).toBe(true);
    expect(second.newRecord).toBe(false);
    expect(second.record).toMatchObject({
      bestScore: 800_000,
      bestAccuracy: 92,
      maxCombo: 120,
      bestGrade: "A",
      fc: true,
      ap: false,
    });
  });

  it("不会把零分首局标成 New Record", () => {
    const result = mergeRecord(emptyRecordBook(), "song", "easy", {
      score: 0,
      accuracy: 0,
      maxCombo: 0,
      grade: "D",
      flags: { fc: false, ap: false },
    });
    expect(result.newRecord).toBe(false);
  });

  it("清理损坏或越界的本地记录", () => {
    const storage = {
      getItem: (key: string) =>
        key === RECORDS_STORAGE_KEY
          ? JSON.stringify({
              entries: {
                "song:normal": {
                  bestScore: 9_000_000,
                  bestAccuracy: Number.NaN,
                  maxCombo: -4,
                  bestGrade: "X",
                  fc: "yes",
                  ap: false,
                },
              },
            })
          : null,
    };
    expect(loadRecords(storage).entries["song:normal"]).toMatchObject({
      bestScore: 1_000_000,
      bestAccuracy: 0,
      maxCombo: 0,
      bestGrade: "D",
      fc: false,
      ap: false,
    });
  });
});
