import {
  createSongSchedulerState,
  takeScheduleWindow,
  type SongSchedulerState,
} from "./scheduler";
import type { HitJudgement } from "../game/scoring";
import type { GameSettings } from "../game/settings";
import type { Lane, LoadedChart } from "../game/types";

interface ActiveSchedule {
  chart: LoadedChart;
  startTime: number;
  endSongTime: number;
  cursor: SongSchedulerState;
}

export interface CalibrationClock {
  firstBeatTime: number;
  beatDuration: number;
  warmupBeats: number;
  sampleBeats: number;
}

type AudioBus = "music" | "hit";
type OrchestraInstrument = "strings" | "brass" | "woodwind" | "bass";

export class SynthEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private hit: GainNode | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private noiseBuffer: AudioBuffer | null = null;
  private schedule: ActiveSchedule | null = null;
  private settings: GameSettings | null = null;
  private suspendPromise: Promise<void> | null = null;

  private async ensureRunning(context: AudioContext): Promise<void> {
    const pendingSuspend = this.suspendPromise;
    if (pendingSuspend) {
      try {
        await pendingSuspend;
      } finally {
        if (this.suspendPromise === pendingSuspend) this.suspendPromise = null;
      }
    }
    if (context.state !== "running") await context.resume();
  }

  private createReverbImpulse(context: AudioContext): AudioBuffer {
    const length = Math.ceil(context.sampleRate * 1.35);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const decay = (1 - index / length) ** 2.35;
        data[index] = (Math.random() * 2 - 1) * decay * 0.52;
      }
    }
    return impulse;
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;

    const context = new AudioContext({ latencyHint: "interactive" });
    const master = context.createGain();
    const music = context.createGain();
    const hit = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const reverb = context.createConvolver();
    const reverbGain = context.createGain();

    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    reverb.buffer = this.createReverbImpulse(context);
    reverbGain.gain.value = 0.16;
    music.connect(master);
    music.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(master);
    hit.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.music = music;
    this.hit = hit;
    if (this.settings) this.setVolumes(this.settings);
    return context;
  }

  private track<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.add(source);
    source.addEventListener("ended", () => this.sources.delete(source), {
      once: true,
    });
    return source;
  }

  private destination(bus: AudioBus): GainNode | null {
    return bus === "music" ? this.music : this.hit;
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.ceil(context.sampleRate * 0.45);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.84 + white * 0.16;
      data[index] = white * 0.72 + previous * 0.28;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private scheduleTone(
    when: number,
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    detune = 0,
    bus: AudioBus = "music",
  ): void {
    const context = this.context;
    const destination = this.destination(bus);
    if (!context || !destination) return;
    const oscillator = this.track(context.createOscillator());
    const gain = context.createGain();
    const start = Math.max(when, context.currentTime + 0.001);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.detune.setValueAtTime(detune, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, volume),
      start + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private scheduleNoise(
    when: number,
    duration: number,
    volume: number,
    highpassFrequency: number,
  ): void {
    const context = this.context;
    const destination = this.music;
    if (!context || !destination) return;
    const source = this.track(context.createBufferSource());
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = Math.max(when, context.currentTime + 0.001);
    source.buffer = this.getNoiseBuffer(context);
    filter.type = "highpass";
    filter.frequency.value = highpassFrequency;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(Math.max(0.0002, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(start);
    source.stop(start + duration + 0.01);
  }

  private scheduleKick(when: number, accent: boolean): void {
    const context = this.context;
    const destination = this.music;
    if (!context || !destination) return;
    const oscillator = this.track(context.createOscillator());
    const gain = context.createGain();
    const start = Math.max(when, context.currentTime + 0.001);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 168 : 138, start);
    oscillator.frequency.exponentialRampToValueAtTime(46, start + 0.11);
    gain.gain.setValueAtTime(accent ? 0.86 : 0.66, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.23);
  }

  private scheduleSnare(when: number): void {
    this.scheduleNoise(when, 0.16, 0.24, 1450);
    this.scheduleTone(when, 184, 0.11, 0.11, "triangle");
  }

  private schedulePad(
    when: number,
    rootFrequency: number,
    duration: number,
  ): void {
    const context = this.context;
    const destination = this.music;
    if (!context || !destination) return;
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = Math.max(when, context.currentTime + 0.001);
    const release = start + duration;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(950, start);
    filter.frequency.linearRampToValueAtTime(1650, start + duration * 0.55);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.055, start + 0.12);
    gain.gain.setValueAtTime(0.055, Math.max(start + 0.13, release - 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, release);
    filter.connect(gain);
    gain.connect(destination);
    for (const [ratio, detune] of [
      [1, -5],
      [1.25, 2],
      [1.5, 7],
    ] as const) {
      const oscillator = this.track(context.createOscillator());
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(rootFrequency * ratio, start);
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      oscillator.start(start);
      oscillator.stop(release + 0.03);
    }
  }

  private scheduleOrchestraTone(
    when: number,
    frequency: number,
    duration: number,
    volume: number,
    instrument: OrchestraInstrument,
    pan = 0,
  ): void {
    const context = this.context;
    const destination = this.music;
    if (!context || !destination) return;
    const start = Math.max(when, context.currentTime + 0.001);
    const release = start + Math.max(0.06, duration);
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();
    const settings = {
      strings: { types: ["sawtooth", "triangle"], cutoff: 2100, attack: 0.018 },
      brass: { types: ["sawtooth", "square"], cutoff: 1450, attack: 0.012 },
      woodwind: { types: ["sine", "triangle"], cutoff: 2800, attack: 0.026 },
      bass: { types: ["triangle", "sawtooth"], cutoff: 720, attack: 0.016 },
    }[instrument] as {
      types: OscillatorType[];
      cutoff: number;
      attack: number;
    };
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(settings.cutoff * 0.72, start);
    filter.frequency.linearRampToValueAtTime(settings.cutoff, start + 0.06);
    filter.Q.value = instrument === "brass" ? 1.1 : 0.55;
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, volume),
      start + settings.attack,
    );
    gain.gain.setValueAtTime(
      Math.max(0.0002, volume * 0.72),
      Math.max(start + settings.attack + 0.01, release - 0.055),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, release);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(destination);
    settings.types.forEach((type, index) => {
      const oscillator = this.track(context.createOscillator());
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.detune.value = index === 0 ? -5 : 6;
      oscillator.connect(filter);
      oscillator.start(start);
      oscillator.stop(release + 0.025);
    });
  }

  private scheduleTimpani(when: number, accent = false): void {
    const context = this.context;
    const destination = this.music;
    if (!context || !destination) return;
    const start = Math.max(when, context.currentTime + 0.001);
    const oscillator = this.track(context.createOscillator());
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 118 : 98, start);
    oscillator.frequency.exponentialRampToValueAtTime(58, start + 0.22);
    gain.gain.setValueAtTime(accent ? 0.34 : 0.22, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.46);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.48);
    this.scheduleNoise(start, 0.085, accent ? 0.075 : 0.045, 720);
  }

  private scheduleClassicalHalfBeat(
    schedule: ActiveSchedule,
    halfBeat: number,
  ): void {
    const { chart, startTime } = schedule;
    const beatDuration = 60 / chart.song.bpm;
    const halfBeatDuration = beatDuration / 2;
    const when = startTime + halfBeat * halfBeatDuration;
    const profile = chart.song.synthProfile;

    if (profile === "beethoven-5") {
      const motif = [
        196, 196, 196, 155.563, 174.614, 174.614, 174.614, 146.832,
      ];
      const index = halfBeat % motif.length;
      const longAccent = index === 3 || index === 7;
      this.scheduleOrchestraTone(
        when,
        motif[index],
        longAccent ? beatDuration * 1.38 : beatDuration * 0.28,
        longAccent ? 0.13 : 0.085,
        longAccent ? "brass" : "strings",
        index < 4 ? -0.24 : 0.24,
      );
      if (index === 0 || longAccent) this.scheduleTimpani(when, longAccent);
      if (halfBeat % 4 === 0)
        this.scheduleOrchestraTone(
          when,
          [65.406, 58.27, 77.782, 73.416][Math.floor(halfBeat / 8) % 4],
          beatDuration * 1.7,
          0.055,
          "bass",
          -0.18,
        );
      return;
    }

    if (profile === "mozart-40") {
      const melody = [
        391.995, 391.995, 391.995, 311.127, 349.228, 349.228, 349.228, 293.665,
        311.127, 349.228, 391.995, 466.164, 440, 391.995, 349.228, 311.127,
      ];
      const baseIndex = (halfBeat * 2) % melody.length;
      this.scheduleOrchestraTone(
        when,
        melody[baseIndex],
        halfBeatDuration * 0.78,
        0.052,
        "strings",
        -0.38,
      );
      this.scheduleOrchestraTone(
        when + halfBeatDuration * 0.5,
        melody[(baseIndex + 1) % melody.length],
        halfBeatDuration * 0.72,
        0.048,
        "strings",
        0.34,
      );
      if (halfBeat % 4 === 0)
        this.scheduleOrchestraTone(
          when,
          [97.999, 87.307, 77.782, 87.307][Math.floor(halfBeat / 4) % 4],
          beatDuration * 1.8,
          0.038,
          "bass",
          -0.1,
        );
      if (halfBeat % 8 === 6)
        this.scheduleOrchestraTone(
          when,
          melody[(baseIndex + 4) % melody.length] / 2,
          beatDuration * 1.1,
          0.038,
          "woodwind",
          0.52,
        );
      return;
    }

    if (profile === "new-world") {
      const theme = [
        164.814, 246.942, 329.628, 391.995, 369.994, 329.628, 311.127, 246.942,
        196, 246.942, 293.665, 329.628, 246.942, 196, 164.814, 146.832,
      ];
      const index = halfBeat % theme.length;
      const accent = index === 0 || index === 3 || index === 8 || index === 11;
      this.scheduleOrchestraTone(
        when,
        theme[index],
        accent ? beatDuration * 0.9 : halfBeatDuration * 0.72,
        accent ? 0.12 : 0.064,
        accent ? "brass" : "strings",
        accent ? 0.08 : index % 2 ? 0.32 : -0.32,
      );
      if (halfBeat % 4 === 0) {
        this.scheduleTimpani(when, halfBeat % 8 === 0);
        this.scheduleOrchestraTone(
          when,
          [82.407, 73.416, 65.406, 61.735][Math.floor(halfBeat / 8) % 4],
          beatDuration * 1.75,
          0.072,
          "bass",
          -0.24,
        );
      }
      return;
    }

    if (profile === "ode-to-joy") {
      if (halfBeat % 2 !== 0) return;
      const melody = [
        329.628, 329.628, 349.228, 391.995, 391.995, 349.228, 329.628, 293.665,
        261.626, 261.626, 293.665, 329.628, 329.628, 293.665, 293.665,
      ];
      const beatIndex = halfBeat / 2;
      const index = beatIndex % melody.length;
      const progress = (halfBeat * halfBeatDuration) / chart.song.duration;
      const phraseEnd = index === 12 || index === 14;
      this.scheduleOrchestraTone(
        when,
        melody[index],
        phraseEnd ? beatDuration * 1.7 : beatDuration * 0.82,
        0.065,
        progress < 0.34 ? "woodwind" : "strings",
        -0.18,
      );
      if (progress > 0.32)
        this.scheduleOrchestraTone(
          when,
          melody[index] / 2,
          beatDuration * 0.86,
          0.042,
          "strings",
          0.3,
        );
      if (progress > 0.64)
        this.scheduleOrchestraTone(
          when,
          melody[index] * 1.5,
          beatDuration * 0.72,
          0.042,
          "brass",
          0.06,
        );
      if (beatIndex % 4 === 0) {
        this.scheduleOrchestraTone(
          when,
          [65.406, 73.416, 82.407, 87.307][Math.floor(beatIndex / 4) % 4],
          beatDuration * 3.6,
          0.045,
          "bass",
          -0.28,
        );
        if (progress > 0.55) this.scheduleTimpani(when, beatIndex % 8 === 0);
      }
    }
  }

  private scheduleCountdown(startTime: number): void {
    for (let index = 3; index >= 1; index -= 1) {
      this.scheduleTone(
        startTime - index,
        index === 1 ? 1174.66 : 880,
        0.09,
        0.19,
        "square",
      );
    }
    this.scheduleTone(startTime, 1567.98, 0.16, 0.16, "triangle");
  }

  private scheduleHalfBeat(schedule: ActiveSchedule, halfBeat: number): void {
    const { chart, startTime } = schedule;
    const beatDuration = 60 / chart.song.bpm;
    const when = startTime + halfBeat * (beatDuration / 2);
    if (chart.song.category === "classical") {
      this.scheduleClassicalHalfBeat(schedule, halfBeat);
      return;
    }
    if (chart.song.synthProfile === "night-drive") {
      const beat = halfBeat / 2;
      const chordRoots = [73.416, 65.406, 55, 61.735] as const;
      if (halfBeat % 2 === 0) {
        this.scheduleKick(when, beat % 4 === 0);
        if (beat % 4 === 1 || beat % 4 === 3) this.scheduleSnare(when);
        const root = chordRoots[Math.floor(beat / 8) % chordRoots.length];
        this.scheduleTone(when, root, beatDuration * 0.82, 0.095, "triangle");
        if (beat % 8 === 0)
          this.schedulePad(when, root * 2, beatDuration * 7.2);
      } else {
        this.scheduleNoise(when, 0.045, 0.035, 6400);
        const root = chordRoots[Math.floor(beat / 8) % chordRoots.length];
        const arp = [2, 2.5, 3, 4][Math.floor(beat) % 4];
        this.scheduleTone(when, root * arp, 0.16, 0.035, "sine", -7);
      }
      return;
    }
    const bassFrequencies = [55, 65.406, 73.416, 49] as const;
    const padRoots = [110, 130.813, 146.832, 98] as const;
    this.scheduleNoise(
      when,
      halfBeat % 2 === 0 ? 0.055 : 0.035,
      halfBeat % 2 === 0 ? 0.075 : 0.045,
      5100,
    );
    if (halfBeat % 2 !== 0) return;
    const beat = halfBeat / 2;
    this.scheduleKick(when, beat % 4 === 0);
    if (beat % 4 === 1 || beat % 4 === 3) this.scheduleSnare(when);
    const bassRoot =
      bassFrequencies[Math.floor(beat / 4) % bassFrequencies.length];
    this.scheduleTone(when, bassRoot, beatDuration * 0.74, 0.12, "sawtooth");
    this.scheduleTone(when, bassRoot / 2, beatDuration * 0.66, 0.08);
    if (beat % 4 === 0) {
      this.schedulePad(
        when,
        padRoots[Math.floor(beat / 4) % padRoots.length],
        beatDuration * 3.7,
      );
    }
  }

  private scheduleChartCue(schedule: ActiveSchedule, noteIndex: number): void {
    const note = schedule.chart.notes[noteIndex];
    if (schedule.chart.song.category === "classical") return;
    const frequencies =
      schedule.chart.song.synthProfile === "night-drive"
        ? ([293.665, 369.994, 440, 554.365] as const)
        : ([329.628, 391.995, 493.883, 587.33] as const);
    const when = schedule.startTime + note.time;
    const frequency = frequencies[note.lane];
    const nightDrive = schedule.chart.song.synthProfile === "night-drive";
    this.scheduleTone(
      when,
      frequency,
      nightDrive ? 0.18 : 0.1,
      nightDrive ? 0.028 : 0.035,
      nightDrive ? "triangle" : "square",
      nightDrive ? -9 : -4,
    );
    this.scheduleTone(
      when,
      frequency * (nightDrive ? 1.5 : 2),
      nightDrive ? 0.12 : 0.065,
      nightDrive ? 0.014 : 0.018,
      "sine",
      3,
    );
  }

  async start(chart: LoadedChart, countdownSeconds = 3): Promise<number> {
    const context = this.ensureContext();
    this.stopAll();
    await this.ensureRunning(context);
    const startTime = context.currentTime + countdownSeconds + 0.12;
    this.schedule = {
      chart,
      startTime,
      endSongTime: chart.song.duration,
      cursor: createSongSchedulerState(),
    };
    this.scheduleCountdown(startTime);
    this.pumpScheduler();
    return startTime;
  }

  pumpScheduler(horizonSeconds = 0.45): void {
    const context = this.context;
    const schedule = this.schedule;
    if (!context || !schedule || context.state !== "running") return;
    const horizonSongTime = Math.min(
      schedule.endSongTime,
      context.currentTime + horizonSeconds - schedule.startTime,
    );
    if (horizonSongTime < 0) return;
    const window = takeScheduleWindow(
      schedule.cursor,
      schedule.chart,
      horizonSongTime,
    );
    for (const halfBeat of window.halfBeats)
      this.scheduleHalfBeat(schedule, halfBeat);
    for (const noteIndex of window.noteIndices)
      this.scheduleChartCue(schedule, noteIndex);
    if (window.scheduleOutro) {
      const beatDuration = 60 / schedule.chart.song.bpm;
      const when =
        schedule.startTime + schedule.chart.song.duration - beatDuration * 1.5;
      this.schedulePad(when, 110, beatDuration * 1.45);
      this.scheduleTone(when, 880, beatDuration * 1.2, 0.06);
    }
  }

  async startPreview(
    chart: LoadedChart,
    durationSeconds = 10,
    isCurrent: () => boolean = () => true,
  ): Promise<number | null> {
    const context = this.ensureContext();
    this.stopAll();
    await this.ensureRunning(context);
    if (!isCurrent()) return null;
    const startTime = context.currentTime + 0.08;
    this.schedule = {
      chart,
      startTime,
      endSongTime: Math.min(chart.song.duration, durationSeconds),
      cursor: createSongSchedulerState(),
    };
    this.pumpScheduler();
    return startTime + this.schedule.endSongTime;
  }

  async playTutorialPulse(step: number): Promise<number> {
    const context = this.ensureContext();
    this.stopAll();
    await this.ensureRunning(context);
    const first = context.currentTime + 0.12;
    const interval = step === 2 ? 0.62 : 0.5;
    for (let index = 0; index < 4; index += 1) {
      const when = first + index * interval;
      this.scheduleTone(
        when,
        index === 0 ? 1174.66 : 784,
        step === 2 && index === 1 ? 0.42 : 0.075,
        index === 0 ? 0.18 : 0.12,
        step === 2 && index === 1 ? "triangle" : "square",
      );
      if (index % 2 === 0) this.scheduleKick(when, index === 0);
    }
    return first + interval * 3 + 0.55;
  }

  setVolumes(settings: GameSettings): void {
    this.settings = settings;
    const now = this.context?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(
      settings.muted ? 0 : settings.masterVolume * 0.82,
      now,
      0.012,
    );
    this.music?.gain.setTargetAtTime(settings.musicVolume * 0.58, now, 0.012);
    this.hit?.gain.setTargetAtTime(settings.hitVolume * 0.48, now, 0.012);
  }

  async suspend(): Promise<void> {
    if (!this.context) return;
    if (this.suspendPromise) {
      await this.suspendPromise;
      return;
    }
    if (this.context.state !== "running") return;
    const pending = this.context.suspend();
    this.suspendPromise = pending;
    try {
      await pending;
    } finally {
      if (this.suspendPromise === pending) this.suspendPromise = null;
    }
  }

  async resume(): Promise<void> {
    if (this.context) await this.ensureRunning(this.context);
  }

  playHit(lane: Lane, judgement: HitJudgement): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const frequencies = [659.255, 783.991, 987.767, 1174.659] as const;
    const volume =
      judgement === "perfect" ? 0.075 : judgement === "great" ? 0.057 : 0.04;
    const now = context.currentTime + 0.004;
    this.scheduleTone(
      now,
      frequencies[lane],
      0.075,
      volume,
      "triangle",
      0,
      "hit",
    );
    this.scheduleTone(
      now,
      frequencies[lane] * 1.5,
      0.05,
      volume * 0.42,
      "sine",
      0,
      "hit",
    );
  }

  playMiss(lane: Lane): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const frequencies = [116, 123, 130, 138] as const;
    const now = context.currentTime + 0.004;
    this.scheduleTone(
      now,
      frequencies[lane],
      0.085,
      0.026,
      "sawtooth",
      -18,
      "hit",
    );
  }

  async startCalibration(): Promise<CalibrationClock> {
    const context = this.ensureContext();
    this.stopAll();
    await this.ensureRunning(context);
    const clock: CalibrationClock = {
      firstBeatTime: context.currentTime + 0.7,
      beatDuration: 0.5,
      warmupBeats: 4,
      sampleBeats: 16,
    };
    for (
      let index = 0;
      index < clock.warmupBeats + clock.sampleBeats;
      index += 1
    ) {
      this.scheduleTone(
        clock.firstBeatTime + index * clock.beatDuration,
        index % 4 === 0 ? 1174.66 : 880,
        0.065,
        index % 4 === 0 ? 0.2 : 0.13,
        "square",
      );
    }
    return clock;
  }

  async playCalibrationPreview(): Promise<void> {
    const context = this.ensureContext();
    this.stopAll();
    await this.ensureRunning(context);
    const first = context.currentTime + 0.15;
    for (let index = 0; index < 4; index += 1) {
      this.scheduleTone(
        first + index * 0.5,
        index === 0 ? 1174.66 : 880,
        0.07,
        0.16,
        "square",
      );
    }
  }

  stopAll(): void {
    this.schedule = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already-ended nodes are safe to ignore.
      }
    }
    this.sources.clear();
  }

  getCurrentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  getState(): AudioContextState | "uninitialized" {
    return this.context?.state ?? "uninitialized";
  }

  getBaseLatencyMs(): number {
    return (this.context?.baseLatency ?? 0) * 1000;
  }

  getActiveSourceCount(): number {
    return this.sources.size;
  }

  dispose(): void {
    this.stopAll();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.context = null;
    this.master = null;
    this.music = null;
    this.hit = null;
    this.noiseBuffer = null;
    this.suspendPromise = null;
  }
}
