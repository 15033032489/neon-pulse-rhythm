export type AuxiliaryAudioMode = "preview" | "calibration" | "tutorial";

interface ActiveAudioActivity {
  mode: AuxiliaryAudioMode;
  cleanup: () => void;
}

/** Owns exactly one non-game audio activity and guarantees its cleanup. */
export class AudioActivityController {
  private active: ActiveAudioActivity | null = null;

  start(mode: AuxiliaryAudioMode, cleanup: () => void): void {
    this.stop();
    this.active = { mode, cleanup };
  }

  stop(mode?: AuxiliaryAudioMode): boolean {
    if (!this.active || (mode && this.active.mode !== mode)) return false;
    const current = this.active;
    this.active = null;
    current.cleanup();
    return true;
  }

  current(): AuxiliaryAudioMode | null {
    return this.active?.mode ?? null;
  }
}
