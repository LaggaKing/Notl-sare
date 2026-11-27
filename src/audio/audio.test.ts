import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beatsPerBar,
  clampBpm,
  clampReferencePitchHz,
  closeAudioContext,
  computeTapTempoBpm,
  ensureAudioContext,
  formatChordLabel,
  formatMidiNoteLabel,
  MAX_BPM,
  MAX_TAP_INTERVALS,
  MetronomeEngine,
  midiToFrequency,
  MIN_BPM,
  PianoEngine,
  resolveNoteNaming,
  TAP_RESET_GAP_MS,
} from './index';
import {
  BASS_DEFAULT_START_MIDI,
  buildKeyboardKeys,
  MAX_PIANO_START_MIDI,
  MIN_PIANO_START_MIDI,
  PIANO_WHITE_KEY_COUNT,
  PianoOverlay,
} from '../components/tools/PianoOverlay';

function createMockAudioContextClass(startedOscs: Array<{ freq: number }> = []) {
  const disconnectedNodes: string[] = [];
  const createParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  class MockAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 1.0;
    destination = {};
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    close = vi.fn(async () => {
      this.state = 'closed';
    });
    createGain = vi.fn(() => {
      const node = {
        gain: createParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          disconnectedNodes.push('gain');
        }),
      };
      return node;
    });
    createDynamicsCompressor = vi.fn(() => ({
      threshold: createParam(-12),
      knee: createParam(12),
      ratio: createParam(8),
      attack: createParam(0.003),
      release: createParam(0.15),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    createOscillator = vi.fn(() => {
      const osc = {
        type: 'sine',
        frequency: createParam(440),
        detune: createParam(0),
        setPeriodicWave: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(() => {
          disconnectedNodes.push('osc');
        }),
        start: vi.fn(() => {
          startedOscs.push({ freq: osc.frequency.value });
        }),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      return osc;
    });
    createPeriodicWave = vi.fn(() => ({}));
    createBiquadFilter = vi.fn(() => ({
      type: 'lowpass',
      Q: createParam(0.7),
      frequency: createParam(1000),
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        disconnectedNodes.push('filter');
      }),
    }));
  }

  return { MockAudioContext, disconnectedNodes };
}

describe('audio pure helpers', () => {
  it('computes beatsPerBar accurately for all supported time signatures', () => {
    expect(beatsPerBar('2/4')).toBe(2);
    expect(beatsPerBar('3/4')).toBe(3);
    expect(beatsPerBar('4/4')).toBe(4);
    expect(beatsPerBar('6/8')).toBe(6);
    expect(beatsPerBar('3/8')).toBe(3);
    expect(beatsPerBar('5/4')).toBe(5);
  });

  it('computes tap tempo BPM, averaging up to MAX_TAP_INTERVALS, ignoring >2500ms gaps, and clamping 30..240', () => {
    expect(TAP_RESET_GAP_MS).toBe(2500);
    expect(MAX_TAP_INTERVALS).toBe(6);
    expect(MIN_BPM).toBe(30);
    expect(MAX_BPM).toBe(240);

    expect(computeTapTempoBpm([])).toBeNull();
    expect(computeTapTempoBpm([1000])).toBeNull();
    expect(computeTapTempoBpm([0, 2600])).toBeNull();
    expect(computeTapTempoBpm([0, 4000])).toBeNull();
    expect(computeTapTempoBpm([0, 500, 1000])).toBe(120);
    expect(computeTapTempoBpm([0, 500, 4000, 4500])).toBe(120);
    expect(computeTapTempoBpm([0, 500, 1000, 5000, 5600, 6200])).toBe(100);
    expect(computeTapTempoBpm([0, 500, 1000, 4000])).toBe(120);
    expect(computeTapTempoBpm([0, 600, 1200, 6000])).toBe(100);

    // 10 taps where first 3 intervals are 1000ms (60 BPM) and last 6 intervals are 500ms (120 BPM)
    const taps = [0, 1000, 2000, 3000, 3500, 4000, 4500, 5000, 5500, 6000];
    expect(computeTapTempoBpm(taps)).toBe(120);

    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(300)).toBe(240);
    expect(clampBpm(Number.NaN)).toBe(100);

    expect(computeTapTempoBpm([0, 100, 200, 300])).toBe(240);
    expect(computeTapTempoBpm([0, 2400, 4800])).toBe(30);
    expect(computeTapTempoBpm([0, 2450, 4900])).toBe(30);
  });

  it('computes midiToFrequency with configurable A4 reference pitch and clamps 438..444 Hz', () => {
    expect(midiToFrequency(69, 440)).toBeCloseTo(440, 6);
    expect(midiToFrequency(57, 440)).toBeCloseTo(220, 6);
    expect(midiToFrequency(81, 440)).toBeCloseTo(880, 6);
    expect(midiToFrequency(36, 440)).toBeCloseTo(65.406391, 4);
    expect(midiToFrequency(60, 440)).toBeCloseTo(261.625565, 4);

    expect(midiToFrequency(69, 442)).toBeCloseTo(442, 6);
    expect(midiToFrequency(57, 442)).toBeCloseTo(221, 6);
    expect(midiToFrequency(60, 442)).toBeCloseTo(442 * Math.pow(2, -9 / 12), 5);
    expect(midiToFrequency(48, 442) / midiToFrequency(36, 442)).toBeCloseTo(2, 8);

    expect(clampReferencePitchHz(430)).toBe(438);
    expect(clampReferencePitchHz(440)).toBe(440);
    expect(clampReferencePitchHz(442)).toBe(442);
    expect(clampReferencePitchHz(450)).toBe(444);
    expect(clampReferencePitchHz(Number.NaN)).toBe(440);
  });

  it('formats authentic Swedish H/B vs English B/Bb note labels with unified resolveNoteNaming(language, noteNaming)', () => {
    expect(formatMidiNoteLabel(58, 'sv')).toEqual({
      name: 'B',
      octave: 3,
      full: 'B3',
      isAccidental: true,
    });
    expect(formatMidiNoteLabel(58, 'en')).toEqual({
      name: 'B♭',
      octave: 3,
      full: 'B♭3',
      isAccidental: true,
    });
    expect(formatMidiNoteLabel(59, 'sv')).toEqual({
      name: 'H',
      octave: 3,
      full: 'H3',
      isAccidental: false,
    });
    expect(formatMidiNoteLabel(59, 'en')).toEqual({
      name: 'B',
      octave: 3,
      full: 'B3',
      isAccidental: false,
    });
    expect(resolveNoteNaming('sv', 'auto')).toBe('sv');
    expect(resolveNoteNaming('en', 'auto')).toBe('en');
    expect(resolveNoteNaming('en', 'sv')).toBe('sv');
    expect(resolveNoteNaming('sv', 'en')).toBe('en');
    expect(formatChordLabel([59, 48, 58, 48], 'sv')).toBe('C3 · B3 · H3');
    expect(formatChordLabel([59, 48, 58, 48], 'en')).toBe('C3 · B♭3 · B3');
  });
});

describe('Bass C2–C4 default piano range bounds', () => {
  afterEach(() => {
    cleanup();
  });

  it('defaults Mini-Piano layout to Bass C2 (MIDI 36) within C2–C4 bounds', () => {
    expect(BASS_DEFAULT_START_MIDI).toBe(36);
    expect(MIN_PIANO_START_MIDI).toBe(24);
    expect(MAX_PIANO_START_MIDI).toBe(72);
    expect(PIANO_WHITE_KEY_COUNT).toBe(12);

    const layout = buildKeyboardKeys(BASS_DEFAULT_START_MIDI, PIANO_WHITE_KEY_COUNT);
    expect(layout.firstMidi).toBe(36);
    expect(layout.lastMidi).toBe(55);
    expect(layout.firstMidi).toBeGreaterThanOrEqual(36);
    expect(layout.lastMidi).toBeLessThanOrEqual(60);
    expect(layout.whiteKeys).toHaveLength(12);
    expect(layout.blackKeys).toHaveLength(8);
  });

  it('renders PianoOverlay defaulting to C2–G3 with Swedish H2/B2 labels', () => {
    const engine = new PianoEngine();
    render(
      React.createElement(PianoOverlay, {
        language: 'sv',
        noteNaming: 'auto',
        referencePitchHz: 440,
        engine,
      }),
    );

    expect(screen.getByText('C2 – G3')).toBeTruthy();
    expect(screen.getByLabelText('C2')).toBeTruthy();
    expect(screen.getByLabelText('B2')).toBeTruthy();
    expect(screen.getByLabelText('H2')).toBeTruthy();
    expect(screen.getByLabelText('G3')).toBeTruthy();
    engine.dispose();
  });
});

describe('MetronomeEngine & PianoEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
    await closeAudioContext();
  });

  it('runs visual-only metronome beats smoothly without AudioContext', async () => {
    const beats: Array<[number, number]> = [];
    const engine = new MetronomeEngine({
      bpm: 120,
      timeSignature: '3/4',
      onBeat: (b, t) => beats.push([b, t]),
    });

    expect(engine.getSnapshot().audible).toBe(false);
    await engine.start();

    vi.advanceTimersByTime(1100);

    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0]).toEqual([0, 3]);
    expect(beats[1]).toEqual([1, 3]);
    engine.dispose();
  });

  it('resyncs metronome nextNoteTime after a sleep/suspension jump instead of firing a catch-up storm', async () => {
    const beats: number[] = [];
    const engine = new MetronomeEngine({
      bpm: 120, // 0.5s beat interval
      timeSignature: '4/4',
      onBeat: (b) => beats.push(b),
    });

    let fakeNowMs = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);

    await engine.start();
    // First beat fires right away
    vi.advanceTimersByTime(25);
    const initialCount = beats.length;
    expect(initialCount).toBe(1);

    // Simulate 15 seconds of device sleep before next scheduler tick fires
    fakeNowMs += 15_000;
    vi.advanceTimersByTime(25);

    // Without the catch-up guard, 15s / 0.5s = 30 beats would be queued immediately.
    // With the guard, nextNoteTime is resynced to now + 0.015, scheduling only 1 beat.
    vi.advanceTimersByTime(25);
    expect(beats.length - initialCount).toBeLessThanOrEqual(2);

    engine.dispose();
  });

  it('creates lazy AudioContext with compressor, drives audible clicks, and cleans up warmthGain on dispose', async () => {
    const startedOscs: Array<{ freq: number }> = [];
    const { MockAudioContext, disconnectedNodes } = createMockAudioContextClass(startedOscs);
    vi.stubGlobal('AudioContext', MockAudioContext);

    const ctx = await ensureAudioContext();
    expect(ctx.state).toBe('running');

    const metro = new MetronomeEngine({ bpm: 120, timeSignature: '6/8', audible: true });
    await metro.start();
    expect(startedOscs.length).toBeGreaterThanOrEqual(2);
    metro.dispose();

    const piano = new PianoEngine({ referencePitchHz: 440 });
    await piano.playChord([36, 40, 43], 500);
    expect(piano.getActiveNotes()).toEqual([36, 40, 43]);
    vi.advanceTimersByTime(600);
    expect(piano.getActiveNotes()).toEqual([]);

    piano.noteOn(48);
    piano.dispose();
    // Disposing disconnects oscMain, oscWarmth, warmthGain, filter, envGain, and pianoMasterGain
    expect(disconnectedNodes.filter((n) => n === 'gain').length).toBeGreaterThanOrEqual(3);
  });

  it('awaits suspended AudioContext resume before spawning voice on noteOn', async () => {
    const startedOscs: Array<{ freq: number }> = [];
    const { MockAudioContext } = createMockAudioContextClass(startedOscs);
    vi.stubGlobal('AudioContext', MockAudioContext);

    const piano = new PianoEngine({ referencePitchHz: 440 });
    const started = piano.noteOn(60);
    expect(started).toBe(true);
    // Suspended initially: oscillator shouldn't start synchronously before resume resolves
    expect(startedOscs).toHaveLength(0);

    await vi.waitFor(() => {
      expect(startedOscs.length).toBeGreaterThanOrEqual(1);
    });
    piano.dispose();
  });

  it('handles polyphony, Hold toggle-off, and stopAll in PianoEngine', () => {
    const engine = new PianoEngine({ referencePitchHz: 442 });
    expect(engine.getReferencePitchHz()).toBe(442);

    engine.noteOn(36);
    engine.noteOn(40);
    expect(engine.getActiveNotes()).toEqual([36, 40]);

    engine.noteOff(36);
    expect(engine.getActiveNotes()).toEqual([40]);

    engine.setHold(true);
    engine.noteOn(43);
    engine.noteOff(43);
    expect(engine.getActiveNotes()).toEqual([40, 43]);

    const started = engine.noteOn(43);
    expect(started).toBe(false);
    expect(engine.getActiveNotes()).toEqual([40]);

    engine.stopAll();
    expect(engine.getActiveNotes()).toEqual([]);
    engine.dispose();
  });
});
