import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const songs = [
  {
    id: "beethoven-5-op67",
    bpm: 108,
    duration: 72,
    levels: { easy: 5, normal: 9, hard: 13 },
    descriptions: {
      easy: "以短短短长动机和强拍落点练习换手，穿插少量铜管式短 Hold。",
      normal: "跟随动机移位、弦乐应答与定音鼓重音，加入切分双押和旋律 Hold。",
      hard: "密集动机连打叠加强奏和弦，在单手 Hold 上完成另一手的主题应答。",
    },
    patterns: {
      easy: [
        [0, 1, 0, 2],
        [1, 2, 1, 3],
        [3, 2, 3, 1],
        [0, 2, [0, 3], 1],
      ],
      normal: [
        [0, 1, 0, 2, 1, 2, 1, [0, 3]],
        [1, 0, 1, 3, 2, 1, 2, [0, 3]],
        [3, 2, 3, 1, 2, 0, 2, [1, 3]],
        [-1, 0, 2, 0, 1, 3, 1, [0, 2]],
      ],
      hard: [
        [0, 1, 0, 2, 0, 1, 3, 2, 1, 0, 2, 3, 1, 2, [0, 3], 1],
        [1, 2, 1, 3, 1, 0, 2, 3, 2, 1, 3, 0, 2, [0, 3], 1, 2],
        [3, 2, 3, 1, 3, 2, 0, 1, 2, 3, 1, 0, [1, 3], 2, 0, 1],
        [0, 2, 0, 3, 1, 2, 1, 3, 0, 1, 2, 0, 3, [0, 2], 1, 3],
      ],
    },
  },
  {
    id: "mozart-40-k550",
    bpm: 132,
    duration: 68,
    levels: { easy: 6, normal: 10, hard: 14 },
    descriptions: {
      easy: "沿敏捷弦乐主题的上行与回落练习八分音符，短 Hold 对应木管延音。",
      normal: "旋律在左右手间快速交替，切分应答和轻量双押描绘弦乐分句。",
      hard: "十六分音符流动穿插声部追逐，以清晰手型处理快速主题与和声 Hold。",
    },
    patterns: {
      easy: [
        [2, 1, 2, 0],
        [3, 2, 1, 0],
        [1, 2, 3, 1],
        [2, 0, 1, 3],
      ],
      normal: [
        [2, 1, 2, 0, 1, 2, 1, 3],
        [3, 2, 1, 0, 2, 1, [0, 3], 2],
        [1, 2, 3, 1, -1, 2, 0, 1],
        [2, 0, 1, 3, 2, [0, 2], 1, 3],
      ],
      hard: [
        [2, 1, 2, 0, 1, 2, 3, 1, 2, 0, 2, 1, 3, 2, 1, 0],
        [3, 2, 1, 0, 1, 3, 2, 0, 2, 1, 3, 1, [0, 2], 3, 2, 1],
        [1, 2, 3, 1, 2, 0, 1, 3, 2, 1, 0, 2, 3, [0, 3], 1, 2],
        [2, 0, 1, 3, 1, 2, 0, 3, 2, 1, 3, 0, [1, 3], 2, 0, 1],
      ],
    },
  },
  {
    id: "dvorak-9-op95",
    bpm: 96,
    duration: 80,
    levels: { easy: 5, normal: 9, hard: 13 },
    descriptions: {
      easy: "在低音弦乐步伐和定音鼓强拍上稳健落键，用短 Hold 感受铜管推进。",
      normal:
        "厚重主题与切分伴奏交替，双押表现管弦齐奏，长短 Hold 形成戏剧张力。",
      hard: "以低音固定音型托住密集铜管节奏，加入重音和弦和跨手型复合段落。",
    },
    patterns: {
      easy: [
        [0, -1, 1, 2],
        [0, 2, -1, 3],
        [1, -1, 0, 2],
        [[0, 3], 1, -1, 2],
      ],
      normal: [
        [0, -1, 1, 0, 2, 1, 3, [0, 2]],
        [0, 2, 1, -1, 3, 2, 1, [0, 3]],
        [1, 0, -1, 2, 0, 3, 2, [1, 3]],
        [[0, 3], 1, 2, 0, -1, 2, 1, 3],
      ],
      hard: [
        [0, 1, 0, 2, -1, 1, 3, 2, 0, 2, 1, 3, [0, 3], 2, 1, 0],
        [0, 2, 1, 0, 3, 1, 2, -1, 0, 3, 2, 1, [0, 2], 3, 1, 2],
        [1, 0, 1, 2, 0, 3, 2, 1, -1, 2, 3, 0, [1, 3], 2, 0, 1],
        [[0, 3], 1, 2, 0, 3, 2, 1, 0, 2, -1, 3, 1, [0, 2], 3, 2, 1],
      ],
    },
  },
  {
    id: "beethoven-9-op125",
    bpm: 100,
    duration: 78,
    levels: { easy: 4, normal: 8, hard: 12 },
    descriptions: {
      easy: "沿欢乐颂主题的级进旋律练习主拍，少量短 Hold 对应乐句长音。",
      normal:
        "主旋律与内声部交替，逐段加入切分、和声双押与不同长度的旋律 Hold。",
      hard: "在主题高潮中同时处理旋律、分解和弦和重拍，单手 Hold 保留另一手的流动。",
    },
    patterns: {
      easy: [
        [1, 1, 2, 3],
        [3, 2, 1, 0],
        [0, 0, 1, 2],
        [2, 1, 1, -1],
      ],
      normal: [
        [1, 0, 1, 2, 3, 2, 3, [0, 2]],
        [3, 1, 2, 0, 1, 3, 0, [1, 3]],
        [0, 2, 0, 1, 2, 1, 2, [0, 3]],
        [2, 0, 1, 3, 1, 2, 1, -1],
      ],
      hard: [
        [1, 0, 1, 2, 1, 3, 2, 3, 1, 2, 0, 2, [0, 3], 1, 2, 0],
        [3, 1, 2, 0, 2, 1, 3, 0, 1, 2, 3, 1, [0, 2], 3, 1, 2],
        [0, 2, 0, 1, 3, 2, 1, 2, 0, 1, 2, 3, [1, 3], 2, 0, 1],
        [2, 0, 1, 3, 1, 2, 0, 3, 2, 1, 3, 0, [0, 3], 1, 2, 1],
      ],
    },
  },
];

const grids = { easy: 1, normal: 2, hard: 4 };
const holdRules = {
  easy: { firstMeasure: 4, every: 9, durationBeats: [0.8, 1] },
  normal: { firstMeasure: 3, every: 6, durationBeats: [1.25, 1.75, 1] },
  hard: { firstMeasure: 2, every: 5, durationBeats: [1.5, 2, 1.25] },
};

const round = (value) => Number(value.toFixed(6));

function buildChart(song, difficulty, songIndex) {
  const beat = 60 / song.bpm;
  const grid = grids[difficulty];
  const measureDuration = beat * 4;
  const startTime = beat * 4;
  const lastTime = song.duration - beat * 2;
  const patterns = song.patterns[difficulty];
  let notes = [];

  for (
    let measure = 0, measureTime = startTime;
    measureTime < lastTime;
    measure += 1, measureTime += measureDuration
  ) {
    const pattern = patterns[measure % patterns.length];
    for (let unit = 0; unit < pattern.length; unit += 1) {
      const time = measureTime + (unit / grid) * beat;
      if (time >= lastTime) break;
      const event = pattern[unit];
      if (event === -1) continue;
      const lanes = Array.isArray(event) ? event : [event];
      for (const lane of lanes)
        notes.push({ time: round(time), lane, type: "tap" });
    }
  }

  const holdRule = holdRules[difficulty];
  for (
    let measure = holdRule.firstMeasure;
    startTime + measure * measureDuration < lastTime - beat * 2;
    measure += holdRule.every
  ) {
    const time = round(startTime + measure * measureDuration + beat / grid);
    const lane = (measure + songIndex + grids[difficulty]) % 4;
    const duration = round(
      beat *
        holdRule.durationBeats[
          Math.floor(measure / holdRule.every) % holdRule.durationBeats.length
        ],
    );
    notes = notes.filter(
      (note) =>
        note.lane !== lane ||
        note.time < time - 0.0005 ||
        note.time >= time + duration - 0.0005,
    );
    notes.push({ time, lane, type: "hold", duration });
  }

  notes.sort((left, right) => left.time - right.time || left.lane - right.lane);
  notes = notes.map((note, index) => ({
    id: `${difficulty[0]}${String(index + 1).padStart(4, "0")}`,
    ...note,
  }));

  return {
    id: `${song.id}-${difficulty}`,
    songId: song.id,
    difficulty,
    level: song.levels[difficulty],
    description: song.descriptions[difficulty],
    notes,
  };
}

for (const [songIndex, song] of songs.entries()) {
  for (const difficulty of ["easy", "normal", "hard"]) {
    const chart = buildChart(song, difficulty, songIndex);
    const path = resolve(
      ROOT,
      "src",
      "charts",
      `${song.id}-${difficulty}.json`,
    );
    await writeFile(path, `${JSON.stringify(chart, null, 2)}\n`, "utf8");
  }
}

console.log(
  songs
    .flatMap((song, songIndex) =>
      ["easy", "normal", "hard"].map((difficulty) => {
        const chart = buildChart(song, difficulty, songIndex);
        const holds = chart.notes.filter((note) => note.type === "hold").length;
        return `${chart.id}: ${chart.notes.length} notes (${holds} holds)`;
      }),
    )
    .join("\n"),
);

