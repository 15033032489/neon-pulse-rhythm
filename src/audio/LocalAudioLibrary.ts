export const MAX_LOCAL_AUDIO_BYTES = 150 * 1024 * 1024;
export const DEFAULT_DURATION_TOLERANCE_SECONDS = 2;

export interface LocalAudioFile {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface LocalAudioAsset {
  songId: string;
  fileName: string;
  fileType: string;
  duration: number;
  objectUrl: string;
  buffer: AudioBuffer;
}

export interface LocalAudioImportResult {
  asset: LocalAudioAsset;
  evictedSongIds: string[];
}

export interface LocalUrlApi {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export type AudioDecoder = (data: ArrayBuffer) => Promise<AudioBuffer>;

const SUPPORTED_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".webm",
  ".mp4",
];

export class LocalAudioImportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "empty"
      | "too-large"
      | "unsupported"
      | "decode"
      | "cancelled",
  ) {
    super(message);
    this.name = "LocalAudioImportError";
  }
}

function validateFile(file: LocalAudioFile): void {
  if (file.size <= 0)
    throw new LocalAudioImportError("所选音频文件为空。", "empty");
  if (file.size > MAX_LOCAL_AUDIO_BYTES)
    throw new LocalAudioImportError(
      "音频文件超过 150 MB，请选择体积更小的合法副本。",
      "too-large",
    );
  const lowerName = file.name.toLowerCase();
  const extensionAllowed = SUPPORTED_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );
  const typeAllowed =
    file.type.startsWith("audio/") ||
    file.type === "video/mp4" ||
    file.type === "video/webm";
  if (!extensionAllowed && !typeAllowed)
    throw new LocalAudioImportError(
      "无法识别该格式。请选择 MP3、WAV、M4A、AAC、OGG、FLAC、WebM 或 MP4 音频。",
      "unsupported",
    );
}

export interface DurationValidation {
  status: "unverified" | "matched" | "mismatch";
  differenceSeconds: number | null;
  message: string;
}

export function validateLocalAudioDuration(
  actualDuration: number,
  expectedDuration: number | null | undefined,
  toleranceSeconds = DEFAULT_DURATION_TOLERANCE_SECONDS,
): DurationValidation {
  if (!Number.isFinite(expectedDuration) || (expectedDuration ?? 0) <= 0) {
    return {
      status: "unverified",
      differenceSeconds: null,
      message:
        "当前没有已授权的基准音频，无法自动确认版本、前奏与同步；正式谱面仍待匹配音频后制作。",
    };
  }
  const differenceSeconds = Math.abs(
    actualDuration - (expectedDuration as number),
  );
  if (differenceSeconds > toleranceSeconds) {
    return {
      status: "mismatch",
      differenceSeconds,
      message: `音频时长与目标版本相差 ${differenceSeconds.toFixed(1)} 秒，可能无法同步。`,
    };
  }
  return {
    status: "matched",
    differenceSeconds,
    message: "音频时长符合目标版本范围，仍建议完成歌曲独立延迟校准。",
  };
}

/** Keeps decoded local files in memory only and revokes every object URL deterministically. */
export class LocalAudioLibrary {
  private entries = new Map<string, LocalAudioAsset & { lastUsed: number }>();
  private generations = new Map<string, number>();
  private clock = 0;

  constructor(
    private readonly maxEntries = 2,
    private readonly urlApi: LocalUrlApi = URL,
  ) {}

  async importFile(
    songId: string,
    file: LocalAudioFile,
    decode: AudioDecoder,
  ): Promise<LocalAudioImportResult> {
    validateFile(file);
    const generation = (this.generations.get(songId) ?? 0) + 1;
    this.generations.set(songId, generation);
    const objectUrl = this.urlApi.createObjectURL(file as unknown as Blob);
    let buffer: AudioBuffer;
    try {
      const data = await file.arrayBuffer();
      buffer = await decode(data);
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 1)
        throw new LocalAudioImportError(
          "解码后的音频时长无效，文件可能已损坏。",
          "decode",
        );
    } catch (error) {
      this.urlApi.revokeObjectURL(objectUrl);
      if (error instanceof LocalAudioImportError) throw error;
      throw new LocalAudioImportError(
        "音频解码失败。文件可能损坏，或浏览器不支持该编码格式。",
        "decode",
      );
    }

    if (this.generations.get(songId) !== generation) {
      this.urlApi.revokeObjectURL(objectUrl);
      throw new LocalAudioImportError(
        "较新的音频选择已取代本次导入。",
        "cancelled",
      );
    }

    this.clear(songId);
    const asset: LocalAudioAsset = {
      songId,
      fileName: file.name,
      fileType: file.type,
      duration: buffer.duration,
      objectUrl,
      buffer,
    };
    this.entries.set(songId, { ...asset, lastUsed: ++this.clock });
    const evictedSongIds: string[] = [];
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = [...this.entries.values()]
        .filter((entry) => entry.songId !== songId)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!oldest) break;
      evictedSongIds.push(oldest.songId);
      this.clear(oldest.songId);
    }
    return { asset, evictedSongIds };
  }

  get(songId: string): LocalAudioAsset | null {
    const entry = this.entries.get(songId);
    if (!entry) return null;
    entry.lastUsed = ++this.clock;
    return entry;
  }

  has(songId: string): boolean {
    return this.entries.has(songId);
  }

  clear(songId: string): boolean {
    const entry = this.entries.get(songId);
    this.generations.set(songId, (this.generations.get(songId) ?? 0) + 1);
    if (!entry) return false;
    this.entries.delete(songId);
    this.urlApi.revokeObjectURL(entry.objectUrl);
    return true;
  }

  clearAll(): void {
    for (const songId of [...this.entries.keys()]) this.clear(songId);
  }

  size(): number {
    return this.entries.size;
  }
}
