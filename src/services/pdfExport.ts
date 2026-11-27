import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
  type RGB,
} from 'pdf-lib';
import type {
  AnnotationItem,
  NormalizedPoint,
  PageAnnotations,
  ShapeAnnotation,
  StampAnnotation,
  StrokeAnnotation,
  TextAnnotation,
} from '../types';
import {
  computeBracketPoints,
  computeDefaultSlurControl,
  cubicSvgPathForPoints,
} from '../components/annotations/geometry';
import {
  circlePrimitiveToPath,
  getStampDefinition,
} from '../components/annotations/stamps';

export const MAX_PDF_BYTES = 200 * 1024 * 1024;

export class EncryptedPdfError extends Error {
  readonly code = 'ENCRYPTED_PDF';

  constructor(message = 'Encrypted PDF cannot be exported with embedded annotations') {
    super(message);
    this.name = 'EncryptedPdfError';
  }
}

interface ParsedColor {
  rgb: RGB;
  alpha?: number;
}

function parseColor(colorStr: string | undefined, fallbackHex = '#141416'): ParsedColor {
  const input = (colorStr ?? fallbackHex).trim();

  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16) / 255;
      const g = parseInt(hex[1] + hex[1], 16) / 255;
      const b = parseInt(hex[2] + hex[2], 16) / 255;
      if (!Number.isNaN(r + g + b)) return { rgb: rgb(r, g, b) };
    } else if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const alpha =
        hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : undefined;
      if (!Number.isNaN(r + g + b)) {
        return {
          rgb: rgb(r, g, b),
          ...(alpha !== undefined && !Number.isNaN(alpha) ? { alpha } : {}),
        };
      }
    }
  }

  const rgbaMatch = input.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbaMatch[1]))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbaMatch[2]))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbaMatch[3]))) / 255;
    const a = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : undefined;
    return {
      rgb: rgb(r, g, b),
      ...(a !== undefined && Number.isFinite(a) ? { alpha: a } : {}),
    };
  }

  return { rgb: rgb(0.08, 0.08, 0.09) };
}

const UNICODE_WINANSI_REPLACEMENTS: Record<string, string> = {
  '♯': '#',
  '♭': 'b',
  '♮': 'nat.',
  '↑': '^',
  '↓': 'v',
  '→': '->',
  '←': '<-',
  '✓': 'v',
  '✔': 'v',
  '✕': 'x',
  '✖': 'x',
};

function sanitizeForPdfFont(text: string, font: PDFFont): string {
  let out = '';
  for (const rawCh of Array.from(text)) {
    const ch = UNICODE_WINANSI_REPLACEMENTS[rawCh] ?? rawCh;
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function mapLineCap(cap?: 'round' | 'butt' | 'square'): LineCapStyle {
  if (cap === 'butt') return LineCapStyle.Butt;
  if (cap === 'square') return LineCapStyle.Projecting;
  return LineCapStyle.Round;
}

function mapLineJoin(join?: 'round' | 'miter' | 'bevel'): LineJoinStyle {
  if (join === 'miter') return LineJoinStyle.Miter;
  if (join === 'bevel') return LineJoinStyle.Bevel;
  return LineJoinStyle.Round;
}

export type PageRotationAngle = 0 | 90 | 180 | 270;

export interface PageMetrics {
  originX: number;
  originY: number;
  rawW: number;
  rawH: number;
  pageW: number;
  pageH: number;
  pageAspect: number;
  rotation: PageRotationAngle;
}

export function normalizeRotationAngle(angle: number): PageRotationAngle {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

export function getPageMetrics(page: PDFPage): PageMetrics {
  const size = page.getSize();
  const cropBox = page.getCropBox();
  const rawW = cropBox.width > 0 ? cropBox.width : size.width;
  const rawH = cropBox.height > 0 ? cropBox.height : size.height;
  const originX = cropBox.width > 0 ? cropBox.x : 0;
  const originY = cropBox.height > 0 ? cropBox.y : 0;
  const rotation = normalizeRotationAngle(page.getRotation().angle);
  const swapped = rotation === 90 || rotation === 270;
  const pageW = swapped ? rawH : rawW;
  const pageH = swapped ? rawW : rawH;
  return {
    originX,
    originY,
    rawW,
    rawH,
    pageW,
    pageH,
    pageAspect: pageW > 0 ? pageH / pageW : 1.4142,
    rotation,
  };
}

/**
 * Maps a normalized visual page point `(0..1, 0..1)` (top-left origin) into
 * raw unrotated PDF user-space coordinates accounting for CropBox and `/Rotate`.
 */
export function mapVisualNormToPdfPoint(
  norm: NormalizedPoint,
  metrics: PageMetrics,
): { x: number; y: number } {
  switch (metrics.rotation) {
    case 90:
      return {
        x: metrics.originX + norm.y * metrics.rawW,
        y: metrics.originY + norm.x * metrics.rawH,
      };
    case 180:
      return {
        x: metrics.originX + (1 - norm.x) * metrics.rawW,
        y: metrics.originY + norm.y * metrics.rawH,
      };
    case 270:
      return {
        x: metrics.originX + (1 - norm.y) * metrics.rawW,
        y: metrics.originY + (1 - norm.x) * metrics.rawH,
      };
    case 0:
    default:
      return {
        x: metrics.originX + norm.x * metrics.rawW,
        y: metrics.originY + (1 - norm.y) * metrics.rawH,
      };
  }
}

function getVisualToRawMatrix(
  metrics: PageMetrics,
): [number, number, number, number, number, number] {
  const { originX: bx, originY: by, rawW, rawH, rotation } = metrics;
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, bx + rawW, by];
    case 180:
      return [-1, 0, 0, -1, bx + rawW, by + rawH];
    case 270:
      return [0, -1, 1, 0, bx, by + rawH];
    case 0:
    default:
      return [1, 0, 0, 1, bx, by];
  }
}

interface LocalVisualMetrics {
  originX: 0;
  originY: 0;
  pageW: number;
  pageH: number;
  pageAspect: number;
}

function toVisualPdfPoint(
  norm: NormalizedPoint,
  metrics: LocalVisualMetrics,
): { x: number; y: number } {
  return {
    x: norm.x * metrics.pageW,
    y: (1 - norm.y) * metrics.pageH,
  };
}

function drawStrokeOnPage(
  page: PDFPage,
  stroke: StrokeAnnotation,
  metrics: LocalVisualMetrics
): void {
  if (stroke.points.length === 0) return;
  const pathD = cubicSvgPathForPoints(stroke.points, metrics.pageW, metrics.pageH);
  if (!pathD) return;

  const { rgb: strokeColor } = parseColor(stroke.color);
  const strokeWidthPt = Math.max(0.5, stroke.width * metrics.pageW);
  const isMultiply = stroke.tool === 'highlighter' || Boolean(stroke.multiply);
  const opacity = Math.max(0, Math.min(1, stroke.opacity ?? 1));

  page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
  page.drawSvgPath(pathD, {
    x: 0,
    y: metrics.pageH,
    scale: 1,
    borderColor: strokeColor,
    borderWidth: strokeWidthPt,
    borderOpacity: opacity,
    borderLineCap: LineCapStyle.Round,
    blendMode: isMultiply ? BlendMode.Multiply : BlendMode.Normal,
  });
  page.pushOperators(popGraphicsState());
}

function drawShapeOnPage(
  page: PDFPage,
  shape: ShapeAnnotation,
  metrics: LocalVisualMetrics
): void {
  const { rgb: strokeColor } = parseColor(shape.color);
  const lineWidthPt = Math.max(0.5, shape.width * metrics.pageW);

  switch (shape.shapeType) {
    case 'line': {
      page.drawLine({
        start: toVisualPdfPoint(shape.start, metrics),
        end: toVisualPdfPoint(shape.end, metrics),
        thickness: lineWidthPt,
        color: strokeColor,
        lineCap: LineCapStyle.Round,
      });
      break;
    }
    case 'bracket': {
      const pts = computeBracketPoints(shape.start, shape.end);
      const pathD = pts
        .map(
          (p, idx) =>
            `${idx === 0 ? 'M' : 'L'} ${(p.x * metrics.pageW).toFixed(2)} ${(p.y * metrics.pageH).toFixed(2)}`
        )
        .join(' ');
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      page.drawSvgPath(pathD, {
        x: 0,
        y: metrics.pageH,
        scale: 1,
        borderColor: strokeColor,
        borderWidth: lineWidthPt,
        borderLineCap: LineCapStyle.Round,
      });
      page.pushOperators(popGraphicsState());
      break;
    }
    case 'circle': {
      const center = toVisualPdfPoint(shape.start, metrics);
      const radiusPt = Math.hypot(
        (shape.end.x - shape.start.x) * metrics.pageW,
        (shape.end.y - shape.start.y) * metrics.pageH
      );
      if (radiusPt < 0.25) break;
      page.drawCircle({
        x: center.x,
        y: center.y,
        size: radiusPt,
        borderColor: strokeColor,
        borderWidth: lineWidthPt,
      });
      break;
    }
    case 'oval': {
      const centerNorm: NormalizedPoint = {
        x: (shape.start.x + shape.end.x) * 0.5,
        y: (shape.start.y + shape.end.y) * 0.5,
      };
      const center = toVisualPdfPoint(centerNorm, metrics);
      const rx = Math.abs(shape.end.x - shape.start.x) * 0.5 * metrics.pageW;
      const ry = Math.abs(shape.end.y - shape.start.y) * 0.5 * metrics.pageH;
      if (rx < 0.25 || ry < 0.25) break;
      page.drawEllipse({
        x: center.x,
        y: center.y,
        xScale: rx,
        yScale: ry,
        borderColor: strokeColor,
        borderWidth: lineWidthPt,
      });
      break;
    }
    case 'slur': {
      const ctrl =
        shape.control ??
        computeDefaultSlurControl(shape.start, shape.end, metrics.pageAspect);
      const sx = shape.start.x * metrics.pageW;
      const sy = shape.start.y * metrics.pageH;
      const qx = ctrl.x * metrics.pageW;
      const qy = ctrl.y * metrics.pageH;
      const ex = shape.end.x * metrics.pageW;
      const ey = shape.end.y * metrics.pageH;

      // Exact quadratic -> cubic Bezier conversion
      const cp1x = sx + (2 / 3) * (qx - sx);
      const cp1y = sy + (2 / 3) * (qy - sy);
      const cp2x = ex + (2 / 3) * (qx - ex);
      const cp2y = ey + (2 / 3) * (qy - ey);

      const pathD = `M ${sx.toFixed(2)} ${sy.toFixed(2)} C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
      page.drawSvgPath(pathD, {
        x: 0,
        y: metrics.pageH,
        scale: 1,
        borderColor: strokeColor,
        borderWidth: lineWidthPt,
        borderLineCap: LineCapStyle.Round,
      });
      break;
    }
  }
}

interface ExportFonts {
  helveticaBold: PDFFont;
  timesBold: PDFFont;
  timesBoldItalic: PDFFont;
}

function drawStampOnPage(
  page: PDFPage,
  stamp: StampAnnotation,
  metrics: LocalVisualMetrics,
  fonts: ExportFonts
): void {
  const def = getStampDefinition(stamp.stampType);
  const renderedWidthPt = metrics.pageW * def.baseWidthRatio * stamp.scale;
  const svgScale = renderedWidthPt / def.width;
  const center = toVisualPdfPoint(stamp.position, metrics);
  const rotation = stamp.rotation ?? 0;
  const { rgb: stampColor } = parseColor(stamp.color);

  for (const prim of def.primitives) {
    if (prim.kind === 'path' || prim.kind === 'circle') {
      const pathD =
        prim.kind === 'circle'
          ? circlePrimitiveToPath(prim.cx, prim.cy, prim.r)
          : prim.d;
      const hasFill = prim.fill === 'currentColor';
      const hasStroke = prim.stroke === 'currentColor';
      if (!hasFill && !hasStroke) continue;

      if (hasStroke) {
        page.pushOperators(
          pushGraphicsState(),
          setLineJoin(
            prim.kind === 'path' ? mapLineJoin(prim.strokeLinejoin) : LineJoinStyle.Round
          )
        );
      }
      page.drawSvgPath(pathD, {
        x: center.x,
        y: center.y,
        scale: svgScale,
        rotate: degrees(-rotation),
        color: hasFill ? stampColor : undefined,
        borderColor: hasStroke ? stampColor : undefined,
        borderWidth: hasStroke ? (prim.strokeWidth ?? 2.2) : 0,
        borderLineCap:
          prim.kind === 'path' ? mapLineCap(prim.strokeLinecap) : LineCapStyle.Round,
      });
      if (hasStroke) {
        page.pushOperators(popGraphicsState());
      }
    } else if (prim.kind === 'text') {
      const font =
        prim.fontFamily === 'serif'
          ? prim.fontStyle === 'italic'
            ? fonts.timesBoldItalic
            : fonts.timesBold
          : fonts.helveticaBold;
      const fontSizePt = prim.fontSize * svgScale;
      const safeText = sanitizeForPdfFont(prim.text, font);
      const textWidthPt = font.widthOfTextAtSize(safeText, fontSizePt);
      const anchor = prim.textAnchor ?? 'middle';
      const localX =
        anchor === 'end'
          ? prim.x * svgScale - textWidthPt
          : anchor === 'start'
            ? prim.x * svgScale
            : prim.x * svgScale - textWidthPt * 0.5;
      const localYUp = -prim.y * svgScale;

      let offsetX = localX;
      let offsetY = localYUp;
      if (rotation !== 0) {
        const rad = (-rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        offsetX = localX * cos - localYUp * sin;
        offsetY = localX * sin + localYUp * cos;
      }

      page.drawText(safeText, {
        x: center.x + offsetX,
        y: center.y + offsetY,
        size: fontSizePt,
        font,
        color: stampColor,
        rotate: degrees(-rotation),
      });
    }
  }
}

function drawTextAnnotationOnPage(
  page: PDFPage,
  item: TextAnnotation,
  metrics: LocalVisualMetrics,
  fonts: ExportFonts
): void {
  if (!item.text) return;
  const font = fonts.helveticaBold;
  const fontSizePt = Math.max(4, item.fontSize * metrics.pageW);
  const lineHeightPt = fontSizePt * 1.25;
  const xPt = item.position.x * metrics.pageW;
  const yTopPt = (1 - item.position.y) * metrics.pageH;
  const { rgb: textColor } = parseColor(item.color);

  const rawLines = item.text.split(/\r?\n/);
  const lines = rawLines.map((line) => sanitizeForPdfFont(line, font));

  if (item.bgColor) {
    const { rgb: bgRgb, alpha: bgAlpha } = parseColor(item.bgColor, '#fcfbf7');
    const maxLineWidth = Math.max(
      fontSizePt * 1.5,
      ...lines.map((line) => (line ? font.widthOfTextAtSize(line, fontSizePt) : 0))
    );
    const padX = fontSizePt * 0.25;
    const totalHeight = lines.length * lineHeightPt + fontSizePt * 0.4;
    page.drawRectangle({
      x: xPt - padX,
      y: yTopPt - totalHeight,
      width: maxLineWidth + padX * 2,
      height: totalHeight,
      color: bgRgb,
      opacity: bgAlpha !== undefined ? Math.min(bgAlpha, 0.92) : 0.9,
      borderColor: textColor,
      borderWidth: 0.75,
      borderOpacity: 0.22,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    page.drawText(line, {
      x: xPt,
      y: yTopPt - fontSizePt * 0.92 - i * lineHeightPt,
      size: fontSizePt,
      font,
      color: textColor,
    });
  }
}

/**
 * Exports a PDF with all visible-layer vocal/choir annotations baked cleanly
 * as crisp vector graphics and multiply-blended highlights.
 * Respects page `/CropBox` and `/Rotate` (0, 90, 180, 270) and rejects encrypted PDFs.
 */
export async function exportAnnotatedPdf(
  originalPdfBytes: Uint8Array,
  pageAnnotations: PageAnnotations[]
): Promise<Uint8Array> {
  if (originalPdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new Error('PDF exceeds maximum allowed size (200 MB)');
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(originalPdfBytes);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'EncryptedPDFError' || /encrypt/i.test(err.message))
    ) {
      throw new EncryptedPdfError();
    }
    throw err;
  }

  if (pdfDoc.isEncrypted) {
    throw new EncryptedPdfError();
  }

  const pages = pdfDoc.getPages();

  const fonts: ExportFonts = {
    helveticaBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    timesBold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    timesBoldItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
  };

  for (const pa of pageAnnotations) {
    const pageIndex = pa.pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const layerMap = new Map(pa.layers.map((l) => [l.id, l]));
    const visibleItems = pa.items.filter((item) => {
      const layer = layerMap.get(item.layerId);
      return layer ? layer.visible : pa.layers.length === 0;
    });

    if (visibleItems.length === 0) continue;

    const page = pages[pageIndex];
    const metrics = getPageMetrics(page);
    const localMetrics: LocalVisualMetrics = {
      originX: 0,
      originY: 0,
      pageW: metrics.pageW,
      pageH: metrics.pageH,
      pageAspect: metrics.pageAspect,
    };
    const [a, b, c, d, e, f] = getVisualToRawMatrix(metrics);

    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(a, b, c, d, e, f),
    );
    try {
      // Draw multiply-blended highlighters underneath foreground pen/stamps/text
      const highlighters: StrokeAnnotation[] = [];
      const foreground: AnnotationItem[] = [];
      for (const item of visibleItems) {
        if (item.kind === 'stroke' && item.tool === 'highlighter') {
          highlighters.push(item);
        } else {
          foreground.push(item);
        }
      }

      for (const hl of highlighters) {
        drawStrokeOnPage(page, hl, localMetrics);
      }

      for (const item of foreground) {
        switch (item.kind) {
          case 'stroke':
            drawStrokeOnPage(page, item, localMetrics);
            break;
          case 'shape':
            drawShapeOnPage(page, item, localMetrics);
            break;
          case 'stamp':
            drawStampOnPage(page, item, localMetrics, fonts);
            break;
          case 'text':
            drawTextAnnotationOnPage(page, item, localMetrics, fonts);
            break;
        }
      }
    } finally {
      page.pushOperators(popGraphicsState());
    }
  }

  return pdfDoc.save();
}
