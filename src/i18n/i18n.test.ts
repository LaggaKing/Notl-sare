import { describe, expect, it } from 'vitest';
import {
  en,
  formatMessage,
  formatPitchLabel,
  formatSingleMidiNote,
  getTranslations,
  resolveNoteNaming,
  sv,
} from './index';
import { ANNOTATION_I18N } from '../components/annotations/i18n';
import { TOOLS_STRINGS } from '../components/tools/i18n';
import {
  formatChordLabel,
  formatMidiNoteLabel,
  resolveNoteNaming as resolveAudioNoteNaming,
} from '../audio/pianoEngine';

function collectLeafEntries(
  obj: unknown,
  prefix = '',
): Array<{ path: string; kind: string; value: unknown }> {
  if (typeof obj !== 'object' || obj === null) {
    return [{ path: prefix, kind: typeof obj, value: obj }];
  }
  const entries: Array<{ path: string; kind: string; value: unknown }> = [];
  for (const [key, val] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null) {
      entries.push(...collectLeafEntries(val, next));
    } else {
      entries.push({ path: next, kind: typeof val, value: val });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{(\w+)\}/g) ?? [];
  return Array.from(new Set(matches)).sort();
}

describe('i18n strict sv/en parity across all dictionaries', () => {
  it('maintains strict key, non-empty value, and placeholder parity in src/i18n/{sv,en}.ts', () => {
    const svEntries = collectLeafEntries(sv);
    const enEntries = collectLeafEntries(en);

    expect(svEntries.map((e) => e.path)).toEqual(enEntries.map((e) => e.path));

    for (let i = 0; i < svEntries.length; i += 1) {
      const svEntry = svEntries[i];
      const enEntry = enEntries[i];
      expect(svEntry.kind).toBe('string');
      expect(enEntry.kind).toBe('string');
      expect(String(svEntry.value).trim().length).toBeGreaterThan(0);
      expect(String(enEntry.value).trim().length).toBeGreaterThan(0);
      expect(extractPlaceholders(String(svEntry.value))).toEqual(
        extractPlaceholders(String(enEntry.value)),
      );
    }

    expect(getTranslations('sv').library.title).toBe('Bibliotek');
    expect(getTranslations('en').library.title).toBe('Library');
    expect(getTranslations('sv').appName).toBe('Notläsare');
    expect(getTranslations('en').appName).toBe('Notläsare');
    expect(formatMessage(sv.library.lastOpenedPage, { page: 2, total: 5 })).toBe(
      'Senast på sida 2 av 5',
    );
    expect(formatMessage(en.library.lastOpenedPage, { page: 2, total: 5 })).toBe(
      'Last on page 2 of 5',
    );
  });

  it('maintains strict key and non-empty parity in src/components/annotations/i18n.ts', () => {
    const svEntries = collectLeafEntries(ANNOTATION_I18N.sv);
    const enEntries = collectLeafEntries(ANNOTATION_I18N.en);

    expect(svEntries.map((e) => e.path)).toEqual(enEntries.map((e) => e.path));

    for (let i = 0; i < svEntries.length; i += 1) {
      expect(svEntries[i].kind).toBe('string');
      expect(enEntries[i].kind).toBe('string');
      expect(String(svEntries[i].value).trim().length).toBeGreaterThan(0);
      expect(String(enEntries[i].value).trim().length).toBeGreaterThan(0);
    }
  });

  it('maintains strict key and callable parity in src/components/tools/i18n.ts', () => {
    const svEntries = collectLeafEntries(TOOLS_STRINGS.sv);
    const enEntries = collectLeafEntries(TOOLS_STRINGS.en);

    expect(svEntries.map((e) => [e.path, e.kind])).toEqual(
      enEntries.map((e) => [e.path, e.kind]),
    );

    for (let i = 0; i < svEntries.length; i += 1) {
      if (svEntries[i].kind === 'string') {
        expect(String(svEntries[i].value).trim().length).toBeGreaterThan(0);
        expect(String(enEntries[i].value).trim().length).toBeGreaterThan(0);
      }
    }

    expect(TOOLS_STRINGS.sv.beatLabel(2, 4)).toBe('Slag 2 av 4');
    expect(TOOLS_STRINGS.en.beatLabel(2, 4)).toBe('Beat 2 of 4');
    expect(TOOLS_STRINGS.sv.namingBadge('sv')).toBe('Sv: H / B');
    expect(TOOLS_STRINGS.en.namingBadge('en')).toBe('En: B / B♭');
  });

  it('interpolates message templates cleanly', () => {
    expect(formatMessage(sv.common.pageOf, { page: 3, total: 12 })).toBe(
      'Sida 3 av 12',
    );
    expect(formatMessage(en.common.pageOf, { page: 3, total: 12 })).toBe(
      'Page 3 of 12',
    );
  });

  it('formats Swedish H/B and English B/B♭ authentically across octaves with unified resolveNoteNaming', () => {
    const octaves = [
      { octave: 1, bbMidi: 34, bMidi: 35 },
      { octave: 2, bbMidi: 46, bMidi: 47 },
      { octave: 3, bbMidi: 58, bMidi: 59 },
      { octave: 4, bbMidi: 70, bMidi: 71 },
    ];

    for (const { octave, bbMidi, bMidi } of octaves) {
      expect(formatSingleMidiNote(bbMidi, 'sv', 'auto')).toBe(`B${octave}`);
      expect(formatSingleMidiNote(bMidi, 'sv', 'auto')).toBe(`H${octave}`);
      expect(formatMidiNoteLabel(bbMidi, 'sv').full).toBe(`B${octave}`);
      expect(formatMidiNoteLabel(bMidi, 'sv').full).toBe(`H${octave}`);

      expect(formatSingleMidiNote(bbMidi, 'en', 'auto')).toBe(`B♭${octave}`);
      expect(formatSingleMidiNote(bMidi, 'en', 'auto')).toBe(`B${octave}`);
      expect(formatMidiNoteLabel(bbMidi, 'en').full).toBe(`B♭${octave}`);
      expect(formatMidiNoteLabel(bMidi, 'en').full).toBe(`B${octave}`);
    }

    expect(resolveNoteNaming('sv', 'auto')).toBe('sv');
    expect(resolveNoteNaming('en', 'auto')).toBe('en');
    expect(resolveNoteNaming('sv', 'en')).toBe('en');
    expect(resolveNoteNaming('en', 'sv')).toBe('sv');
    expect(resolveAudioNoteNaming).toBe(resolveNoteNaming);

    expect(formatPitchLabel([58], 'sv', 'auto')).toBe('B3');
    expect(formatPitchLabel([58], 'en', 'auto')).toBe('B♭3');
    expect(formatPitchLabel([59], 'sv', 'auto')).toBe('H3');
    expect(formatPitchLabel([59], 'en', 'auto')).toBe('B3');

    expect(formatPitchLabel([47, 46, 36], 'sv', 'auto')).toBe('C2 · B2 · H2');
    expect(formatPitchLabel([47, 46, 36], 'en', 'auto')).toBe('C2 · B♭2 · B2');
    expect(formatChordLabel([47, 46, 36], 'sv')).toBe('C2 · B2 · H2');
    expect(formatChordLabel([47, 46, 36], 'en')).toBe('C2 · B♭2 · B2');
    expect(formatPitchLabel([55, 48, 52, 48], 'sv', 'auto')).toBe('C3 · E3 · G3');
    expect(formatPitchLabel([], 'sv', 'auto')).toBe('');
  });
});
