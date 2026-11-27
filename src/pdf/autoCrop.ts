import type { NormalizedRect } from '../types';

export const FULL_PAGE_RECT: NormalizedRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

/**
 * Clamp a normalized crop rectangle inside [0..1] while preserving minimum dimensions.
 */
export function clampNormalizedRect(
  rect: NormalizedRect,
  minSize = 0.1,
): NormalizedRect {
  const safeMin = Math.max(0.02, Math.min(1, minSize));
  const width = Math.max(safeMin, Math.min(1, Number.isFinite(rect.width) ? rect.width : 1));
  const height = Math.max(safeMin, Math.min(1, Number.isFinite(rect.height) ? rect.height : 1));
  const rawX = Number.isFinite(rect.x) ? rect.x : 0;
  const rawY = Number.isFinite(rect.y) ? rect.y : 0;
  const x = Math.max(0, Math.min(1 - width, rawX));
  const y = Math.max(0, Math.min(1 - height, rawY));

  return { x, y, width, height };
}

/**
 * Detect non-white sheet music content bounds from an RGBA pixel buffer.
 * Ignores ~1% outer photocopy borders and isolated scan specks, returning
 * normalized [0..1] coordinates with comfortable padding (~2%),
 * or the full-page rect { x: 0, y: 0, width: 1, height: 1 } on blank pages.
 */
export function detectContentBounds(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 242,
  padding = 0.02,
): NormalizedRect {
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    rgbaData.length < width * height * 4
  ) {
    return { ...FULL_PAGE_RECT };
  }

  // Ignore ~1% outer border on normal-sized scans to reject dark photocopy edges
  const marginX = width >= 40 ? Math.max(1, Math.floor(width * 0.01)) : 0;
  const marginY = height >= 40 ? Math.max(1, Math.floor(height * 0.01)) : 0;
  const startX = marginX;
  const endX = width - marginX;
  const startY = marginY;
  const endY = height - marginY;

  if (endX <= startX || endY <= startY) {
    return { ...FULL_PAGE_RECT };
  }

  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  const darkMask = new Uint8Array(width * height);

  for (let y = startY; y < endY; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = startX; x < endX; x += 1) {
      const idx = rowOffset + x * 4;
      const a = rgbaData[idx + 3];
      if (a < 16) {
        continue;
      }

      const r = rgbaData[idx];
      const g = rgbaData[idx + 1];
      const b = rgbaData[idx + 2];

      let lum: number;
      if (a === 255) {
        lum = 0.299 * r + 0.587 * g + 0.114 * b;
      } else {
        const alpha = a / 255;
        const invAlpha = 1 - alpha;
        const rEff = r * alpha + 255 * invAlpha;
        const gEff = g * alpha + 255 * invAlpha;
        const bEff = b * alpha + 255 * invAlpha;
        lum = 0.299 * rEff + 0.587 * gEff + 0.114 * bEff;
      }

      if (lum < threshold) {
        darkMask[y * width + x] = 1;
        rowCounts[y] += 1;
        colCounts[x] += 1;
      }
    }
  }

  // Require a minimum number of ink pixels per row/column to reject isolated 1px scan specks
  const minInk = width >= 200 && height >= 200 ? 3 : 2;

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = startY; y < endY; y += 1) {
    if (rowCounts[y] < minInk) continue;
    const rowBase = y * width;
    for (let x = startX; x < endX; x += 1) {
      if (colCounts[x] < minInk) continue;
      if (darkMask[rowBase + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { ...FULL_PAGE_RECT };
  }

  const safePad = Math.max(0, Math.min(0.25, padding));
  const rawX = minX / width;
  const rawY = minY / height;
  const rawRight = (maxX + 1) / width;
  const rawBottom = (maxY + 1) / height;

  const left = Math.max(0, rawX - safePad);
  const top = Math.max(0, rawY - safePad);
  const right = Math.min(1, rawRight + safePad);
  const bottom = Math.min(1, rawBottom + safePad);

  return clampNormalizedRect(
    {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    },
    0.05,
  );
}
