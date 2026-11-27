import { ensureAudioContext, getAudioChain } from './audioContext';
export { resolveNoteNaming } from '../i18n';

export const MIN_REF_PITCH_HZ = 438;
export const MAX_REF_PITCH_HZ = 444;
export const DEFAULT_REF_PITCH_HZ = 440;

const SV_NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B', 'H'] as const;
const EN_NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] as const;
const ACCIDENTAL_SEMITONES = new Set([1, 3, 6, 8, 10]);

// Additive harmonics [1..5] for warm choir/piano pitch pipe
const STANDARD_HARMONICS = [0, 1.0, 0.55, 0.30, 0.14, 0.06];
// Boosted upper partials below C3 (MIDI < 48) so bass fundamentals speak clearly on tablet/laptop speakers
const BASS_BOOST_HARMONICS = [0, 0.92, 0.78, 0.48, 0.24, 0.11];

export interface FormattedMidiNote {
  name: string;
  octave: number;
  full: string;
  isAccidental: boolean;
}

/**
 * Clamps A4 reference tuning to 438–444 Hz.
 */
export function clampReferencePitchHz(hz: number): number {
  if (!Number.isFinite(hz)) {
    return DEFAULT_REF_PITCH_HZ;
  }
  return Math.min(MAX_REF_PITCH_HZ, Math.max(MIN_REF_PITCH_HZ, Math.round(hz * 10) / 10));
}

/**
 * Converts a MIDI note number to equal-temperament frequency in Hz.
 */
export function midiToFrequency(midi: number, referenceA4Hz = DEFAULT_REF_PITCH_HZ): number {
  return referenceA4Hz * Math.pow(2, (midi - 69) / 12);
}

/**
 * Formats a MIDI note number using authentic Swedish (B = Bb, H = B natural)
 * or English (Bb, B) note naming.
 */
export function formatMidiNoteLabel(midi: number, naming: 'sv' | 'en'): FormattedMidiNote {
  const rounded = Math.round(midi);
  const semitone = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  const table = naming === 'sv' ? SV_NOTE_NAMES : EN_NOTE_NAMES;
  const name = table[semitone];
  const isAccidental = ACCIDENTAL_SEMITONES.has(semitone);

  return {
    name,
    octave,
    full: `${name}${octave}`,
    isAccidental,
  };
}

/**
 * Formats a set of MIDI notes into a sorted, deduplicated chord/pitch label.
 */
export function formatChordLabel(midiNotes: number[], naming: 'sv' | 'en'): string {
  const uniqueSorted = Array.from(new Set(midiNotes.map((m) => Math.round(m)))).sort((a, b) => a - b);
  return uniqueSorted.map((midi) => formatMidiNoteLabel(midi, naming).full).join(' · ');
}

interface ActiveVoice {
  midi: number;
  oscMain: OscillatorNode;
  oscWarmth: OscillatorNode | null;
  warmthGain: GainNode | null;
  filter: BiquadFilterNode | null;
  envGain: GainNode;
  released: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

export interface PianoStateSnapshot {
  activeNotes: number[];
  hold: boolean;
  volume: number;
  referencePitchHz: number;
}

export type PianoStateListener = (snapshot: PianoStateSnapshot) => void;

export interface PianoEngineOptions {
  referencePitchHz?: number;
  volume?: number;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 0.75;
  }
  return Math.min(1, Math.max(0, volume));
}

export class PianoEngine {
  private referencePitchHz: number;
  private volume: number;
  private hold = false;

  private activeNotes = new Set<number>();
  private voices = new Map<number, ActiveVoice>();
  private listeners = new Set<PianoStateListener>();

  private audioCtx: AudioContext | null = null;
  private pianoMasterGain: GainNode | null = null;
  private standardWave: PeriodicWave | null = null;
  private bassWave: PeriodicWave | null = null;

  private chordReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private chordNotesInFlight = new Set<number>();
  private releaseTimers = new Set<ReturnType<typeof setTimeout>>();
  private releasingVoices = new Set<ActiveVoice>();

  constructor(options: PianoEngineOptions = {}) {
    this.referencePitchHz = clampReferencePitchHz(options.referencePitchHz ?? DEFAULT_REF_PITCH_HZ);
    this.volume = clampVolume(options.volume ?? 0.75);
  }

  public getSnapshot(): PianoStateSnapshot {
    return {
      activeNotes: this.getActiveNotes(),
      hold: this.hold,
      volume: this.volume,
      referencePitchHz: this.referencePitchHz,
    };
  }

  public getActiveNotes(): number[] {
    return Array.from(this.activeNotes).sort((a, b) => a - b);
  }

  public getHold(): boolean {
    return this.hold;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getReferencePitchHz(): number {
    return this.referencePitchHz;
  }

  public subscribe(listener: PianoStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setReferencePitchHz(hz: number): void {
    const clamped = clampReferencePitchHz(hz);
    if (clamped === this.referencePitchHz) {
      return;
    }
    this.referencePitchHz = clamped;

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      const now = this.audioCtx.currentTime;
      for (const voice of this.voices.values()) {
        if (!voice.released) {
          const newFreq = midiToFrequency(voice.midi, clamped);
          voice.oscMain.frequency.setTargetAtTime(newFreq, now, 0.015);
          voice.oscWarmth?.frequency.setTargetAtTime(newFreq, now, 0.015);
        }
      }
    }

    this.notify();
  }

  public setVolume(volume: number): void {
    const clamped = clampVolume(volume);
    this.volume = clamped;
    if (this.pianoMasterGain && this.audioCtx && this.audioCtx.state !== 'closed') {
      this.pianoMasterGain.gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.015);
    }
    this.notify();
  }

  public setHold(enabled: boolean): void {
    if (enabled === this.hold) {
      return;
    }
    this.hold = enabled;

    if (!enabled) {
      // Release all sustained voices when Hold is disengaged.
      for (const midi of Array.from(this.activeNotes)) {
        this.activeNotes.delete(midi);
        this.releaseVoice(midi, 0.18);
      }
    }

    this.notify();
  }

  /**
   * Starts a note (or toggles it off if Hold mode is active and the note is already held).
   * Returns true if the note was started, false if toggled off.
   */
  public noteOn(midi: number): boolean {
    const note = Math.round(midi);
    if (!Number.isFinite(note)) {
      return false;
    }

    if (this.hold && this.activeNotes.has(note)) {
      this.activeNotes.delete(note);
      this.chordNotesInFlight.delete(note);
      this.releaseVoice(note, 0.14);
      this.notify();
      return false;
    }

    this.activeNotes.add(note);
    this.chordNotesInFlight.delete(note);
    this.notify();

    this.startVoiceSafe(note);
    return true;
  }

  /**
   * Releases a note unless Hold mode is active.
   */
  public noteOff(midi: number): void {
    const note = Math.round(midi);
    if (this.hold) {
      return;
    }

    if (this.activeNotes.has(note)) {
      this.activeNotes.delete(note);
      this.notify();
    }
    this.releaseVoice(note, 0.18);
  }

  /**
   * Immediately silences all sounding and held notes.
   */
  public stopAll(): void {
    this.clearChordTimer();
    this.chordNotesInFlight.clear();

    const hadActive = this.activeNotes.size > 0;
    this.activeNotes.clear();

    for (const midi of Array.from(this.voices.keys())) {
      this.releaseVoice(midi, 0.09);
    }

    if (hadActive) {
      this.notify();
    }
  }

  /**
   * Plays a chord (e.g. a score's saved starting pitch) for `durationMs` ms and releases smoothly.
   */
  public async playChord(midiNotes: number[], durationMs = 1800): Promise<void> {
    const uniqueNotes = Array.from(
      new Set(midiNotes.filter((n) => Number.isFinite(n)).map((n) => Math.round(n))),
    ).sort((a, b) => a - b);

    if (uniqueNotes.length === 0) {
      return;
    }

    this.clearChordTimer();
    for (const prevNote of Array.from(this.chordNotesInFlight)) {
      this.activeNotes.delete(prevNote);
      this.releaseVoice(prevNote, 0.08);
    }
    this.chordNotesInFlight.clear();

    try {
      await ensureAudioContext();
    } catch {
      // Allow UI visual highlight fallback even if Web Audio is unavailable.
    }

    for (const note of uniqueNotes) {
      this.activeNotes.add(note);
      this.chordNotesInFlight.add(note);
      this.startVoiceSafe(note);
    }
    this.notify();

    const releaseDelay = Math.max(150, durationMs);
    this.chordReleaseTimer = setTimeout(() => {
      this.chordReleaseTimer = null;
      const toRelease = Array.from(this.chordNotesInFlight);
      this.chordNotesInFlight.clear();

      for (const note of toRelease) {
        if (!this.hold) {
          this.activeNotes.delete(note);
          this.releaseVoice(note, 0.22);
        }
      }
      this.notify();
    }, releaseDelay);
  }

  public dispose(): void {
    this.stopAll();
    for (const timerId of this.releaseTimers) {
      clearTimeout(timerId);
    }
    this.releaseTimers.clear();
    for (const voice of this.voices.values()) {
      this.cleanupVoiceImmediate(voice);
    }
    this.voices.clear();
    for (const voice of Array.from(this.releasingVoices)) {
      this.cleanupVoiceImmediate(voice);
    }
    this.releasingVoices.clear();

    if (this.pianoMasterGain) {
      try {
        this.pianoMasterGain.disconnect();
      } catch {
        // Ignore stale disconnect errors.
      }
      this.pianoMasterGain = null;
    }
    this.audioCtx = null;
    this.standardWave = null;
    this.bassWave = null;
    this.listeners.clear();
  }

  private startVoiceSafe(midi: number): void {
    const chain = getAudioChain();
    if (!chain) {
      return;
    }

    if (chain.ctx.state === 'suspended') {
      void ensureAudioContext()
        .then((resumedCtx) => {
          if (resumedCtx.state === 'closed' || !this.activeNotes.has(midi)) {
            return;
          }
          const refreshedChain = getAudioChain();
          if (!refreshedChain) return;
          this.ensureOutputGraph(refreshedChain.ctx, refreshedChain.masterInput);
          if (!this.pianoMasterGain) return;
          this.spawnVoice(refreshedChain.ctx, this.pianoMasterGain, midi);
        })
        .catch(() => {});
      return;
    }

    if (chain.ctx.state === 'closed') {
      return;
    }

    this.ensureOutputGraph(chain.ctx, chain.masterInput);
    if (!this.pianoMasterGain) {
      return;
    }

    this.spawnVoice(chain.ctx, this.pianoMasterGain, midi);
  }

  private ensureOutputGraph(ctx: AudioContext, destination: AudioNode): void {
    if (this.audioCtx === ctx && this.pianoMasterGain) {
      return;
    }

    if (this.pianoMasterGain) {
      try {
        this.pianoMasterGain.disconnect();
      } catch {
        // Ignore stale disconnect errors.
      }
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume, ctx.currentTime);
    masterGain.connect(destination);

    this.audioCtx = ctx;
    this.pianoMasterGain = masterGain;

    if (typeof ctx.createPeriodicWave === 'function') {
      const zeroRealStd = new Float32Array(STANDARD_HARMONICS.length);
      const imagStd = new Float32Array(STANDARD_HARMONICS);
      this.standardWave = ctx.createPeriodicWave(zeroRealStd, imagStd);

      const zeroRealBass = new Float32Array(BASS_BOOST_HARMONICS.length);
      const imagBass = new Float32Array(BASS_BOOST_HARMONICS);
      this.bassWave = ctx.createPeriodicWave(zeroRealBass, imagBass);
    } else {
      this.standardWave = null;
      this.bassWave = null;
    }
  }

  private spawnVoice(ctx: AudioContext, output: GainNode, midi: number): void {
    // Quickly crossfade any existing voice for the same MIDI key
    if (this.voices.has(midi)) {
      this.releaseVoice(midi, 0.025);
    }

    const now = ctx.currentTime;
    const freq = midiToFrequency(midi, this.referencePitchHz);
    const isLowBass = midi < 48; // Below C3

    const oscMain = ctx.createOscillator();
    oscMain.frequency.setValueAtTime(freq, now);

    const wave = isLowBass ? this.bassWave : this.standardWave;
    if (wave && typeof oscMain.setPeriodicWave === 'function') {
      oscMain.setPeriodicWave(wave);
    } else {
      oscMain.type = 'triangle';
    }

    // Subtle choir-warmth chorus oscillator (+1.4 cents)
    let oscWarmth: OscillatorNode | null = null;
    let warmthGain: GainNode | null = null;
    if (wave && typeof oscMain.setPeriodicWave === 'function') {
      oscWarmth = ctx.createOscillator();
      oscWarmth.frequency.setValueAtTime(freq, now);
      oscWarmth.detune?.setValueAtTime(1.4, now);
      oscWarmth.setPeriodicWave(wave);

      warmthGain = ctx.createGain();
      warmthGain.gain.setValueAtTime(0.22, now);
    }

    let filter: BiquadFilterNode | null = null;
    if (typeof ctx.createBiquadFilter === 'function') {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(0.7, now);
      const brightCutoff = Math.min(10500, Math.max(1400, freq * (isLowBass ? 7.5 : 6.0)));
      const warmCutoff = Math.min(4200, Math.max(850, freq * (isLowBass ? 3.8 : 3.0)));
      filter.frequency.setValueAtTime(brightCutoff, now);
      filter.frequency.exponentialRampToValueAtTime(warmCutoff, now + 0.45);
    }

    const envGain = ctx.createGain();
    const peak = isLowBass ? 0.42 : 0.36;
    const sustain = peak * 0.68;
    envGain.gain.setValueAtTime(0.0001, now);
    // Soft 8ms piano attack -> warm sustained choir pitch pipe
    envGain.gain.linearRampToValueAtTime(peak, now + 0.008);
    envGain.gain.setTargetAtTime(sustain, now + 0.04, 0.28);

    if (filter) {
      oscMain.connect(filter);
      if (oscWarmth && warmthGain) {
        oscWarmth.connect(warmthGain);
        warmthGain.connect(filter);
      }
      filter.connect(envGain);
    } else {
      oscMain.connect(envGain);
      if (oscWarmth && warmthGain) {
        oscWarmth.connect(warmthGain);
        warmthGain.connect(envGain);
      }
    }

    envGain.connect(output);

    oscMain.start(now);
    oscWarmth?.start(now);

    const voice: ActiveVoice = {
      midi,
      oscMain,
      oscWarmth,
      warmthGain,
      filter,
      envGain,
      released: false,
      cleanupTimer: null,
    };

    this.voices.set(midi, voice);
  }

  private releaseVoice(midi: number, releaseSec = 0.18): void {
    const voice = this.voices.get(midi);
    if (!voice || voice.released) {
      return;
    }
    voice.released = true;
    this.voices.delete(midi);

    const ctx = this.audioCtx;
    if (!ctx || ctx.state === 'closed') {
      this.cleanupVoiceImmediate(voice);
      return;
    }

    const now = ctx.currentTime;
    try {
      voice.envGain.gain.cancelScheduledValues(now);
      voice.envGain.gain.setValueAtTime(Math.max(0.0001, voice.envGain.gain.value), now);
      voice.envGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSec);

      const stopAt = now + releaseSec + 0.02;
      voice.oscMain.stop(stopAt);
      voice.oscWarmth?.stop(stopAt);
    } catch {
      this.cleanupVoiceImmediate(voice);
      return;
    }

    this.releasingVoices.add(voice);
    const timerId = setTimeout(() => {
      this.releaseTimers.delete(timerId);
      voice.cleanupTimer = null;
      this.cleanupVoiceImmediate(voice);
    }, (releaseSec + 0.05) * 1000);
    voice.cleanupTimer = timerId;
    this.releaseTimers.add(timerId);
  }

  private cleanupVoiceImmediate(voice: ActiveVoice): void {
    this.releasingVoices.delete(voice);
    if (voice.cleanupTimer !== null) {
      clearTimeout(voice.cleanupTimer);
      this.releaseTimers.delete(voice.cleanupTimer);
      voice.cleanupTimer = null;
    }
    try {
      voice.oscMain.disconnect();
      voice.oscWarmth?.disconnect();
      voice.warmthGain?.disconnect();
      voice.filter?.disconnect();
      voice.envGain.disconnect();
    } catch {
      // Ignore already-disconnected errors.
    }
  }

  private clearChordTimer(): void {
    if (this.chordReleaseTimer !== null) {
      clearTimeout(this.chordReleaseTimer);
      this.chordReleaseTimer = null;
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const pianoEngine = new PianoEngine();
