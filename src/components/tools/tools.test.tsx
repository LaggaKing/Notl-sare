import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetronomeEngine, PianoEngine } from '../../audio';
import { buildKeyboardKeys, MetronomeOverlay, PianoOverlay } from './index';

describe('MetronomeOverlay & PianoOverlay UI', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders MetronomeOverlay in Swedish with visual-only default and saves BPM', async () => {
    const onSaveTempo = vi.fn();
    const engine = new MetronomeEngine();

    render(
      <MetronomeOverlay
        language="sv"
        initialBpm={96}
        initialTimeSignature="6/8"
        onSaveTempo={onSaveTempo}
        engine={engine}
      />,
    );

    expect(screen.getByText('Visuell puls')).toBeTruthy();
    expect(screen.getByText('96')).toBeTruthy();
    expect(screen.getByLabelText('Slag 1 av 6')).toBeTruthy();
    expect(screen.getByLabelText('Slag 6 av 6')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Spara tempo'));
    });

    expect(onSaveTempo).toHaveBeenCalledWith(96, '6/8');
    engine.dispose();
  });

  it('renders MetronomeOverlay in English and toggles sound click', () => {
    const engine = new MetronomeEngine();

    render(<MetronomeOverlay language="en" engine={engine} />);

    expect(screen.getByText('Visual pulse')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Toggle sound'));
    expect(screen.getByText('Sound on')).toBeTruthy();
    expect(screen.getByLabelText('Volume')).toBeTruthy();

    engine.dispose();
  });

  it('renders Bass-default PianoOverlay with Swedish H/B and saves played multi-touch chord', async () => {
    const layout = buildKeyboardKeys(36, 12);
    expect(layout.whiteKeys).toHaveLength(12);
    expect(layout.firstMidi).toBe(36);
    expect(layout.lastMidi).toBe(55);

    const onSavePitch = vi.fn();
    const engine = new PianoEngine();

    render(
      <PianoOverlay
        language="sv"
        noteNaming="auto"
        referencePitchHz={440}
        onSavePitch={onSavePitch}
        engine={engine}
      />,
    );

    expect(screen.getByText('C2 – G3')).toBeTruthy();
    expect(screen.getByLabelText('H2')).toBeTruthy();
    expect(screen.getByLabelText('B2')).toBeTruthy();

    const c2Key = screen.getByLabelText('C2');
    const e2Key = screen.getByLabelText('E2');
    fireEvent.pointerDown(c2Key, { pointerId: 1 });
    fireEvent.pointerDown(e2Key, { pointerId: 2 });
    fireEvent.pointerUp(c2Key, { pointerId: 1 });
    fireEvent.pointerUp(e2Key, { pointerId: 2 });

    await act(async () => {
      fireEvent.click(screen.getByText('Spara startton'));
    });

    expect(onSavePitch).toHaveBeenCalledWith({
      midiNotes: [36, 40],
      label: 'C2 · E2',
    });

    engine.dispose();
  });

  it('supports English note naming (Bb/B) and octave shifts in PianoOverlay', () => {
    const engine = new PianoEngine();

    render(
      <PianoOverlay
        language="en"
        noteNaming="en"
        referencePitchHz={442}
        engine={engine}
      />,
    );

    expect(screen.getByLabelText('B♭2')).toBeTruthy();
    expect(screen.getByLabelText('B2')).toBeTruthy();
    expect(screen.getByText('A4 442 Hz')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Octave up'));
    expect(screen.getByText('C3 – G4')).toBeTruthy();

    engine.dispose();
  });

  it('formats saved pitch label dynamically from midiNotes on language switch and supports Enter/Space on keys and tap tempo', () => {
    const pianoEngine = new PianoEngine();
    const { rerender } = render(
      <PianoOverlay
        language="sv"
        noteNaming="auto"
        savedPitch={{ midiNotes: [47, 50], label: 'H2 · D3' }}
        engine={pianoEngine}
      />,
    );

    expect(screen.getByLabelText('Spela sparad startton').textContent).toContain('H2 · D3');

    // Switching language to English updates saved pitch button even though savedPitch.label is stale Swedish
    rerender(
      <PianoOverlay
        language="en"
        noteNaming="auto"
        savedPitch={{ midiNotes: [47, 50], label: 'H2 · D3' }}
        engine={pianoEngine}
      />,
    );
    expect(screen.getByLabelText('Play saved pitch').textContent).toContain('B2 · D3');
    expect(screen.queryByText('H2 · D3')).toBeNull();

    // Enter/Space activates piano key
    const c2Key = screen.getByLabelText('C2');
    fireEvent.keyDown(c2Key, { key: 'Enter' });
    expect(c2Key.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyUp(c2Key, { key: 'Enter' });
    expect(c2Key.getAttribute('aria-pressed')).toBe('false');

    pianoEngine.dispose();

    // Enter/Space activates Metronome Tap Tempo
    const metroEngine = new MetronomeEngine();
    render(<MetronomeOverlay language="en" engine={metroEngine} />);
    const tapBtn = screen.getByText('Tap tempo');
    fireEvent.keyDown(tapBtn, { key: ' ' });
    expect(tapBtn.className).toContain('is-tapped');
    metroEngine.dispose();
  });
});
