import type { SongDefinition } from "../game/types";

export const SONG_CATALOG: SongDefinition[] = [
  {
    id: "chromatic-run",
    title: "Chromatic Run",
    artist: "Neon Pulse Lab",
    bpm: 128,
    duration: 23.5,
    subtitle: "原创 Web Audio 合成电子曲",
    synthProfile: "chromatic",
    accent: "cyan",
  },
  {
    id: "midnight-arcade",
    title: "Midnight Arcade",
    artist: "Neon Pulse Lab",
    bpm: 102,
    duration: 52,
    subtitle: "原创低速碎拍与夜行合成波",
    synthProfile: "night-drive",
    accent: "violet",
  },
];

export const DEMO_SONG = SONG_CATALOG[0];

export const findSong = (songId: string) =>
  SONG_CATALOG.find((song) => song.id === songId);
