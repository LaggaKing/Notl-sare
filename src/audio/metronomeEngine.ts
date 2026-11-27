import type { TimeSignature } from '../types';
import { ensureAudioContext, getAudioChain } from './audioContext';

export const MIN_BPM = 30;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 100;
export const TAP_RESET_GAP_MS = 2500;
export const MAX_TAP_INTERVALS = 6;
export const TIME_SIGNATURES: readonly TimeSignature[] = [
  '2/4',
  '3/4',
  '4/4',
  '6/8',
  '3/8',
  '5/4',
];

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

const BEATS_PER_BAR_MAP: Record<TimeSignature, number> = {
  '2/4': 2,
  '3/4': 3,
  '4/4': 4,
  '6/8': 6,
  '3/8': 3,
  '5/4': 5,
};

/**
 * Returns the number of beat pulses per bar for a given time signature.
 */
export function beatsPerBar(sig: TimeSignature): number {
  return BEATS_PER_BAR_MAP[sig];
}

/**
 * Rounds and clamps a BPM value to the supported 30–240 BPM range.
 */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return DEFAULT_BPM;
  }
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/**
 * Computes BPM from tap timestamps (in milliseconds).
 * Ignores gaps > 2500ms, uses a moving average of recent intervals, and clamps to 30–240 BPM.
 */
export function computeTapTempoBpm(timestampsMs: number[]): number | null {
  if (timestampsMs.length < 2) {
    return null;
  }

  const runs: number[][] = [[]];
  for (let i = 1; i < timestampsMs.length; i++) {
    const prev = timestampsMs[i - 1];
    const curr = timestampsMs[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
      continue;
    }

    const delta = curr - prev;
    if (delta <= 0) {
      continue;
    }

    if (delta > TAP_RESET_GAP_MS) {
      if (runs[runs.length - 1].length > 0) {
        runs.push([]);
      }
      continue;
    }

    runs[runs.length - 1].push(delta);
  }

  let selectedRun: number[] | null = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].length > 0) {
      selectedRun = runs[i];
      break;
    }
  }

  if (!selectedRun || selectedRun.length === 0) {
    return null;
  }

  const recent = selectedRun.slice(-MAX_TAP_INTERVALS);
  const avgIntervalMs = recent.reduce((sum, val) => sum + val, 0) / recent.length;
  if (avgIntervalMs <= 0) {
    return null;
  }

  return clampBpm(60000 / avgIntervalMs);
}

export type BeatListener = (beatIndex: number, totalBeats: number) => void;

export interface MetronomeSnapshot {
  isRunning: boolean;
  bpm: number;
  timeSignature: TimeSignature;
  audible: boolean;
  volume: number;
  currentBeat: number;
  totalBeats: number;
}

export type MetronomeStateListener = (snapshot: MetronomeSnapshot) => void;

export interface MetronomeEngineOptions {
  bpm?: number;
  timeSignature?: TimeSignature;
  audible?: boolean;
  volume?: number;
  onBeat?: BeatListener;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0.7;
  }
  return Math.min(1, Math.max(0, volume));
}

export class MetronomeEngine {
  private bpm: number;
  private timeSignature: TimeSignature;
  private audible: boolean;
  private volume: number;
  private isRunning = false;
  private activeBeat = -1;
  private nextBeatIndex = 0;
  private nextNoteTime = 0;
  private lastWallSec = 0;
  private clockMode: 'audio' | 'wall' = 'wall';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  private audioCtx: AudioContext | null = null;
  private metronomeGain: GainNode | null = null;

  private beatListeners = new Set<BeatListener>();
  private stateListeners = new Set<MetronomeStateListener>();

  constructor(options: MetronomeEngineOptions = {}) {
    this.bpm = clampBpm(options.bpm ?? DEFAULT_BPM);
    this.timeSignature = options.timeSignature ?? '4/4';
    // Concert-safe default: visual pulse only unless explicitly unmuted.
    this.audible = options.audible ?? false;
    this.volume = clampVolume(options.volume ?? 0.7);

    if (options.onBeat) {
      this.beatListeners.add(options.onBeat);
    }
  }

  public getSnapshot(): MetronomeSnapshot {
    return {
      isRunning: this.isRunning,
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      audible: this.audible,
      volume: this.volume,
      currentBeat: this.activeBeat,
      totalBeats: beatsPerBar(this.timeSignature),
    };
  }

  public subscribeBeat(listener: BeatListener): () => void {
    this.beatListeners.add(listener);
    return () => {
      this.beatListeners.delete(listener);
    };
  }

  public subscribeState(listener: MetronomeStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public setBpm(bpm: number): void {
    const clamped = clampBpm(bpm);
    if (clamped === this.bpm) {
      return;
    }
    this.bpm = clamped;

    if (this.isRunning) {
      const now = this.nowSec();
      const maxWait = 60 / this.bpm;
      if (this.nextNoteTime - now > maxWait) {
        this.nextNoteTime = now + maxWait;
      }
    }

    this.notifyState();
  }

  public setTimeSignature(sig: TimeSignature): void {
    if (sig === this.timeSignature) {
      return;
    }
    this.timeSignature = sig;
    const total = beatsPerBar(sig);
    this.nextBeatIndex = this.nextBeatIndex % total;
    if (this.activeBeat >= total) {
      this.activeBeat = 0;
    }
    this.notifyState();
  }

  public setVolume(volume: number): void {
    const clamped = clampVolume(volume);
    this.volume = clamped;
    if (this.metronomeGain && this.audioCtx && this.audioCtx.state !== 'closed') {
      const target = this.audible ? clamped : 0;
      this.metronomeGain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.015);
    }
    this.notifyState();
  }

  public setAudible(audible: boolean): void {
    if (audible === this.audible) {
      return;
    }
    const prevNow = this.nowSec();
    const remainingSec = this.isRunning ? Math.max(0.005, this.nextNoteTime - prevNow) : 0;
    this.audible = audible;

    if (!audible) {
      if (this.metronomeGain && this.audioCtx && this.audioCtx.state !== 'closed') {
        this.metronomeGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.01);
      }
      if (this.isRunning) {
        this.clockMode = 'wall';
        this.lastWallSec = Date.now() / 1000;
        this.nextNoteTime = this.wallNowSec() + remainingSec;
      }
      this.notifyState();
      return;
    }

    this.notifyState();
    void this.activateAudioClock(remainingSec);
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.nextBeatIndex = 0;
    this.activeBeat = -1;
    this.clearPendingTimers();

    if (this.audible) {
      await this.activateAudioClock(0.015);
      if (!this.isRunning) {
        return;
      }
    } else {
      this.clockMode = 'wall';
      this.lastWallSec = Date.now() / 1000;
      this.nextNoteTime = this.wallNowSec() + 0.015;
    }

    this.notifyState();
    this.schedulerTick();
    this.intervalId = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
  }

  public stop(): void {
    if (!this.isRunning && this.activeBeat === -1) {
      return;
    }

    this.isRunning = false;
    this.activeBeat = -1;
    this.nextBeatIndex = 0;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.clearPendingTimers();

    if (this.metronomeGain && this.audioCtx) {
      try {
        this.metronomeGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.01);
      } catch {
        // Ignore if context is already closed.
      }
    }

    this.notifyState();
  }

  public toggle(): Promise<void> | void {
    if (this.isRunning) {
      this.stop();
      return;
    }
    return this.start();
  }

  public dispose(): void {
    this.stop();
    if (this.metronomeGain) {
      try {
        this.metronomeGain.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
      this.metronomeGain = null;
    }
    this.audioCtx = null;
    this.beatListeners.clear();
    this.stateListeners.clear();
  }

  private async activateAudioClock(offsetSec: number): Promise<void> {
    try {
      const ctx = await ensureAudioContext();
      const chain = getAudioChain();
      if (!chain || !this.audible) {
        return;
      }

      this.ensureMetronomeGain(ctx, chain.masterInput);
      if (this.metronomeGain) {
        this.metronomeGain.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.01);
      }

      this.clockMode = 'audio';
      if (this.isRunning) {
        this.nextNoteTime = ctx.currentTime + Math.max(0.01, offsetSec);
      }
    } catch {
      // Gracefully keep visual-only wall clock if audio cannot start.
      this.clockMode = 'wall';
      if (this.isRunning) {
        this.lastWallSec = Date.now() / 1000;
        this.nextNoteTime = this.wallNowSec() + Math.max(0.01, offsetSec);
      }
    }
  }

  private ensureMetronomeGain(ctx: AudioContext, destination: AudioNode): void {
    if (this.audioCtx === ctx && this.metronomeGain) {
      return;
    }
    if (this.metronomeGain) {
      try {
        this.metronomeGain.disconnect();
      } catch {
        // Ignore stale disconnect errors.
      }
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.audible ? this.volume : 0, ctx.currentTime);
    gain.connect(destination);
    this.audioCtx = ctx;
    this.metronomeGain = gain;
  }

  private wallNowSec(): number {
    const sec = Date.now() / 1000;
    if (sec > this.lastWallSec) {
      this.lastWallSec = sec;
    }
    return this.lastWallSec;
  }

  private nowSec(): number {
    if (this.clockMode === 'audio' && this.audioCtx && this.audioCtx.state !== 'closed') {
      return this.audioCtx.currentTime;
    }
    return this.wallNowSec();
  }

  private schedulerTick(): void {
    if (!this.isRunning) {
      return;
    }

    const now = this.nowSec();
    const totalBeats = beatsPerBar(this.timeSignature);
    const beatInterval = 60 / this.bpm;

    // Resync after device sleep or background suspension to prevent a catch-up beat storm
    if (now - this.nextNoteTime > beatInterval * 2) {
      this.nextNoteTime = now + 0.015;
    }

    while (this.nextNoteTime < now + SCHEDULE_AHEAD_SEC) {
      const beatIndex = this.nextBeatIndex;
      const scheduledTime = this.nextNoteTime;

      if (
        this.audible &&
        this.clockMode === 'audio' &&
        this.audioCtx &&
        this.metronomeGain &&
        this.audioCtx.state === 'running'
      ) {
        this.scheduleWoodblockClick(this.audioCtx, this.metronomeGain, scheduledTime, beatIndex, totalBeats);
      }

      const delayMs = Math.max(0, (scheduledTime - now) * 1000);
      const timerId = setTimeout(() => {
        this.pendingTimers.delete(timerId);
        if (!this.isRunning) {
          return;
        }
        this.emitBeat(beatIndex, totalBeats);
      }, delayMs);
      this.pendingTimers.add(timerId);

      this.nextNoteTime += 60 / this.bpm;
      this.nextBeatIndex = (beatIndex + 1) % totalBeats;
    }
  }

  private scheduleWoodblockClick(
    ctx: AudioContext,
    output: GainNode,
    time: number,
    beatIndex: number,
    totalBeats: number,
  ): void {
    const isDownbeat = beatIndex === 0;
    const isCompoundSubAccent = this.timeSignature === '6/8' && totalBeats === 6 && beatIndex === 3;

    const baseFreq = isDownbeat ? 1200 : isCompoundSubAccent ? 1020 : 850;
    const peakGain = isDownbeat ? 0.95 : isCompoundSubAccent ? 0.72 : 0.56;
    const decaySec = isDownbeat ? 0.046 : isCompoundSubAccent ? 0.038 : 0.032;

    // Primary resonant woodblock body
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * 1.12, time);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.008);

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, time + decaySec);

    osc.connect(env);
    env.connect(output);
    osc.start(time);
    osc.stop(time + decaySec + 0.008);

    // Subtle upper wood transient for clarity on small tablet speakers
    const transient = ctx.createOscillator();
    const transientEnv = ctx.createGain();
    transient.type = 'triangle';
    transient.frequency.setValueAtTime(baseFreq * 2.15, time);

    transientEnv.gain.setValueAtTime(0.0001, time);
    transientEnv.gain.linearRampToValueAtTime(peakGain * 0.24, time + 0.0015);
    transientEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.016);

    transient.connect(transientEnv);
    transientEnv.connect(output);
    transient.start(time);
    transient.stop(time + 0.02);

    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
        transient.disconnect();
        transientEnv.disconnect();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }

  private emitBeat(beatIndex: number, totalBeats: number): void {
    this.activeBeat = beatIndex;
    for (const listener of this.beatListeners) {
      listener(beatIndex, totalBeats);
    }
    this.notifyState();
  }

  private clearPendingTimers(): void {
    for (const timerId of this.pendingTimers) {
      clearTimeout(timerId);
    }
    this.pendingTimers.clear();
  }

  private notifyState(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }
}

export const metronomeEngine = new MetronomeEngine();
