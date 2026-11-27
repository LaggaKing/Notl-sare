import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AppLanguage, NoteNaming } from '../types';
import { en } from './en';
import { sv, type TranslationDict } from './sv';

export type { TranslationDict } from './sv';
export { sv, en };

const DICTIONARIES: Record<AppLanguage, TranslationDict> = {
  sv,
  en,
};

const SV_NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B', 'H'] as const;
const EN_NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] as const;

/** Return the translation dictionary for a given language. */
export function getTranslations(language: AppLanguage): TranslationDict {
  return DICTIONARIES[language] ?? sv;
}

/** Replace `{key}` placeholders in a localized string. */
export function formatMessage(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in params ? String(params[key]) : match;
  });
}

/** Resolve `'auto'` note naming to `'sv'` or `'en'` based on UI language. */
export function resolveNoteNaming(
  language: AppLanguage,
  noteNaming: NoteNaming,
): 'sv' | 'en' {
  if (noteNaming === 'sv' || noteNaming === 'en') {
    return noteNaming;
  }
  return language === 'en' ? 'en' : 'sv';
}

/** Format a single MIDI note number using Swedish (H/B) or English (B/B♭) naming. */
export function formatSingleMidiNote(
  midi: number,
  language: AppLanguage,
  noteNaming: NoteNaming = 'auto',
): string {
  if (!Number.isFinite(midi)) {
    return '';
  }
  const rounded = Math.round(midi);
  const effective = resolveNoteNaming(language, noteNaming);
  const table = effective === 'sv' ? SV_NOTE_NAMES : EN_NOTE_NAMES;
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${table[pitchClass]}${octave}`;
}

/** Format one or more MIDI notes as a readable starting-pitch or chord badge label. */
export function formatPitchLabel(
  midiNotes: number[],
  language: AppLanguage,
  noteNaming: NoteNaming = 'auto',
): string {
  if (!Array.isArray(midiNotes) || midiNotes.length === 0) {
    return '';
  }
  const uniqueSorted = Array.from(
    new Set(midiNotes.filter((n) => Number.isFinite(n)).map((n) => Math.round(n))),
  ).sort((a, b) => a - b);

  if (uniqueSorted.length === 0) {
    return '';
  }

  return uniqueSorted
    .map((midi) => formatSingleMidiNote(midi, language, noteNaming))
    .join(' · ');
}

export interface I18nContextValue {
  language: AppLanguage;
  t: TranslationDict;
  setLanguage: (lang: AppLanguage) => void;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'sv',
  t: sv,
  setLanguage: () => {},
});

export interface I18nProviderProps {
  language: AppLanguage;
  onChangeLanguage?: (language: AppLanguage) => void;
  children: ReactNode;
}

export function I18nProvider({
  language,
  onChangeLanguage,
  children,
}: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: getTranslations(language),
      setLanguage: (nextLang) => {
        onChangeLanguage?.(nextLang);
      },
    }),
    [language, onChangeLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
