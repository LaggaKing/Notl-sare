import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Play,
  Plus,
  Save,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  beatsPerBar,
  clampBpm,
  computeTapTempoBpm,
  DEFAULT_BPM,
  MAX_BPM,
  metronomeEngine,
  MetronomeEngine,
  MIN_BPM,
  TAP_RESET_GAP_MS,
  TIME_SIGNATURES,
  type MetronomeSnapshot,
} from '../../audio/metronomeEngine';
import type { AppLanguage, TimeSignature } from '../../types';
import { getToolsStrings } from './i18n';
import './tools.css';

export interface MetronomeOverlayProps {
  /** Saved BPM from the active score, if any (defaults to 100). */
  initialBpm?: number | null;
  /** Saved time signature from the active score, if any (defaults to '4/4'). */
  initialTimeSignature?: TimeSignature | null;
  /** Active UI language. */
  language: AppLanguage;
  /** Optional visibility flag (defaults to true). */
  isOpen?: boolean;
  /** Called when the user closes the metronome panel. */
  onClose?: () => void;
  /** Called when the user saves BPM & time signature to the active score. */
  onSaveTempo?: (bpm: number, timeSignature: TimeSignature) => void | Promise<void>;
  /** Optional custom MetronomeEngine instance (defaults to shared singleton). */
  engine?: MetronomeEngine;
  /** Optional additional CSS class. */
  className?: string;
}

export function MetronomeOverlay({
  initialBpm,
  initialTimeSignature,
  language,
  isOpen = true,
  onClose,
  onSaveTempo,
  engine = metronomeEngine,
  className = '',
}: MetronomeOverlayProps) {
  const strings = getToolsStrings(language);
  const [snapshot, setSnapshot] = useState<MetronomeSnapshot>(() => engine.getSnapshot());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [tapPulse, setTapPulse] = useState(false);

  const tapTimestampsRef = useRef<number[]>([]);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevInitialBpmRef = useRef<number | null | undefined>(undefined);
  const prevInitialSigRef = useRef<TimeSignature | null | undefined>(undefined);

  // Subscribe to metronome engine state
  useEffect(() => {
    const unsubscribe = engine.subscribeState((next) => {
      setSnapshot(next);
    });
    return () => {
      unsubscribe();
    };
  }, [engine]);

  // Sync score's saved BPM and time signature when opening or switching scores
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (prevInitialBpmRef.current !== initialBpm) {
      prevInitialBpmRef.current = initialBpm;
      if (typeof initialBpm === 'number' && Number.isFinite(initialBpm)) {
        engine.setBpm(initialBpm);
      } else {
        engine.setBpm(DEFAULT_BPM);
      }
    }
    if (prevInitialSigRef.current !== initialTimeSignature) {
      prevInitialSigRef.current = initialTimeSignature;
      engine.setTimeSignature(initialTimeSignature ?? '4/4');
    }
  }, [engine, initialBpm, initialTimeSignature, isOpen]);

  // Ensure concert-safe stop on close or unmount
  useEffect(() => {
    if (!isOpen) {
      engine.stop();
    }
  }, [engine, isOpen]);

  useEffect(() => {
    return () => {
      engine.stop();
      if (savedTimerRef.current !== null) {
        clearTimeout(savedTimerRef.current);
      }
      if (tapPulseTimerRef.current !== null) {
        clearTimeout(tapPulseTimerRef.current);
      }
    };
  }, [engine]);

  const beatCount = useMemo(
    () => beatsPerBar(snapshot.timeSignature),
    [snapshot.timeSignature],
  );

  const handleTogglePlay = useCallback(() => {
    void engine.toggle();
  }, [engine]);

  const handleToggleAudible = useCallback(() => {
    engine.setAudible(!snapshot.audible);
  }, [engine, snapshot.audible]);

  const handleStepBpm = useCallback(
    (delta: number) => {
      engine.setBpm(clampBpm(snapshot.bpm + delta));
    },
    [engine, snapshot.bpm],
  );

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const prev = tapTimestampsRef.current;
    const last = prev.length > 0 ? prev[prev.length - 1] : null;
    const nextHistory =
      last !== null && now - last > TAP_RESET_GAP_MS
        ? [now]
        : [...prev.slice(-7), now];
    tapTimestampsRef.current = nextHistory;

    const computed = computeTapTempoBpm(nextHistory);
    if (computed !== null) {
      engine.setBpm(computed);
    }

    setTapPulse(true);
    if (tapPulseTimerRef.current !== null) {
      clearTimeout(tapPulseTimerRef.current);
    }
    tapPulseTimerRef.current = setTimeout(() => {
      setTapPulse(false);
    }, 140);
  }, [engine]);

  const handleSave = useCallback(async () => {
    if (!onSaveTempo) {
      return;
    }
    await onSaveTempo(snapshot.bpm, snapshot.timeSignature);
    setSavedFeedback(true);
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = setTimeout(() => {
      setSavedFeedback(false);
    }, 2000);
  }, [onSaveTempo, snapshot.bpm, snapshot.timeSignature]);

  if (!isOpen) {
    return null;
  }

  return (
    <section
      className={`nl-tool-panel nl-metronome-overlay no-select ${isCollapsed ? 'is-collapsed' : ''} ${className}`.trim()}
      aria-label={strings.metronome}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Bar: Title, Play/Stop, Visual/Sound Toggle, Collapse, Close */}
      <div className="nl-tool-header">
        <div className="nl-tool-title-group">
          <span className="nl-tool-title">{strings.metronome}</span>
          <span className="nl-tool-badge">{snapshot.bpm} {strings.bpm}</span>
        </div>

        <div className="nl-tool-header-actions">
          <button
            type="button"
            className={`nl-tool-btn nl-tool-btn-primary ${snapshot.isRunning ? 'is-active' : ''}`}
            onClick={handleTogglePlay}
            aria-label={snapshot.isRunning ? strings.stop : strings.start}
            aria-pressed={snapshot.isRunning}
          >
            {snapshot.isRunning ? <Square size={18} /> : <Play size={18} />}
            <span>{snapshot.isRunning ? strings.stop : strings.start}</span>
          </button>

          <button
            type="button"
            className={`nl-tool-btn ${snapshot.audible ? 'is-accent-outline' : 'is-muted-safe'}`}
            onClick={handleToggleAudible}
            aria-label={strings.toggleSound}
            aria-pressed={snapshot.audible}
          >
            {snapshot.audible ? <Volume2 size={18} /> : <VolumeX size={18} />}
            <span>{snapshot.audible ? strings.soundOn : strings.visualPulseOnly}</span>
          </button>

          <button
            type="button"
            className="nl-tool-icon-btn"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label={isCollapsed ? strings.expand : strings.collapse}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
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

      {/* Visual Beat Dots (always visible even when collapsed!) */}
      <div className="nl-beat-dots-row" role="status" aria-live="off">
        {Array.from({ length: beatCount }, (_, idx) => {
          const isActive = snapshot.isRunning && snapshot.currentBeat === idx;
          const isDownbeat = idx === 0;
          const isCompoundSubAccent = snapshot.timeSignature === '6/8' && idx === 3;

          return (
            <div
              key={idx}
              className={[
                'nl-beat-dot',
                isDownbeat ? 'is-downbeat' : '',
                isCompoundSubAccent ? 'is-sub-accent' : '',
                isActive ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-active={isActive ? 'true' : 'false'}
              aria-label={strings.beatLabel(idx + 1, beatCount)}
            >
              <span className="nl-beat-dot-num">{idx + 1}</span>
            </div>
          );
        })}
      </div>

      {!isCollapsed && (
        <div className="nl-metronome-body">
          {/* BPM Stepper, Readout & Tap Tempo */}
          <div className="nl-bpm-row">
            <div className="nl-bpm-stepper">
              <button
                type="button"
                className="nl-tool-icon-btn nl-step-btn"
                onClick={() => handleStepBpm(-1)}
                disabled={snapshot.bpm <= MIN_BPM}
                aria-label={strings.decreaseBpm}
              >
                <Minus size={20} />
              </button>

              <div className="nl-bpm-readout">
                <span className="nl-bpm-value">{snapshot.bpm}</span>
                <span className="nl-bpm-unit">{strings.bpm}</span>
              </div>

              <button
                type="button"
                className="nl-tool-icon-btn nl-step-btn"
                onClick={() => handleStepBpm(1)}
                disabled={snapshot.bpm >= MAX_BPM}
                aria-label={strings.increaseBpm}
              >
                <Plus size={20} />
              </button>
            </div>

            <button
              type="button"
              className={`nl-tool-btn nl-tap-tempo-btn ${tapPulse ? 'is-tapped' : ''}`}
              onPointerDown={handleTapTempo}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.repeat) {
                    handleTapTempo();
                  }
                }
              }}
            >
              {strings.tapTempo}
            </button>
          </div>

          {/* Smooth BPM Slider */}
          <div className="nl-slider-row">
            <span className="nl-slider-bound">{MIN_BPM}</span>
            <input
              type="range"
              className="nl-tool-slider"
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              value={snapshot.bpm}
              aria-label={strings.bpm}
              onChange={(e) => engine.setBpm(Number(e.target.value))}
            />
            <span className="nl-slider-bound">{MAX_BPM}</span>
          </div>

          {/* Volume Slider (shown only when audio click is unmuted) */}
          {snapshot.audible && (
            <div className="nl-slider-row nl-volume-row">
              <span className="nl-slider-label">
                <Volume2 size={16} />
                {strings.volume}
              </span>
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
          )}

          {/* Time Signature Pills + Save BPM */}
          <div className="nl-metronome-footer">
            <div className="nl-timesig-pills" role="group" aria-label={strings.timeSignature}>
              {TIME_SIGNATURES.map((sig) => {
                const selected = snapshot.timeSignature === sig;
                return (
                  <button
                    key={sig}
                    type="button"
                    className={`nl-pill-btn ${selected ? 'is-selected' : ''}`}
                    onClick={() => engine.setTimeSignature(sig)}
                    aria-pressed={selected}
                  >
                    {sig}
                  </button>
                );
              })}
            </div>

            {onSaveTempo && (
              <button
                type="button"
                className={`nl-tool-btn nl-save-btn ${savedFeedback ? 'is-saved' : ''}`}
                onClick={() => void handleSave()}
              >
                {savedFeedback ? <Check size={18} /> : <Save size={18} />}
                <span>{savedFeedback ? strings.saved : strings.saveTempo}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default MetronomeOverlay;
