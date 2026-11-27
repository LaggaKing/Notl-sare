import type { AppLanguage } from '../../types';

export interface ToolsStrings {
  // Metronome
  metronome: string;
  visualPulseOnly: string;
  soundOn: string;
  soundOff: string;
  toggleSound: string;
  volume: string;
  tapTempo: string;
  timeSignature: string;
  saveTempo: string;
  saved: string;
  start: string;
  stop: string;
  bpm: string;
  decreaseBpm: string;
  increaseBpm: string;
  beatLabel: (beat: number, total: number) => string;

  // Mini-Piano
  pianoTitle: string;
  octave: string;
  octaveDown: string;
  octaveUp: string;
  holdTone: string;
  stopAll: string;
  savePitch: string;
  playSavedPitch: string;
  selectedPitch: string;
  tapKeysHint: string;
  bassRange: string;
  baritoneRange: string;
  tenorRange: string;
  trebleRange: string;
  referenceA4: string;
  namingBadge: (naming: 'sv' | 'en') => string;

  // Shared
  close: string;
  collapse: string;
  expand: string;
}

export const TOOLS_STRINGS: Record<AppLanguage, ToolsStrings> = {
  sv: {
    metronome: 'Metronom',
    visualPulseOnly: 'Visuell puls',
    soundOn: 'Ljud på',
    soundOff: 'Ljud av',
    toggleSound: 'Ljud på/av',
    volume: 'Volym',
    tapTempo: 'Tappa tempo',
    timeSignature: 'Taktart',
    saveTempo: 'Spara tempo',
    saved: 'Sparad',
    start: 'Starta',
    stop: 'Stopp',
    bpm: 'BPM',
    decreaseBpm: 'Minska tempo',
    increaseBpm: 'Öka tempo',
    beatLabel: (beat, total) => `Slag ${beat} av ${total}`,

    pianoTitle: 'Startton / Piano',
    octave: 'Oktav',
    octaveDown: 'Lägre oktav',
    octaveUp: 'Högre oktav',
    holdTone: 'Håll ton / Ackord',
    stopAll: 'Tysta alla',
    savePitch: 'Spara startton',
    playSavedPitch: 'Spela sparad startton',
    selectedPitch: 'Vald ton',
    tapKeysHint: 'Tryck på tangenter för startton',
    bassRange: 'Bas (C2)',
    baritoneRange: 'Baryton (G2)',
    tenorRange: 'Tenor (C3)',
    trebleRange: 'Alt/Sopran (C4)',
    referenceA4: 'A4',
    namingBadge: (naming) => (naming === 'sv' ? 'Sv: H / B' : 'En: B / B♭'),

    close: 'Stäng',
    collapse: 'Minimera',
    expand: 'Expandera',
  },
  en: {
    metronome: 'Metronome',
    visualPulseOnly: 'Visual pulse',
    soundOn: 'Sound on',
    soundOff: 'Muted',
    toggleSound: 'Toggle sound',
    volume: 'Volume',
    tapTempo: 'Tap tempo',
    timeSignature: 'Time signature',
    saveTempo: 'Save BPM',
    saved: 'Saved',
    start: 'Start',
    stop: 'Stop',
    bpm: 'BPM',
    decreaseBpm: 'Decrease BPM',
    increaseBpm: 'Increase BPM',
    beatLabel: (beat, total) => `Beat ${beat} of ${total}`,

    pianoTitle: 'Pitch / Piano',
    octave: 'Octave',
    octaveDown: 'Octave down',
    octaveUp: 'Octave up',
    holdTone: 'Hold / Chord',
    stopAll: 'Stop all',
    savePitch: 'Save pitch',
    playSavedPitch: 'Play saved pitch',
    selectedPitch: 'Selected pitch',
    tapKeysHint: 'Tap keys to select starting pitch',
    bassRange: 'Bass (C2)',
    baritoneRange: 'Baritone (G2)',
    tenorRange: 'Tenor (C3)',
    trebleRange: 'Alto/Sop (C4)',
    referenceA4: 'A4',
    namingBadge: (naming) => (naming === 'sv' ? 'Sv: H / B' : 'En: B / B♭'),

    close: 'Close',
    collapse: 'Collapse',
    expand: 'Expand',
  },
};

export function getToolsStrings(language: AppLanguage): ToolsStrings {
  return TOOLS_STRINGS[language] ?? TOOLS_STRINGS.sv;
}
