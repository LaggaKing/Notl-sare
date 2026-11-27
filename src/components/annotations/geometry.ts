import type {
  AnnotationItem,
  NormalizedPoint,
  ShapeAnnotation,
  ShapeType,
  StampAnnotation,
  StampType,
  StrokeAnnotation,
  StrokePoint,
  TextAnnotation,
} from '../../types';
import type { AnnotationTool, StrokeSizePreset } from './i18n';
import { getStampDefinition } from './stamps';

export const DEFAULT_PAGE_ASPECT = 1.41421356;

export const HIGHLIGHTER_COLOR_PRESETS = [
  { id: 'amber', color: '#f7c948' },
  { id: 'sky', color: '#38bdf8' },
  { id: 'rose', color: '#fb7185' },
  { id: 'mint', color: '#4ade80' },
] as const;

export const HIGHLIGHTER_WIDTH_PRESETS: Record<StrokeSizePreset, number> = {
  s: 0.014,
  m: 0.024,
  l: 0.038,
};

export const PEN_COLOR_PRESETS = [
  { id: 'graphite', color: '#3f3f46' },
  { id: 'charcoal', color: '#141416' },
  { id: 'red', color: '#d64545' },
  { id: 'blue', color: '#2563eb' },
  { id: 'green', color: '#16a34a' },
] as const;

export const PEN_WIDTH_PRESETS: Record<StrokeSizePreset, number> = {
  s: 0.0022,
  m: 0.0038,
  l: 0.0064,
};

export const STAMP_COLOR_PRESETS = [
  { id: 'charcoal', color: '#141416' },
  { id: 'red', color: '#d64545' },
  { id: 'blue', color: '#2563eb' },
  { id: 'green', color: '#16a34a' },
  { id: 'amber', color: '#c98617' },
] as const;

export const STAMP_SCALE_PRESETS: Record<StrokeSizePreset, number> = {
  s: 0.78,
  m: 1.0,
  l: 1.4,
};

export const TEXT_SIZE_PRESETS: Record<StrokeSizePreset, number> = {
  s: 0.017,
  m: 0.023,
  l: 0.031,
};

export interface AnnotationToolState {
  tool: AnnotationTool;
  highlighterColor: string;
  highlighterSize: StrokeSizePreset;
  penColor: string;
  penSize: StrokeSizePreset;
  shapeType: ShapeType;
  shapeColor: string;
  shapeSize: StrokeSizePreset;
  stampType: StampType;
  stampColor: string;
  stampSize: StrokeSizePreset;
  textColor: string;
  textSize: StrokeSizePreset;
}

export function createDefaultAnnotationToolState(): AnnotationToolState {
  return {
    tool: 'highlighter',
    highlighterColor: HIGHLIGHTER_COLOR_PRESETS[0].color,
    highlighterSize: 'm',
    penColor: PEN_COLOR_PRESETS[2].color,
    penSize: 'm',
    shapeType: 'slur',
    shapeColor: PEN_COLOR_PRESETS[2].color,
    shapeSize: 'm',
    stampType: 'breath',
    stampColor: STAMP_COLOR_PRESETS[1].color,
    stampSize: 'm',
    textColor: PEN_COLOR_PRESETS[1].color,
    textSize: 'm',
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createAnnotationId(prefix = 'ann'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Decimates near-duplicate touch points and applies gentle 3-tap smoothing
 * to eliminate finger jitter while preserving exact start and end points.
 */
export function smoothStrokePoints(
  points: StrokePoint[],
  minDistance = 0.0025
): StrokePoint[] {
  if (points.length === 0) return [];
  if (points.length <= 2) return points.map((pt) => ({ ...pt }));

  const decimated: StrokePoint[] = [{ ...points[0] }];
  let lastKept = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i];
    const dx = pt.x - lastKept.x;
    const dy = pt.y - lastKept.y;
    if (Math.hypot(dx, dy) >= minDistance) {
      decimated.push({ ...pt });
      lastKept = pt;
    }
  }
  decimated.push({ ...points[points.length - 1] });

  if (decimated.length <= 2) {
    return decimated;
  }

  const smoothed: StrokePoint[] = [{ ...decimated[0] }];
  for (let i = 1; i < decimated.length - 1; i++) {
    const prev = decimated[i - 1];
    const curr = decimated[i];
    const next = decimated[i + 1];
    smoothed.push({
      x: prev.x * 0.2 + curr.x * 0.6 + next.x * 0.2,
      y: prev.y * 0.2 + curr.y * 0.6 + next.y * 0.2,
      ...(curr.p !== undefined ? { p: curr.p } : {}),
    });
  }
  smoothed.push({ ...decimated[decimated.length - 1] });
  return smoothed;
}

/**
 * Converts normalized StrokePoint[] (0..1) into a smooth quadratic Bezier SVG path
 * scaled into the provided coordinate space (default 1000 x 1414.21).
 */
export function svgPathForPoints(
  points: StrokePoint[],
  widthScale = 1000,
  heightScale = 1000 * DEFAULT_PAGE_ASPECT
): string {
  if (points.length === 0) return '';
  const fmt = (n: number) => n.toFixed(2);
  const px = (p: NormalizedPoint) => p.x * widthScale;
  const py = (p: NormalizedPoint) => p.y * heightScale;

  const p0 = points[0];
  if (points.length === 1) {
    const x = fmt(px(p0));
    const y = fmt(py(p0));
    return `M ${x} ${y} L ${x} ${y}`;
  }
  if (points.length === 2) {
    const p1 = points[1];
    return `M ${fmt(px(p0))} ${fmt(py(p0))} L ${fmt(px(p1))} ${fmt(py(p1))}`;
  }

  const parts: string[] = [`M ${fmt(px(p0))} ${fmt(py(p0))}`];
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = ((curr.x + next.x) * 0.5) * widthScale;
    const midY = ((curr.y + next.y) * 0.5) * heightScale;
    parts.push(`Q ${fmt(px(curr))} ${fmt(py(curr))} ${fmt(midX)} ${fmt(midY)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${fmt(px(last))} ${fmt(py(last))}`);
  return parts.join(' ');
}

/**
 * Converts normalized StrokePoint[] into an exact cubic Bezier SVG path matching
 * svgPathForPoints() midpoint quadratic interpolation. Used for pdf-lib export
 * because pdf-lib's Q operator maps to PDF's `v` operator instead of true degree-2 Beziers.
 */
export function cubicSvgPathForPoints(
  points: StrokePoint[],
  widthScale: number,
  heightScale: number
): string {
  if (points.length === 0) return '';
  const fmt = (n: number) => n.toFixed(2);
  const px = (p: NormalizedPoint) => p.x * widthScale;
  const py = (p: NormalizedPoint) => p.y * heightScale;

  if (points.length === 1) {
    const x = fmt(px(points[0]));
    const y = fmt(py(points[0]));
    return `M ${x} ${y} L ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${fmt(px(points[0]))} ${fmt(py(points[0]))} L ${fmt(px(points[1]))} ${fmt(py(points[1]))}`;
  }

  let curX = px(points[0]);
  let curY = py(points[0]);
  const parts: string[] = [`M ${fmt(curX)} ${fmt(curY)}`];

  for (let i = 1; i < points.length - 1; i++) {
    const qx = px(points[i]);
    const qy = py(points[i]);
    const endX = ((points[i].x + points[i + 1].x) * 0.5) * widthScale;
    const endY = ((points[i].y + points[i + 1].y) * 0.5) * heightScale;

    const cp1x = curX + (2 / 3) * (qx - curX);
    const cp1y = curY + (2 / 3) * (qy - curY);
    const cp2x = endX + (2 / 3) * (qx - endX);
    const cp2y = endY + (2 / 3) * (qy - endY);

    parts.push(
      `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(endX)} ${fmt(endY)}`
    );
    curX = endX;
    curY = endY;
  }

  const last = points[points.length - 1];
  parts.push(`L ${fmt(px(last))} ${fmt(py(last))}`);
  return parts.join(' ');
}

export function computeDefaultSlurControl(
  start: NormalizedPoint,
  end: NormalizedPoint,
  pageAspect = DEFAULT_PAGE_ASPECT
): NormalizedPoint {
  const dx = end.x - start.x;
  const dy = (end.y - start.y) * pageAspect;
  const len = Math.hypot(dx, dy);
  const midX = (start.x + end.x) * 0.5;
  const midY = (start.y + end.y) * 0.5;
  if (len < 1e-5) {
    return { x: midX, y: midY - 0.03 };
  }
  const perpX = dy / len;
  const perpY = -dx / len;
  const bow = Math.min(0.11, Math.max(0.022, len * 0.24));
  return {
    x: midX + perpX * bow,
    y: midY + (perpY * bow) / pageAspect,
  };
}

export function computeBracketPoints(
  start: NormalizedPoint,
  end: NormalizedPoint
): [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] {
  const topY = Math.min(start.y, end.y);
  const bottomY = Math.max(start.y, end.y);
  const dir = end.x >= start.x ? 1 : -1;
  const tickLen = Math.max(0.014, Math.min(Math.abs(end.x - start.x), 0.035));
  const spineX = start.x;
  const armX = clamp01(spineX + dir * tickLen);
  return [
    { x: armX, y: topY },
    { x: spineX, y: topY },
    { x: spineX, y: bottomY },
    { x: armX, y: bottomY },
  ];
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-12) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const projX = ax + t * abx;
  const projY = ay + t * aby;
  return Math.hypot(px - projX, py - projY);
}

function hitTestPolyline(
  point: NormalizedPoint,
  pts: NormalizedPoint[],
  tolerance: number,
  pageAspect: number
): boolean {
  if (pts.length === 0) return false;
  const px = point.x;
  const py = point.y * pageAspect;
  if (pts.length === 1) {
    return Math.hypot(px - pts[0].x, py - pts[0].y * pageAspect) <= tolerance;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDistance(
      px,
      py,
      pts[i].x,
      pts[i].y * pageAspect,
      pts[i + 1].x,
      pts[i + 1].y * pageAspect
    );
    if (d <= tolerance) return true;
  }
  return false;
}

export function estimateTextMetrics(
  item: TextAnnotation,
  pageAspect = DEFAULT_PAGE_ASPECT
): { width: number; height: number; lines: string[]; lineHeightNormY: number } {
  const lines = (item.text || '').split(/\r?\n/);
  const maxChars = Math.max(1, ...lines.map((l) => l.length));
  const width = Math.max(0.05, maxChars * item.fontSize * 0.56 + item.fontSize * 0.7);
  const lineHeightNormY = (item.fontSize * 1.25) / pageAspect;
  const height = Math.max(lineHeightNormY, lines.length * lineHeightNormY + (item.fontSize * 0.4) / pageAspect);
  return { width, height, lines, lineHeightNormY };
}

/**
 * Hit-tests any AnnotationItem at normalized coordinates (0..1) with aspect-corrected
 * touch tolerance (default 0.025 of page width).
 */
export function hitTestItem(
  item: AnnotationItem,
  point: NormalizedPoint,
  tolerance = 0.025,
  pageAspect = DEFAULT_PAGE_ASPECT
): boolean {
  switch (item.kind) {
    case 'stroke': {
      const effTol = Math.max(tolerance, item.width * 0.6);
      return hitTestPolyline(point, item.points, effTol, pageAspect);
    }
    case 'shape': {
      const effTol = Math.max(tolerance, item.width * 0.65);
      if (item.shapeType === 'line') {
        return hitTestPolyline(point, [item.start, item.end], effTol, pageAspect);
      }
      if (item.shapeType === 'bracket') {
        return hitTestPolyline(
          point,
          computeBracketPoints(item.start, item.end),
          effTol,
          pageAspect
        );
      }
      if (item.shapeType === 'circle') {
        const r = Math.hypot(
          item.end.x - item.start.x,
          (item.end.y - item.start.y) * pageAspect
        );
        const d = Math.hypot(
          point.x - item.start.x,
          (point.y - item.start.y) * pageAspect
        );
        return Math.abs(d - r) <= effTol || (r <= effTol * 1.4 && d <= r + effTol);
      }
      if (item.shapeType === 'oval') {
        const cx = (item.start.x + item.end.x) * 0.5;
        const cy = (item.start.y + item.end.y) * 0.5;
        const rx = Math.abs(item.end.x - item.start.x) * 0.5;
        const ry = Math.abs(item.end.y - item.start.y) * 0.5 * pageAspect;
        const dx = point.x - cx;
        const dy = (point.y - cy) * pageAspect;
        if (rx < 1e-4 || ry < 1e-4) {
          return Math.hypot(dx, dy) <= effTol;
        }
        const normR = Math.hypot(dx / rx, dy / ry);
        const approxEdgeDist = Math.abs(normR - 1) * Math.min(rx, ry);
        return approxEdgeDist <= effTol || (Math.min(rx, ry) <= effTol * 1.4 && normR <= 1.2);
      }
      // slur (quadratic Bezier)
      const ctrl = item.control ?? computeDefaultSlurControl(item.start, item.end, pageAspect);
      const samples: NormalizedPoint[] = [];
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const omt = 1 - t;
        samples.push({
          x: omt * omt * item.start.x + 2 * omt * t * ctrl.x + t * t * item.end.x,
          y: omt * omt * item.start.y + 2 * omt * t * ctrl.y + t * t * item.end.y,
        });
      }
      return hitTestPolyline(point, samples, effTol, pageAspect);
    }
    case 'stamp': {
      const def = getStampDefinition(item.stampType);
      const halfW = def.baseWidthRatio * item.scale * 0.5;
      const halfH = halfW * (def.height / def.width);
      const pad = Math.max(tolerance * 0.55, 0.012);
      let dx = point.x - item.position.x;
      let dy = (point.y - item.position.y) * pageAspect;
      if (item.rotation) {
        const rad = (-item.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        dx = rx;
        dy = ry;
      }
      return Math.abs(dx) <= halfW + pad && Math.abs(dy) <= halfH + pad;
    }
    case 'text': {
      const { width, height } = estimateTextMetrics(item, pageAspect);
      const padX = tolerance * 0.5;
      const padY = (tolerance * 0.5) / pageAspect;
      return (
        point.x >= item.position.x - padX &&
        point.x <= item.position.x + width + padX &&
        point.y >= item.position.y - padY &&
        point.y <= item.position.y + height + padY
      );
    }
  }
}

export interface NormalizedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeItemBounds(
  item: AnnotationItem,
  pageAspect = DEFAULT_PAGE_ASPECT
): NormalizedBounds {
  switch (item.kind) {
    case 'stroke': {
      if (item.points.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      }
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      for (const pt of item.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      const padX = Math.max(0.01, item.width * 0.6);
      const padY = padX / pageAspect;
      return {
        minX: minX - padX,
        minY: minY - padY,
        maxX: maxX + padX,
        maxY: maxY + padY,
      };
    }
    case 'shape': {
      if (item.shapeType === 'circle') {
        const rX = Math.hypot(
          item.end.x - item.start.x,
          (item.end.y - item.start.y) * pageAspect
        );
        const rY = rX / pageAspect;
        return {
          minX: item.start.x - rX - 0.008,
          minY: item.start.y - rY - 0.008 / pageAspect,
          maxX: item.start.x + rX + 0.008,
          maxY: item.start.y + rY + 0.008 / pageAspect,
        };
      }
      const pts: NormalizedPoint[] =
        item.shapeType === 'bracket'
          ? computeBracketPoints(item.start, item.end)
          : item.shapeType === 'slur'
            ? [
                item.start,
                item.control ?? computeDefaultSlurControl(item.start, item.end, pageAspect),
                item.end,
              ]
            : [item.start, item.end];
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      for (const pt of pts) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      return {
        minX: minX - 0.008,
        minY: minY - 0.008 / pageAspect,
        maxX: maxX + 0.008,
        maxY: maxY + 0.008 / pageAspect,
      };
    }
    case 'stamp': {
      const def = getStampDefinition(item.stampType);
      const halfW = def.baseWidthRatio * item.scale * 0.5;
      const halfH = (halfW * (def.height / def.width)) / pageAspect;
      const padX = 0.006;
      const padY = padX / pageAspect;
      return {
        minX: item.position.x - halfW - padX,
        minY: item.position.y - halfH - padY,
        maxX: item.position.x + halfW + padX,
        maxY: item.position.y + halfH + padY,
      };
    }
    case 'text': {
      const { width, height } = estimateTextMetrics(item, pageAspect);
      return {
        minX: item.position.x - 0.005,
        minY: item.position.y - 0.005 / pageAspect,
        maxX: item.position.x + width + 0.005,
        maxY: item.position.y + height + 0.005 / pageAspect,
      };
    }
  }
}

export function translateAnnotationItem(
  item: AnnotationItem,
  dx: number,
  dy: number
): AnnotationItem {
  switch (item.kind) {
    case 'stroke': {
      const moved: StrokeAnnotation = {
        ...item,
        points: item.points.map((pt) => ({
          ...pt,
          x: clamp01(pt.x + dx),
          y: clamp01(pt.y + dy),
        })),
      };
      return moved;
    }
    case 'shape': {
      const moved: ShapeAnnotation = {
        ...item,
        start: { x: clamp01(item.start.x + dx), y: clamp01(item.start.y + dy) },
        end: { x: clamp01(item.end.x + dx), y: clamp01(item.end.y + dy) },
        ...(item.control
          ? {
              control: {
                x: clamp01(item.control.x + dx),
                y: clamp01(item.control.y + dy),
              },
            }
          : {}),
      };
      return moved;
    }
    case 'stamp': {
      const moved: StampAnnotation = {
        ...item,
        position: {
          x: clamp01(item.position.x + dx),
          y: clamp01(item.position.y + dy),
        },
      };
      return moved;
    }
    case 'text': {
      const moved: TextAnnotation = {
        ...item,
        position: {
          x: clamp01(item.position.x + dx),
          y: clamp01(item.position.y + dy),
        },
      };
      return moved;
    }
  }
}
