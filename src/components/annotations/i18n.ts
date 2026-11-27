import type { AppLanguage, ShapeType, StampType } from '../../types';
import type { StampCategory } from './stamps';

export type AnnotationTool =
  | 'select'
  | 'highlighter'
  | 'pen'
  | 'eraser'
  | 'shape'
  | 'stamp'
  | 'text';

export type StrokeSizePreset = 's' | 'm' | 'l';

export interface AnnotationTranslations {
  tools: Record<AnnotationTool, string>;
  shapes: Record<ShapeType, string>;
  sizes: Record<StrokeSizePreset, string>;
  highlighterColors: {
    amber: string;
    sky: string;
    rose: string;
    mint: string;
  };
  penColors: {
    graphite: string;
    charcoal: string;
    red: string;
    blue: string;
    green: string;
  };
  stampColors: {
    charcoal: string;
    red: string;
    blue: string;
    green: string;
    amber: string;
  };
  actions: {
    undo: string;
    redo: string;
    showAll: string;
    hideAll: string;
    layers: string;
    stamps: string;
    chooseStamp: string;
    exportPdf: string;
    exportingPdf: string;
    done: string;
    dockTop: string;
    dockBottom: string;
    collapseToolbar: string;
    expandToolbar: string;
    close: string;
    deleteItem: string;
    resizeStamp: string;
    editText: string;
    clearPage: string;
    confirmClearPage: string;
    save: string;
    cancel: string;
  };
  layers: {
    title: string;
    defaultName: string;
    addLayer: string;
    newLayerPrefix: string;
    showLayer: string;
    hideLayer: string;
    deleteLayer: string;
    renameLayer: string;
    activeBadge: string;
  };
  textEditor: {
    placeholder: string;
    title: string;
  };
  hints: {
    select: string;
    eraser: string;
    stamp: string;
    text: string;
  };
  stampCategories: Record<'all' | StampCategory, string>;
  stamps: Record<StampType, string>;
}

const SV_TRANSLATIONS: AnnotationTranslations = {
  tools: {
    select: 'Välj',
    highlighter: 'Stämmarkering',
    pen: 'Penna',
    eraser: 'Suddgummi',
    shape: 'Former',
    stamp: 'Stämplar',
    text: 'Text',
  },
  shapes: {
    line: 'Linje',
    bracket: 'Klammer',
    circle: 'Cirkel',
    oval: 'Oval',
    slur: 'Båge',
  },
  sizes: {
    s: 'S',
    m: 'M',
    l: 'L',
  },
  highlighterColors: {
    amber: 'Guld (Stämma)',
    sky: 'Himmelsblå',
    rose: 'Rosa',
    mint: 'Mintgrön',
  },
  penColors: {
    graphite: 'Blyerts',
    charcoal: 'Kolsvart',
    red: 'Röd',
    blue: 'Blå',
    green: 'Grön',
  },
  stampColors: {
    charcoal: 'Kolsvart',
    red: 'Röd',
    blue: 'Blå',
    green: 'Grön',
    amber: 'Bärnsten',
  },
  actions: {
    undo: 'Ångra',
    redo: 'Gör om',
    showAll: 'Visa anteckningar',
    hideAll: 'Dölj anteckningar',
    layers: 'Lager',
    stamps: 'Stämplar',
    chooseStamp: 'Välj stämpel',
    exportPdf: 'Exportera PDF',
    exportingPdf: 'Exporterar...',
    done: 'Klar',
    dockTop: 'Fäst uppe',
    dockBottom: 'Fäst nere',
    collapseToolbar: 'Minimera verktygsrad',
    expandToolbar: 'Visa verktygsrad',
    close: 'Stäng',
    deleteItem: 'Ta bort',
    resizeStamp: 'Ändra storlek',
    editText: 'Redigera text',
    clearPage: 'Rensa sida',
    confirmClearPage: 'Bekräfta rensning',
    save: 'Spara',
    cancel: 'Avbryt',
  },
  layers: {
    title: 'Lager',
    defaultName: 'Anteckningar',
    addLayer: '+ Nytt lager',
    newLayerPrefix: 'Lager',
    showLayer: 'Visa lager',
    hideLayer: 'Dölj lager',
    deleteLayer: 'Ta bort lager',
    renameLayer: 'Byt namn på lager',
    activeBadge: 'Aktiv',
  },
  textEditor: {
    placeholder: 'Skriv anteckning...',
    title: 'Textanteckning',
  },
  hints: {
    select: 'Tryck för att välja, dra för att flytta',
    eraser: 'Tryck eller dra över märken för att sudda',
    stamp: 'Tryck på notbladet för att sätta stämpel',
    text: 'Tryck på notbladet för att skriva text',
  },
  stampCategories: {
    all: 'Alla',
    breath_diction: 'Andning & Diktion',
    intonation_accidentals: 'Intonation & Förtecken',
    dynamics: 'Dynamik',
    articulation: 'Artikulation',
    navigation_alerts: 'Navigation & Körsignaler',
  },
  stamps: {
    breath: 'Andningstecken',
    no_breath: 'Ingen andning',
    caesura: 'Caesura',
    fermata: 'Fermat',
    cutoff: 'Avslut / Konsonant',
    pitch_up: 'Intonera uppåt',
    pitch_down: 'Intonera nedåt',
    sharp: 'Korsförtecken (♯)',
    flat: 'B-förtecken (♭)',
    natural: 'Återställningstecken (♮)',
    half_step: 'Halvtonsteg',
    whole_step: 'Heltonsteg',
    ppp: 'ppp (Pianississimo)',
    pp: 'pp (Pianissimo)',
    p: 'p (Piano)',
    mp: 'mp (Mezzopiano)',
    mf: 'mf (Mezzoforte)',
    f: 'f (Forte)',
    ff: 'ff (Fortissimo)',
    fff: 'fff (Fortississimo)',
    sfz: 'sfz (Sforzando)',
    fp: 'fp (Forte-piano)',
    cresc_text: 'cresc.',
    dim_text: 'dim.',
    cresc_hairpin: 'Crescendo (<)',
    dim_hairpin: 'Diminuendo (>)',
    accent: 'Accent (>)',
    staccato: 'Staccato (.)',
    tenuto: 'Tenuto (—)',
    marcato: 'Marcato (^)',
    segno: 'Segno',
    coda: 'Coda',
    dc: 'D.C. (Da Capo)',
    ds: 'D.S. (Dal Segno)',
    fine: 'Fine (Slut)',
    repeat_start: 'Repris start',
    repeat_end: 'Repris slut',
    turn_page: 'Bläddra',
    watch_conductor: 'Se dirigenten',
  },
};

const EN_TRANSLATIONS: AnnotationTranslations = {
  tools: {
    select: 'Select',
    highlighter: 'Highlighter',
    pen: 'Pen',
    eraser: 'Eraser',
    shape: 'Shapes',
    stamp: 'Stamps',
    text: 'Text',
  },
  shapes: {
    line: 'Line',
    bracket: 'Bracket',
    circle: 'Circle',
    oval: 'Oval',
    slur: 'Slur',
  },
  sizes: {
    s: 'S',
    m: 'M',
    l: 'L',
  },
  highlighterColors: {
    amber: 'Amber (Voice)',
    sky: 'Sky Blue',
    rose: 'Rose',
    mint: 'Mint',
  },
  penColors: {
    graphite: 'Graphite',
    charcoal: 'Charcoal',
    red: 'Red',
    blue: 'Blue',
    green: 'Green',
  },
  stampColors: {
    charcoal: 'Charcoal',
    red: 'Red',
    blue: 'Blue',
    green: 'Green',
    amber: 'Amber',
  },
  actions: {
    undo: 'Undo',
    redo: 'Redo',
    showAll: 'Show annotations',
    hideAll: 'Hide annotations',
    layers: 'Layers',
    stamps: 'Stamps',
    chooseStamp: 'Choose stamp',
    exportPdf: 'Export PDF',
    exportingPdf: 'Exporting...',
    done: 'Done',
    dockTop: 'Dock top',
    dockBottom: 'Dock bottom',
    collapseToolbar: 'Collapse toolbar',
    expandToolbar: 'Expand toolbar',
    close: 'Close',
    deleteItem: 'Delete',
    resizeStamp: 'Resize',
    editText: 'Edit text',
    clearPage: 'Clear page',
    confirmClearPage: 'Confirm clear',
    save: 'Save',
    cancel: 'Cancel',
  },
  layers: {
    title: 'Layers',
    defaultName: 'Annotations',
    addLayer: '+ Add layer',
    newLayerPrefix: 'Layer',
    showLayer: 'Show layer',
    hideLayer: 'Hide layer',
    deleteLayer: 'Delete layer',
    renameLayer: 'Rename layer',
    activeBadge: 'Active',
  },
  textEditor: {
    placeholder: 'Type note...',
    title: 'Text note',
  },
  hints: {
    select: 'Tap to select, drag to move',
    eraser: 'Tap or drag across marks to erase',
    stamp: 'Tap the score to place stamp',
    text: 'Tap the score to add text',
  },
  stampCategories: {
    all: 'All',
    breath_diction: 'Breath & Diction',
    intonation_accidentals: 'Intonation & Accidentals',
    dynamics: 'Dynamics',
    articulation: 'Articulation',
    navigation_alerts: 'Navigation & Alerts',
  },
  stamps: {
    breath: 'Breath mark',
    no_breath: 'No breath',
    caesura: 'Caesura',
    fermata: 'Fermata',
    cutoff: 'Cutoff / Consonant',
    pitch_up: 'Pitch up',
    pitch_down: 'Pitch down',
    sharp: 'Sharp (♯)',
    flat: 'Flat (♭)',
    natural: 'Natural (♮)',
    half_step: 'Half step',
    whole_step: 'Whole step',
    ppp: 'ppp (Pianississimo)',
    pp: 'pp (Pianissimo)',
    p: 'p (Piano)',
    mp: 'mp (Mezzopiano)',
    mf: 'mf (Mezzoforte)',
    f: 'f (Forte)',
    ff: 'ff (Fortissimo)',
    fff: 'fff (Fortississimo)',
    sfz: 'sfz (Sforzando)',
    fp: 'fp (Forte-piano)',
    cresc_text: 'cresc.',
    dim_text: 'dim.',
    cresc_hairpin: 'Crescendo (<)',
    dim_hairpin: 'Diminuendo (>)',
    accent: 'Accent (>)',
    staccato: 'Staccato (.)',
    tenuto: 'Tenuto (—)',
    marcato: 'Marcato (^)',
    segno: 'Segno',
    coda: 'Coda',
    dc: 'D.C. (Da Capo)',
    ds: 'D.S. (Dal Segno)',
    fine: 'Fine',
    repeat_start: 'Repeat start',
    repeat_end: 'Repeat end',
    turn_page: 'Turn page',
    watch_conductor: 'Watch conductor',
  },
};

export const ANNOTATION_I18N: Record<AppLanguage, AnnotationTranslations> = {
  sv: SV_TRANSLATIONS,
  en: EN_TRANSLATIONS,
};

export function getAnnotationTranslations(language: AppLanguage): AnnotationTranslations {
  return ANNOTATION_I18N[language] ?? SV_TRANSLATIONS;
}
