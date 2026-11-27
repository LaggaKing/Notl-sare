import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import {
  clampNormalizedRect,
  detectContentBounds,
  FULL_PAGE_RECT,
  loadPdfDocument,
  LruCache,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  PdfScoreDocument,
  quantizeRenderPixelWidth,
} from './index';

function createRgbaBuffer(
  width: number,
  height: number,
  fill: [number, number, number, number] = [255, 255, 255, 255],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    buf[idx] = fill[0];
    buf[idx + 1] = fill[1];
    buf[idx + 2] = fill[2];
    buf[idx + 3] = fill[3];
  }
  return buf;
}

function paintRect(
  buf: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const off = (y * width + x) * 4;
      buf[off] = rgba[0];
      buf[off + 1] = rgba[1];
      buf[off + 2] = rgba[2];
      buf[off + 3] = rgba[3];
    }
  }
}

describe('autoCrop bounding-box detection and hardening', () => {
  it('returns full page bounds on blank white, transparent, or invalid RGBA buffers', () => {
    expect(detectContentBounds(createRgbaBuffer(100, 100, [255, 255, 255, 255]), 100, 100)).toEqual(
      FULL_PAGE_RECT,
    );
    expect(detectContentBounds(createRgbaBuffer(80, 120, [248, 248, 248, 255]), 80, 120)).toEqual(
      FULL_PAGE_RECT,
    );
    expect(detectContentBounds(createRgbaBuffer(100, 100, [0, 0, 0, 0]), 100, 100)).toEqual(
      FULL_PAGE_RECT,
    );
    expect(detectContentBounds(new Uint8ClampedArray(10), 10, 10)).toEqual(FULL_PAGE_RECT);
    expect(detectContentBounds(new Uint8ClampedArray(0), 0, 0)).toEqual(FULL_PAGE_RECT);
    expect(detectContentBounds(new Uint8ClampedArray(400), -10, 10)).toEqual(FULL_PAGE_RECT);
  });

  it('crops white margins cleanly around dark music notation with ~2% padding', () => {
    const width = 100;
    const height = 100;
    const buf = createRgbaBuffer(width, height, [255, 255, 255, 255]);

    paintRect(buf, width, 20, 15, 79, 84, [15, 15, 15, 255]);

    const bounds = detectContentBounds(buf, width, height);
    expect(bounds.x).toBeCloseTo(0.18, 2);
    expect(bounds.y).toBeCloseTo(0.13, 2);
    expect(bounds.width).toBeCloseTo(0.64, 2);
    expect(bounds.height).toBeCloseTo(0.74, 2);
  });

  it('detects asymmetric music bounds and applies ~2% padding while cropping wide margins', () => {
    const width = 200;
    const height = 300;
    const buf = createRgbaBuffer(width, height, [255, 255, 255, 255]);

    paintRect(buf, width, 40, 60, 159, 239, [20, 20, 20, 255]);

    const bounds = detectContentBounds(buf, width, height);
    expect(bounds.x).toBeCloseTo(0.18, 3);
    expect(bounds.y).toBeCloseTo(0.18, 3);
    expect(bounds.width).toBeCloseTo(0.64, 3);
    expect(bounds.height).toBeCloseTo(0.64, 3);
  });

  it('handles semi-transparent dark ink via alpha compositing and ignores off-white paper tint', () => {
    const width = 100;
    const height = 100;
    const buf = createRgbaBuffer(width, height, [250, 248, 242, 255]);
    paintRect(buf, width, 2, 2, 2, 2, [0, 0, 0, 10]);
    paintRect(buf, width, 30, 40, 69, 59, [0, 0, 0, 128]);

    const bounds = detectContentBounds(buf, width, height);
    expect(bounds.x).toBeCloseTo(0.28, 3);
    expect(bounds.y).toBeCloseTo(0.38, 3);
    expect(bounds.width).toBeCloseTo(0.44, 3);
    expect(bounds.height).toBeCloseTo(0.24, 3);
  });

  it('ignores single-pixel scan specks and thin dark outer photocopy borders', () => {
    const width = 200;
    const height = 300;
    const buf = createRgbaBuffer(width, height, [255, 255, 255, 255]);

    // Thin 2px outer dark photocopy border on left and top edges (~1% border)
    paintRect(buf, width, 0, 0, 1, 299, [10, 10, 10, 255]);
    paintRect(buf, width, 0, 0, 199, 2, [10, 10, 10, 255]);

    // Stray 1px scan specks in wide margins
    paintRect(buf, width, 15, 15, 15, 15, [0, 0, 0, 255]);
    paintRect(buf, width, 185, 280, 185, 280, [0, 0, 0, 255]);

    // Real notation block at x=[50..149] (0.25..0.75), y=[75..224] (0.25..0.75)
    paintRect(buf, width, 50, 75, 149, 224, [15, 15, 15, 255]);

    const bounds = detectContentBounds(buf, width, height);
    expect(bounds.x).toBeCloseTo(0.23, 2);
    expect(bounds.y).toBeCloseTo(0.23, 2);
    expect(bounds.width).toBeCloseTo(0.54, 2);
    expect(bounds.height).toBeCloseTo(0.54, 2);
  });

  it('clamps padding cleanly when content reaches page edges and enforces minSize for tiny marks', () => {
    const width = 100;
    const height = 100;
    const edgeBuf = createRgbaBuffer(width, height, [255, 255, 255, 255]);
    paintRect(edgeBuf, width, 0, 0, 99, 99, [10, 10, 10, 255]);

    const edgeBounds = detectContentBounds(edgeBuf, width, height);
    expect(edgeBounds).toEqual(FULL_PAGE_RECT);

    const tinyBuf = createRgbaBuffer(width, height, [255, 255, 255, 255]);
    paintRect(tinyBuf, width, 50, 50, 50, 50, [0, 0, 0, 255]);
    const tinyBounds = detectContentBounds(tinyBuf, width, height, 242, 0);
    expect(tinyBounds.width).toBeGreaterThanOrEqual(0.05);
    expect(tinyBounds.height).toBeGreaterThanOrEqual(0.05);
    expect(tinyBounds.x + tinyBounds.width).toBeLessThanOrEqual(1);
    expect(tinyBounds.y + tinyBounds.height).toBeLessThanOrEqual(1);
  });

  it('clamps arbitrary rectangles cleanly in clampNormalizedRect', () => {
    const clamped = clampNormalizedRect({ x: -0.2, y: 0.95, width: 0.5, height: 0.2 }, 0.1);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBeCloseTo(0.8, 5);
    expect(clamped.width).toBe(0.5);
    expect(clamped.height).toBe(0.2);
  });
});

describe('pdfEngine cache, pinning, cleanup, and AbortSignal', () => {
  it('evicts least-recently-used unpinned items from LruCache and updates recency on get()', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(
      3,
      (k) => evicted.push(k),
      (k) => k !== 'p2',
    );

    cache.set('p1', 1);
    cache.set('p2', 2);
    cache.set('p3', 3);

    // Touch p1 so p2 would normally be LRU, but p2 is pinned -> p3 is evicted instead
    expect(cache.get('p1')).toBe(1);

    cache.set('p4', 4);
    expect(evicted).toEqual(['p3']);
    expect(cache.has('p2')).toBe(true);
    expect(cache.has('p3')).toBe(false);
    expect(cache.has('p1')).toBe(true);
    expect(cache.has('p4')).toBe(true);
  });

  it('quantizes pixel widths cleanly into bounded buckets', () => {
    expect(quantizeRenderPixelWidth(300)).toBe(480);
    expect(quantizeRenderPixelWidth(950)).toBe(960);
    expect(quantizeRenderPixelWidth(5000)).toBe(2400);
  });

  it('calls page.cleanup(), caps oversized canvases, and preserves pinned page canvases in PdfScoreDocument', async () => {
    const cleanupMock = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(Math.max(1, this.width) * Math.max(1, this.height) * 4).fill(255),
        })),
      } as unknown as CanvasRenderingContext2D;
    });

    const makeFakePage = (width: number, height: number): PDFPageProxy =>
      ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: width * scale,
          height: height * scale,
        }),
        render: () => ({
          promise: Promise.resolve(),
          cancel: vi.fn(),
        }),
        cleanup: cleanupMock,
      }) as unknown as PDFPageProxy;

    const fakeProxy = {
      numPages: 4,
      getPage: vi.fn(async (p: number) =>
        p === 1 ? makeFakePage(500, 15000) : makeFakePage(595, 842),
      ),
      destroy: vi.fn(async () => {}),
    } as unknown as PDFDocumentProxy;

    const doc = new PdfScoreDocument(fakeProxy, 2);

    // Page dimensions call cleanup()
    await doc.getPageDimensions(2);
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    // Page 1 has extreme aspect ratio -> canvas height capped <= 4096 and pixels <= 8_000_000
    doc.setPinnedPages([1]);
    const p1 = await doc.renderPage(1, 2400);
    expect(p1.pixelWidth).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(p1.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(p1.pixelWidth * p1.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(p1.canvas.width).toBeGreaterThan(0);

    // Render pages 2 and 3 to exceed cacheCapacity=2 -> pinned page 1 canvas must NOT be zeroed
    await doc.renderPage(2, 960);
    await doc.renderPage(3, 960);
    expect(p1.canvas.width).toBeGreaterThan(0);
    expect(p1.canvas.height).toBeGreaterThan(0);

    await doc.destroy();
    expect(p1.canvas.width).toBe(0);
    vi.restoreAllMocks();
  });

  it('rejects immediately when loadPdfDocument receives an already-aborted AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadPdfDocument(new Uint8Array([1, 2, 3]), 10, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
