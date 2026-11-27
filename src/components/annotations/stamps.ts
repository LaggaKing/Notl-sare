import type { StampType } from '../../types';

export type StampCategory =
  | 'breath_diction'
  | 'intonation_accidentals'
  | 'dynamics'
  | 'articulation'
  | 'navigation_alerts';

export type StampPrimitive =
  | {
      kind: 'path';
      d: string;
      fill?: 'currentColor' | 'none';
      stroke?: 'currentColor' | 'none';
      strokeWidth?: number;
      strokeLinecap?: 'round' | 'butt' | 'square';
      strokeLinejoin?: 'round' | 'miter' | 'bevel';
      fillRule?: 'nonzero' | 'evenodd';
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: 'currentColor' | 'none';
      stroke?: 'currentColor' | 'none';
      strokeWidth?: number;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fontWeight?: 'normal' | 'bold';
      fontStyle?: 'normal' | 'italic';
      fontFamily?: 'serif' | 'sans';
      textAnchor?: 'middle' | 'start' | 'end';
    };

export interface StampDefinition {
  type: StampType;
  category: StampCategory;
  viewBox: string;
  width: number;
  height: number;
  /** Rendered width as a fraction of uncropped page width when stamp scale === 1. */
  baseWidthRatio: number;
  primitives: StampPrimitive[];
}

export const STAMP_CATEGORIES: readonly StampCategory[] = [
  'breath_diction',
  'intonation_accidentals',
  'dynamics',
  'articulation',
  'navigation_alerts',
] as const;

const STANDARD_VIEWBOX = '-20 -20 40 40';
const WIDE_VIEWBOX = '-28 -16 56 32';
const HAIRPIN_VIEWBOX = '-28 -14 56 28';

function dynamicTextStamp(
  type: StampType,
  text: string,
  opts: {
    wide?: boolean;
    fontSize?: number;
    baselineY?: number;
    baseWidthRatio?: number;
    fontStyle?: 'italic' | 'normal';
  } = {}
): StampDefinition {
  const wide = opts.wide ?? text.length >= 3;
  const fontSize = opts.fontSize ?? (text.length >= 4 ? 17 : text.length === 3 ? 21 : 24);
  const baselineY = opts.baselineY ?? (opts.fontStyle === 'normal' ? 6 : 5);
  return {
    type,
    category: 'dynamics',
    viewBox: wide ? WIDE_VIEWBOX : STANDARD_VIEWBOX,
    width: wide ? 56 : 40,
    height: wide ? 32 : 40,
    baseWidthRatio: opts.baseWidthRatio ?? (wide ? 0.062 : 0.044),
    primitives: [
      {
        kind: 'text',
        x: 0,
        y: baselineY,
        text,
        fontSize,
        fontWeight: 'bold',
        fontStyle: opts.fontStyle ?? 'italic',
        fontFamily: 'serif',
        textAnchor: 'middle',
      },
    ],
  };
}

export const STAMP_DEFINITIONS: Record<StampType, StampDefinition> = {
  // === Breath & Diction ===
  breath: {
    type: 'breath',
    category: 'breath_diction',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.036,
    primitives: [
      {
        kind: 'path',
        d: 'M 1 -11 C 5 -11, 8 -7, 7 -2 C 6 5, 0 10, -6 13 C -2 8, 1 3, 1 -1 C -3 -1, -6 -3, -6 -6 C -6 -9, -3 -11, 1 -11 Z',
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },
  no_breath: {
    type: 'no_breath',
    category: 'breath_diction',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.042,
    primitives: [
      {
        kind: 'path',
        d: 'M 1 -10 C 5 -10, 7 -7, 6 -2 C 5 4, 0 9, -5 12 C -2 7, 1 3, 1 -1 C -3 -1, -5 -3, -5 -6 C -5 -9, -2 -10, 1 -10 Z',
        fill: 'currentColor',
        stroke: 'none',
      },
      {
        kind: 'path',
        d: 'M -12 12 L 12 -12',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
      },
    ],
  },
  caesura: {
    type: 'caesura',
    category: 'breath_diction',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.042,
    primitives: [
      {
        kind: 'path',
        d: 'M -9 12 L -2 -12 M 2 12 L 9 -12',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.4,
        strokeLinecap: 'round',
      },
    ],
  },
  fermata: {
    type: 'fermata',
    category: 'breath_diction',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.052,
    primitives: [
      {
        kind: 'path',
        d: 'M -15 6 C -12 -11, 12 -11, 15 6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
      },
      {
        kind: 'circle',
        cx: 0,
        cy: 4,
        r: 3.2,
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },
  cutoff: {
    type: 'cutoff',
    category: 'breath_diction',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.036,
    primitives: [
      {
        kind: 'path',
        d: 'M 0 -14 L 0 14',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.8,
        strokeLinecap: 'round',
      },
    ],
  },

  // === Intonation & Accidentals ===
  pitch_up: {
    type: 'pitch_up',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.038,
    primitives: [
      {
        kind: 'path',
        d: 'M 0 13 L 0 -11 M -8 -3 L 0 -12 L 8 -3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  pitch_down: {
    type: 'pitch_down',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.038,
    primitives: [
      {
        kind: 'path',
        d: 'M 0 -13 L 0 11 M -8 3 L 0 12 L 8 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  sharp: {
    type: 'sharp',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.038,
    primitives: [
      {
        kind: 'path',
        d: 'M -4.5 -14 L -4.5 14 M 4.5 -14 L 4.5 14',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.3,
        strokeLinecap: 'round',
      },
      {
        kind: 'path',
        d: 'M -10 -3 L 10 -7 M -10 7 L 10 3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.6,
        strokeLinecap: 'round',
      },
    ],
  },
  flat: {
    type: 'flat',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.038,
    primitives: [
      {
        kind: 'path',
        d: 'M -5 -15 L -5 13 C 2 11, 9 7, 9 2 C 9 -2, 3 -4, -5 2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  natural: {
    type: 'natural',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.038,
    primitives: [
      {
        kind: 'path',
        d: 'M -4.5 -15 L -4.5 6 M 4.5 -6 L 4.5 15',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.3,
        strokeLinecap: 'round',
      },
      {
        kind: 'path',
        d: 'M -4.5 -4 L 4.5 -6.5 M -4.5 6.5 L 4.5 4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.5,
        strokeLinecap: 'round',
      },
    ],
  },
  half_step: {
    type: 'half_step',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.04,
    primitives: [
      {
        kind: 'path',
        d: 'M -12 7 L 0 -8 L 12 7',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  whole_step: {
    type: 'whole_step',
    category: 'intonation_accidentals',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.04,
    primitives: [
      {
        kind: 'path',
        d: 'M -11 -6 L -11 7 L 11 7 L 11 -6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },

  // === Dynamics ===
  ppp: dynamicTextStamp('ppp', 'ppp', { wide: true, fontSize: 21 }),
  pp: dynamicTextStamp('pp', 'pp', { wide: false, fontSize: 22 }),
  p: dynamicTextStamp('p', 'p', { wide: false, fontSize: 25 }),
  mp: dynamicTextStamp('mp', 'mp', { wide: true, fontSize: 22, baseWidthRatio: 0.054 }),
  mf: dynamicTextStamp('mf', 'mf', { wide: true, fontSize: 22, baseWidthRatio: 0.054 }),
  f: dynamicTextStamp('f', 'f', { wide: false, fontSize: 25, baselineY: 6 }),
  ff: dynamicTextStamp('ff', 'ff', { wide: false, fontSize: 23, baselineY: 6 }),
  fff: dynamicTextStamp('fff', 'fff', { wide: true, fontSize: 21, baselineY: 6 }),
  sfz: dynamicTextStamp('sfz', 'sfz', { wide: true, fontSize: 22 }),
  fp: dynamicTextStamp('fp', 'fp', { wide: false, fontSize: 22 }),
  cresc_text: dynamicTextStamp('cresc_text', 'cresc.', {
    wide: true,
    fontSize: 17,
    baselineY: 5,
    baseWidthRatio: 0.072,
  }),
  dim_text: dynamicTextStamp('dim_text', 'dim.', {
    wide: true,
    fontSize: 18,
    baselineY: 5,
    baseWidthRatio: 0.064,
  }),
  cresc_hairpin: {
    type: 'cresc_hairpin',
    category: 'dynamics',
    viewBox: HAIRPIN_VIEWBOX,
    width: 56,
    height: 28,
    baseWidthRatio: 0.078,
    primitives: [
      {
        kind: 'path',
        d: 'M 22 -9 L -22 0 L 22 9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  dim_hairpin: {
    type: 'dim_hairpin',
    category: 'dynamics',
    viewBox: HAIRPIN_VIEWBOX,
    width: 56,
    height: 28,
    baseWidthRatio: 0.078,
    primitives: [
      {
        kind: 'path',
        d: 'M -22 -9 L 22 0 L -22 9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },

  // === Articulation ===
  accent: {
    type: 'accent',
    category: 'articulation',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.04,
    primitives: [
      {
        kind: 'path',
        d: 'M -11 -7 L 11 0 L -11 7',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  staccato: {
    type: 'staccato',
    category: 'articulation',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.032,
    primitives: [
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: 4.5,
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },
  tenuto: {
    type: 'tenuto',
    category: 'articulation',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.04,
    primitives: [
      {
        kind: 'path',
        d: 'M -12 0 L 12 0',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 3.5,
        strokeLinecap: 'round',
      },
    ],
  },
  marcato: {
    type: 'marcato',
    category: 'articulation',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.036,
    primitives: [
      {
        kind: 'path',
        d: 'M -7 10 L 0 -11 L 7 10 L 3 10 L 0 -1 L -3 10 Z',
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },

  // === Navigation & Choir Alerts ===
  segno: {
    type: 'segno',
    category: 'navigation_alerts',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.048,
    primitives: [
      {
        kind: 'path',
        d: 'M 7 -9 C 7 -13, -6 -13, -6 -6 C -6 0, 7 0, 7 7 C 7 13, -7 13, -7 9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
      },
      {
        kind: 'path',
        d: 'M -12 12 L 12 -12',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.2,
        strokeLinecap: 'round',
      },
      {
        kind: 'circle',
        cx: -9.5,
        cy: -2,
        r: 2.4,
        fill: 'currentColor',
        stroke: 'none',
      },
      {
        kind: 'circle',
        cx: 9.5,
        cy: 2,
        r: 2.4,
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },
  coda: {
    type: 'coda',
    category: 'navigation_alerts',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.048,
    primitives: [
      {
        kind: 'circle',
        cx: 0,
        cy: 0,
        r: 9.5,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.6,
      },
      {
        kind: 'path',
        d: 'M 0 -15 L 0 15 M -15 0 L 15 0',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.2,
        strokeLinecap: 'round',
      },
    ],
  },
  dc: {
    type: 'dc',
    category: 'navigation_alerts',
    viewBox: WIDE_VIEWBOX,
    width: 56,
    height: 32,
    baseWidthRatio: 0.068,
    primitives: [
      {
        kind: 'text',
        x: 0,
        y: 6,
        text: 'D.C.',
        fontSize: 19,
        fontWeight: 'bold',
        fontStyle: 'normal',
        fontFamily: 'serif',
        textAnchor: 'middle',
      },
    ],
  },
  ds: {
    type: 'ds',
    category: 'navigation_alerts',
    viewBox: WIDE_VIEWBOX,
    width: 56,
    height: 32,
    baseWidthRatio: 0.068,
    primitives: [
      {
        kind: 'text',
        x: 0,
        y: 6,
        text: 'D.S.',
        fontSize: 19,
        fontWeight: 'bold',
        fontStyle: 'normal',
        fontFamily: 'serif',
        textAnchor: 'middle',
      },
    ],
  },
  fine: {
    type: 'fine',
    category: 'navigation_alerts',
    viewBox: WIDE_VIEWBOX,
    width: 56,
    height: 32,
    baseWidthRatio: 0.068,
    primitives: [
      {
        kind: 'text',
        x: 0,
        y: 6,
        text: 'Fine',
        fontSize: 19,
        fontWeight: 'bold',
        fontStyle: 'italic',
        fontFamily: 'serif',
        textAnchor: 'middle',
      },
    ],
  },
  repeat_start: {
    type: 'repeat_start',
    category: 'navigation_alerts',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.048,
    primitives: [
      {
        kind: 'path',
        d: 'M -10 -13 L -10 13',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 4.2,
        strokeLinecap: 'butt',
      },
      {
        kind: 'path',
        d: 'M -3 -13 L -3 13',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.0,
        strokeLinecap: 'butt',
      },
      {
        kind: 'circle',
        cx: 5,
        cy: -5,
        r: 2.5,
        fill: 'currentColor',
        stroke: 'none',
      },
      {
        kind: 'circle',
        cx: 5,
        cy: 5,
        r: 2.5,
        fill: 'currentColor',
        stroke: 'none',
      },
    ],
  },
  repeat_end: {
    type: 'repeat_end',
    category: 'navigation_alerts',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.048,
    primitives: [
      {
        kind: 'circle',
        cx: -5,
        cy: -5,
        r: 2.5,
        fill: 'currentColor',
        stroke: 'none',
      },
      {
        kind: 'circle',
        cx: -5,
        cy: 5,
        r: 2.5,
        fill: 'currentColor',
        stroke: 'none',
      },
      {
        kind: 'path',
        d: 'M 3 -13 L 3 13',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.0,
        strokeLinecap: 'butt',
      },
      {
        kind: 'path',
        d: 'M 10 -13 L 10 13',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 4.2,
        strokeLinecap: 'butt',
      },
    ],
  },
  turn_page: {
    type: 'turn_page',
    category: 'navigation_alerts',
    viewBox: STANDARD_VIEWBOX,
    width: 40,
    height: 40,
    baseWidthRatio: 0.054,
    primitives: [
      {
        kind: 'path',
        d: 'M -13 -12 L 1 -12 L 7 -6 L 7 12 L -13 12 Z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      {
        kind: 'path',
        d: 'M -4 4 C 1 -2, 7 -2, 14 1 M 9 -5 L 15 1 L 8 6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    ],
  },
  watch_conductor: {
    type: 'watch_conductor',
    category: 'navigation_alerts',
    viewBox: HAIRPIN_VIEWBOX,
    width: 56,
    height: 28,
    baseWidthRatio: 0.072,
    primitives: [
      {
        kind: 'circle',
        cx: -10,
        cy: 3,
        r: 7.5,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.6,
      },
      {
        kind: 'circle',
        cx: 10,
        cy: 3,
        r: 7.5,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.6,
      },
      {
        kind: 'path',
        d: 'M -2.5 2 C -1 -2, 1 -2, 2.5 2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.6,
        strokeLinecap: 'round',
      },
      {
        kind: 'path',
        d: 'M -17.5 1 L -21 -8 C -21.5 -10, -19 -11, -17 -9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
      },
      {
        kind: 'path',
        d: 'M 17.5 1 L 21 -8 C 21.5 -10, 19 -11, 17 -9',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
      },
    ],
  },
};

export const STAMP_LIST: StampDefinition[] = Object.values(STAMP_DEFINITIONS);

export function getStampDefinition(stampType: StampType): StampDefinition {
  return STAMP_DEFINITIONS[stampType] ?? STAMP_DEFINITIONS.breath;
}

export function getStampsByCategory(category: StampCategory | 'all'): StampDefinition[] {
  if (category === 'all') {
    return STAMP_LIST;
  }
  return STAMP_LIST.filter((def) => def.category === category);
}

/**
 * Converts a circle primitive into a closed 4-segment cubic Bezier SVG path
 * so both SVG renderers and pdf-lib drawSvgPath can transform it uniformly
 * around the stamp center (0, 0) including arbitrary rotation.
 */
export function circlePrimitiveToPath(cx: number, cy: number, r: number): string {
  const k = 0.55228475 * r;
  const f = (n: number) => n.toFixed(3);
  return [
    `M ${f(cx + r)} ${f(cy)}`,
    `C ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)}`,
    `C ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}`,
    `C ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}`,
    `C ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)}`,
    'Z',
  ].join(' ');
}
