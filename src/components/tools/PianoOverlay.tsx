import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Lock,
  Play,
  Save,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DEFAULT_REF_PITCH_HZ,
  formatChordLabel,
  formatMidiNoteLabel,
  pianoEngine,
  PianoEngine,
  type PianoStateSnapshot,
} from '../../audio/pianoEngine';
import { resolveNoteNaming } from '../../i18n';
import type { AppLanguage, NoteNaming, SavedPitch } from '../../types';
import { getToolsStrings } from './i18n';
import './tools.css';

export const BASS_DEFAULT_START_MIDI = 36; // C2
export const MIN_PIANO_START_MIDI = 24; // C1
export const MAX_PIANO_START_MIDI = 72; // C5
export const PIANO_WHITE_KEY_COUNT = 12; // 1.5+ octaves (e.g. C2–G3)

export interface WhiteKeySpec {
  midi: number;
  index: number;
}

export interface BlackKeySpec {
  midi: number;
  leftPercent: number;
}

export interface KeyboardLayout {
  whiteKeys: WhiteKeySpec[];
  blackKeys: BlackKeySpec[];
  firstMidi: number;
  lastMidi: number;
}

/**
 * Generates white and black key layout specs starting from `startWhiteMidi`.
 */
export function buildKeyboardKeys(
  startWhiteMidi: number,
  whiteKeyCount = PIANO_WHITE_KEY_COUNT,
): KeyboardLayout {
  let cursor = Math.round(startWhiteMidi);
  while (formatMidiNoteLabel(cursor, 'en').isAccidental) {
    cursor -= 1;
  }

  const whiteKeys: WhiteKeySpec[] = [];
  while (whiteKeys.length < whiteKeyCount) {
    if (!formatMidiNoteLabel(cursor, 'en').isAccidental) {
      whiteKeys.push({ midi: cursor, index: whiteKeys.length });
    }
    cursor += 1;
  }

  const blackKeys: BlackKeySpec[] = [];
  for (let i = 0; i < whiteKeys.length - 1; i++) {
    const curr = whiteKeys[i].midi;
    const next = whiteKeys[i + 1].midi;
    if (next - curr === 2) {
      blackKeys.push({
        midi: curr + 1,
        leftPercent: ((i + 1) / whiteKeys.length) * 100,
      });
    }
  }

  const firstMidi = whiteKeys[0]?.midi ?? startWhiteMidi;
  const lastMidi = whiteKeys[whiteKeys.length - 1]?.midi ?? startWhiteMidi;

  return { whiteKeys, blackKeys, firstMidi, lastMidi };
}

export interface PianoOverlayProps {
  /** Active UI language. */
  language: AppLanguage;
  /** Note naming preference ('auto' | 'sv' | 'en'). */
  noteNaming: NoteNaming;
  /** Reference A4 pitch in Hz (438..444, default 440). */
  referencePitchHz?: number;
  /** Currently saved starting pitch for the score, if any. */
  savedPitch?: SavedPitch | null;
  /** Optional visibility flag (defaults to true). */
  isOpen?: boolean;
  /** Called when the user closes the mini-piano overlay. */
  onClose?: () => void;
  /** Called when the user taps "Spara startton / Save pitch". */
  onSavePitch?: (pitch: SavedPitch) => void | Promise<void>;
  /** Optional custom PianoEngine instance (defaults to shared singleton). */
  engine?: PianoEngine;
  /** Optional additional CSS class. */
  className?: string;
}

export function PianoOverlay({
  language,
  noteNaming,
  referencePitchHz = DEFAULT_REF_PITCH_HZ,
  savedPitch,
  isOpen = true,
  onClose,
  onSavePitch,
  engine = pianoEngine,
  className = '',
}: PianoOverlayProps) {
  const strings = getToolsStrings(language);
  const resolvedNaming = resolveNoteNaming(language, noteNaming);

  const [snapshot, setSnapshot] = useState<PianoStateSnapshot>(() => engine.getSnapshot());
  const [startMidi, setStartMidi] = useState<number>(BASS_DEFAULT_START_MIDI);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [lastPlayedNotes, setLastPlayedNotes] = useState<number[]>([]);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const pointerToMidiRef = useRef<Map<number, number>>(new Map());
  const keyboardNotesRef = useRef<Set<number>>(new Set());
  const clusterSetRef = useRef<Set<number>>(new Set());
  const wasEmptyRef = useRef<boolean>(true);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = engine.subscribe((next) => {
      setSnapshot(next);
    });
    return () => {
      unsubscribe();
    };
  }, [engine]);

  useEffect(() => {
    engine.setReferencePitchHz(referencePitchHz);
  }, [engine, referencePitchHz]);

  // Track chord clusters played together so multi-finger chords can be saved after lifting fingers
  useEffect(() => {
    if (snapshot.activeNotes.length > 0) {
      if (wasEmptyRef.current) {
        clusterSetRef.current = new Set(snapshot.activeNotes);
        wasEmptyRef.current = false;
      } else {
        for (const n of snapshot.activeNotes) {
          clusterSetRef.current.add(n);
        }
      }
      setLastPlayedNotes(Array.from(clusterSetRef.current).sort((a, b) => a - b));
    } else {
      wasEmptyRef.current = true;
    }
  }, [snapshot.activeNotes]);

  // Silence sustained notes cleanly if overlay closes or unmounts
  useEffect(() => {
    if (!isOpen) {
      pointerToMidiRef.current.clear();
      keyboardNotesRef.current.clear();
      engine.setHold(false);
      engine.stopAll();
    }
  }, [engine, isOpen]);

  useEffect(() => {
    return () => {
      pointerToMidiRef.current.clear();
      keyboardNotesRef.current.clear();
      engine.setHold(false);
      engine.stopAll();
      if (savedTimerRef.current !== null) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, [engine]);

  const layout = useMemo(
    () => buildKeyboardKeys(startMidi, PIANO_WHITE_KEY_COUNT),
    [startMidi],
  );

  const activeNoteSet = useMemo(
    () => new Set(snapshot.activeNotes),
    [snapshot.activeNotes],
  );

  const rangeLabel = useMemo(() => {
    const first = formatMidiNoteLabel(layout.firstMidi, resolvedNaming).full;
    const last = formatMidiNoteLabel(layout.lastMidi, resolvedNaming).full;
    return `${first} – ${last}`;
  }, [layout.firstMidi, layout.lastMidi, resolvedNaming]);

  const notesToSave = useMemo(() => {
    if (snapshot.activeNotes.length > 0) {
      return snapshot.activeNotes;
    }
    return lastPlayedNotes;
  }, [snapshot.activeNotes, lastPlayedNotes]);

  const currentPitchDisplay = useMemo(() => {
    if (notesToSave.length > 0) {
      return formatChordLabel(notesToSave, resolvedNaming);
    }
    if (savedPitch && savedPitch.midiNotes.length > 0) {
      return formatChordLabel(savedPitch.midiNotes, resolvedNaming);
    }
    return '';
  }, [notesToSave, resolvedNaming, savedPitch]);

  const handleShiftOctave = useCallback((deltaSemitones: number) => {
    setStartMidi((prev) =>
      Math.min(MAX_PIANO_START_MIDI, Math.max(MIN_PIANO_START_MIDI, prev + deltaSemitones)),
    );
  }, []);

  const handleKeyPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, midi: number) => {
      e.preventDefault();
      e.stopPropagation();

      if (typeof e.pointerId === 'number') {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer capture is unsupported in test environments.
        }
      }

      const pointerKey = typeof e.pointerId === 'number' ? e.pointerId : -(midi + 1000);
      pointerToMidiRef.current.set(pointerKey, midi);
      engine.noteOn(midi);
    },
    [engine],
  );

  const handleKeyPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, fallbackMidi: number) => {
      e.stopPropagation();
      const pointerKey = typeof e.pointerId === 'number' ? e.pointerId : -(fallbackMidi + 1000);
      const midi = pointerToMidiRef.current.get(pointerKey);
      if (midi === undefined) {
        return;
      }
      pointerToMidiRef.current.delete(pointerKey);

      if (typeof e.pointerId === 'number') {
        try {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore capture release errors.
        }
      }

      // Only release if no other active pointer is holding the exact same key
      let stillHeldByAnotherPointer = false;
      for (const activeMidi of pointerToMidiRef.current.values()) {
        if (activeMidi === midi) {
          stillHeldByAnotherPointer = true;
          break;
        }
      }

      if (!stillHeldByAnotherPointer && !keyboardNotesRef.current.has(midi)) {
        engine.noteOff(midi);
      }
    },
    [engine],
  );

  const handleKeyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, midi: number) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || keyboardNotesRef.current.has(midi)) return;
      keyboardNotesRef.current.add(midi);
      engine.noteOn(midi);
    },
    [engine],
  );

  const handleKeyKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, midi: number) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (keyboardNotesRef.current.delete(midi)) {
        engine.noteOff(midi);
      }
    },
    [engine],
  );

  const handleKeyBlur = useCallback(
    (midi: number) => {
      if (keyboardNotesRef.current.delete(midi)) {
        engine.noteOff(midi);
      }
    },
    [engine],
  );

  const handleSavePitch = useCallback(async () => {
    if (!onSavePitch || notesToSave.length === 0) {
      return;
    }

    const label = formatChordLabel(notesToSave, resolvedNaming);
    await onSavePitch({
      midiNotes: [...notesToSave],
      label,
    });

    setSavedFeedback(true);
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSavedFeedback(false);
    }, 2000);
  }, [notesToSave, onSavePitch, resolvedNaming]);

  const handleReplaySavedPitch = useCallback(() => {
    if (!savedPitch || savedPitch.midiNotes.length === 0) {
      return;
    }
    void engine.playChord(savedPitch.midiNotes, 1800);
  }, [engine, savedPitch]);

  if (!isOpen) {
    return null;
  }

  const presets = [
    { label: strings.bassRange, start: 36 }, // C2
    { label: strings.baritoneRange, start: 43 }, // G2
    { label: strings.tenorRange, start: 48 }, // C3
    { label: strings.trebleRange, start: 60 }, // C4
  ];

  return (
    <section
      className={`nl-tool-panel nl-piano-overlay no-select ${isCollapsed ? 'is-collapsed' : ''} ${className}`.trim()}
      aria-label={strings.pianoTitle}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="nl-tool-header">
        <div className="nl-tool-title-group">
          <span className="nl-tool-title">{strings.pianoTitle}</span>
          <span className="nl-tool-badge">{strings.namingBadge(resolvedNaming)}</span>
          <span className="nl-tool-badge nl-mono-badge">
            {strings.referenceA4} {snapshot.referencePitchHz} Hz
          </span>
          {currentPitchDisplay && (
            <span className="nl-pitch-readout-pill" title={strings.selectedPitch}>
              {currentPitchDisplay}
            </span>
          )}
        </div>

        <div className="nl-tool-header-actions">
          {savedPitch && savedPitch.midiNotes.length > 0 && (
            <button
              type="button"
              className="nl-tool-btn nl-saved-pitch-play-btn"
              onClick={handleReplaySavedPitch}
              aria-label={strings.playSavedPitch}
            >
              <Play size={16} />
              <span>
                {savedPitch.midiNotes.length > 0
                  ? formatChordLabel(savedPitch.midiNotes, resolvedNaming)
                  : savedPitch.label}
              </span>
            </button>
          )}

          <button
            type="button"
            className="nl-tool-icon-btn"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={isCollapsed ? strings.expand : strings.collapse}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>

          {onClose && (
            <button
              type="button"
              className="nl-tool-icon-btn"
              onClick={onClose}
              aria-label={strings.close}
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="nl-piano-body">
          {/* Control Strip: Octave, Hold, Stop All, Volume, Save Pitch */}
          <div className="nl-piano-controls-row">
            <div className="nl-octave-controls">
              <button
                type="button"
                className="nl-tool-btn"
                onClick={() => handleShiftOctave(-12)}
                disabled={startMidi <= MIN_PIANO_START_MIDI}
                aria-label={strings.octaveDown}
              >
                <ChevronLeft size={18} />
                <span>{strings.octave}</span>
              </button>

              <span className="nl-range-badge">{rangeLabel}</span>

              <button
                type="button"
                className="nl-tool-btn"
                onClick={() => handleShiftOctave(12)}
                disabled={startMidi >= MAX_PIANO_START_MIDI}
                aria-label={strings.octaveUp}
              >
                <span>{strings.octave}</span>
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="nl-piano-action-buttons">
              <button
                type="button"
                className={`nl-tool-btn ${snapshot.hold ? 'is-accent-active' : ''}`}
                onClick={() => engine.setHold(!snapshot.hold)}
                aria-pressed={snapshot.hold}
              >
                <Lock size={17} />
                <span>{strings.holdTone}</span>
              </button>

              <button
                type="button"
                className="nl-tool-btn nl-stop-btn"
                onClick={() => engine.stopAll()}
                disabled={snapshot.activeNotes.length === 0}
              >
                <VolumeX size={17} />
                <span>{strings.stopAll}</span>
              </button>

              {onSavePitch && (
                <button
                  type="button"
                  className={`nl-tool-btn nl-save-btn ${savedFeedback ? 'is-saved' : ''}`}
                  onClick={() => void handleSavePitch()}
                  disabled={notesToSave.length === 0}
                >
                  {savedFeedback ? <Check size={18} /> : <Save size={18} />}
                  <span>{savedFeedback ? strings.saved : strings.savePitch}</span>
                </button>
              )}
            </div>
          </div>

          {/* Voice Range Presets + Volume Slider */}
          <div className="nl-piano-subrow">
            <div className="nl-preset-pills">
              {presets.map((preset) => {
                const selected = startMidi === preset.start;
                return (
                  <button
                    key={preset.start}
                    type="button"
                    className={`nl-pill-btn ${selected ? 'is-selected' : ''}`}
                    onClick={() => setStartMidi(preset.start)}
                    aria-pressed={selected}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="nl-piano-volume">
              <Volume2 size={16} aria-hidden="true" />
              <input
                type="range"
                className="nl-tool-slider"
                min={0}
                max={1}
                step={0.05}
                value={snapshot.volume}
                aria-label={strings.volume}
                onChange={(e) => engine.setVolume(Number(e.target.value))}
              />
              <span className="nl-slider-bound">{Math.round(snapshot.volume * 100)}%</span>
            </div>
          </div>

          {/* Multi-touch Keyboard Bed (White keys >= 48px wide in portrait) */}
          <div className="nl-piano-scroll">
            <div
              className="nl-piano-track"
              style={
                {
                  '--white-key-count': String(layout.whiteKeys.length),
                } as React.CSSProperties
              }
            >
              {/* White Keys */}
              <div className="nl-piano-white-layer">
                {layout.whiteKeys.map(({ midi }) => {
                  const note = formatMidiNoteLabel(midi, resolvedNaming);
                  const isActive = activeNoteSet.has(midi);
                  const isC = midi % 12 === 0;

                  return (
                    <button
                      key={midi}
                      type="button"
                      className={`nl-piano-key-white ${isActive ? 'is-pressed' : ''} ${isC ? 'is-c-key' : ''}`}
                      data-midi={midi}
                      aria-label={note.full}
                      aria-pressed={isActive}
                      onPointerDown={(e) => handleKeyPointerDown(e, midi)}
                      onPointerUp={(e) => handleKeyPointerEnd(e, midi)}
                      onPointerCancel={(e) => handleKeyPointerEnd(e, midi)}
                      onLostPointerCapture={(e) => handleKeyPointerEnd(e, midi)}
                      onKeyDown={(e) => handleKeyKeyDown(e, midi)}
                      onKeyUp={(e) => handleKeyKeyUp(e, midi)}
                      onBlur={() => handleKeyBlur(midi)}
                    >
                      <span className="nl-key-label-name">{note.name}</span>
                      <span className="nl-key-label-oct">{note.octave}</span>
                    </button>
                  );
                })}
              </div>

              {/* Black Keys */}
              <div className="nl-piano-black-layer">
                {layout.blackKeys.map(({ midi, leftPercent }) => {
                  const note = formatMidiNoteLabel(midi, resolvedNaming);
                  const isActive = activeNoteSet.has(midi);

                  return (
                    <button
                      key={midi}
                      type="button"
                      className={`nl-piano-key-black ${isActive ? 'is-pressed' : ''}`}
                      style={{ left: `${leftPercent}%` }}
                      data-midi={midi}
                      aria-label={note.full}
                      aria-pressed={isActive}
                      onPointerDown={(e) => handleKeyPointerDown(e, midi)}
                      onPointerUp={(e) => handleKeyPointerEnd(e, midi)}
                      onPointerCancel={(e) => handleKeyPointerEnd(e, midi)}
                      onLostPointerCapture={(e) => handleKeyPointerEnd(e, midi)}
                      onKeyDown={(e) => handleKeyKeyDown(e, midi)}
                      onKeyUp={(e) => handleKeyKeyUp(e, midi)}
                      onBlur={() => handleKeyBlur(midi)}
                    >
                      <span className="nl-key-label-black">{note.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {notesToSave.length === 0 && (
            <div className="nl-piano-hint">{strings.tapKeysHint}</div>
          )}
        </div>
      )}
    </section>
  );
}

export default PianoOverlay;
