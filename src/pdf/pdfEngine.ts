import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import type { NormalizedRect } from '../types';
import { detectContentBounds, FULL_PAGE_RECT } from './autoCrop';

// Configure pdf.js worker locally for offline/Tauri WebView2 operation (zero CDN).
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_CANVAS_PIXELS = 8_000_000;

export interface PageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface RenderedPage {
  pageNum: number;
  targetPixelWidth: number;
  canvas: HTMLCanvasElement;
  pixelWidth: number;
  pixelHeight: number;
  pageWidth: number;
  pageHeight: number;
  autoCrop: NormalizedRect;
}

/**
 * Generic bounded Least-Recently-Used cache with optional eviction cleanup and pinning guard.
 */
export class LruCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, V>();
  private readonly onEvict?: (key: K, value: V) => void;
  private readonly canEvict?: (key: K, value: V) => boolean;

  constructor(
    capacity: number,
    onEvict?: (key: K, value: V) => void,
    canEvict?: (key: K, value: V) => boolean,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.onEvict = onEvict;
    this.canEvict = canEvict;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Read without updating recency order. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      const existing = this.map.get(key) as V;
      this.map.delete(key);
      if (existing !== value) {
        this.onEvict?.(key, existing);
      }
    } else if (this.map.size >= this.capacity) {
      for (const [candidateKey, candidateVal] of this.map.entries()) {
        if (!this.canEvict || this.canEvict(candidateKey, candidateVal)) {
          this.map.delete(candidateKey);
          this.onEvict?.(candidateKey, candidateVal);
          break;
        }
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    if (!this.map.has(key)) {
      return false;
    }
    const val = this.map.get(key) as V;
    this.map.delete(key);
    this.onEvict?.(key, val);
    return true;
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  clear(): void {
    if (this.onEvict) {
      for (const [k, v] of this.map.entries()) {
        this.onEvict(k, v);
      }
    }
    this.map.clear();
  }
}

/**
 * Quantize requested physical pixel width into clean cache buckets so tiny
 * layout changes do not invalidate cached PDF renders.
 */
export function quantizeRenderPixelWidth(desiredWidthPx: number): number {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
  const fallback = 900 * dpr;
  const raw = Number.isFinite(desiredWidthPx) && desiredWidthPx > 0 ? desiredWidthPx : fallback;
  const clamped = Math.max(480, Math.min(2400, raw));
  return Math.ceil(clamped / 160) * 160;
}

function releaseCanvasMemory(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function computeAutoCropFromCanvas(canvas: HTMLCanvasElement): NormalizedRect {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { ...FULL_PAGE_RECT };
  }
  const maxSampleDim = 360;
  const scale = Math.min(1, maxSampleDim / Math.max(canvas.width, canvas.height));
  const sampleW = Math.max(1, Math.round(canvas.width * scale));
  const sampleH = Math.max(1, Math.round(canvas.height * scale));

  const scratch = document.createElement('canvas');
  scratch.width = sampleW;
  scratch.height = sampleH;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    releaseCanvasMemory(scratch);
    return { ...FULL_PAGE_RECT };
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sampleW, sampleH);
  ctx.drawImage(canvas, 0, 0, sampleW, sampleH);
  const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
  releaseCanvasMemory(scratch);
  return detectContentBounds(imageData.data, sampleW, sampleH);
}

/**
 * Manages a loaded PDF document, high-DPI rendering, auto-crop detection,
 * and an LRU pre-render cache covering [page - 1, page, page + 1, page + 2].
 */
export class PdfScoreDocument {
  readonly pageCount: number;
  private readonly doc: PDFDocumentProxy;
  private readonly pageDimensionsCache = new Map<number, PageDimensions>();
  private readonly autoCropCache = new Map<number, NormalizedRect>();
  private readonly inFlightRenders = new Map<string, Promise<RenderedPage>>();
  private readonly activeTasks = new Set<RenderTask>();
  private readonly pinnedPages = new Set<number>();
  private readonly pinnedKeys = new Set<string>();
  private readonly renderCache: LruCache<string, RenderedPage>;
  private destroyed = false;

  constructor(doc: PDFDocumentProxy, cacheCapacity = 10) {
    this.doc = doc;
    this.pageCount = doc.numPages;
    this.renderCache = new LruCache<string, RenderedPage>(
      cacheCapacity,
      (_k, entry) => {
        releaseCanvasMemory(entry.canvas);
      },
      (key, entry) =>
        !this.pinnedPages.has(entry.pageNum) && !this.pinnedKeys.has(key),
    );
  }

  private cacheKey(pageNum: number, targetPixelWidth: number): string {
    return `${pageNum}@${targetPixelWidth}`;
  }

  /** Pin a page number so its cached renders are protected from LRU eviction. */
  pinPage(pageNum: number): void {
    this.pinnedPages.add(pageNum);
  }

  /** Unpin a previously pinned page number. */
  unpinPage(pageNum: number): void {
    this.pinnedPages.delete(pageNum);
  }

  /** Replace the active set of pinned page numbers (e.g. currently displayed pages). */
  setPinnedPages(pages: Iterable<number>): void {
    this.pinnedPages.clear();
    for (const p of pages) {
      if (Number.isInteger(p) && p >= 1) {
        this.pinnedPages.add(p);
      }
    }
  }

  /** Pin a specific cache key (`pageNum@targetPixelWidth`). */
  pinKey(pageNum: number, targetPixelWidth: number): void {
    this.pinnedKeys.add(this.cacheKey(pageNum, targetPixelWidth));
  }

  /** Unpin a specific cache key. */
  unpinKey(pageNum: number, targetPixelWidth: number): void {
    this.pinnedKeys.delete(this.cacheKey(pageNum, targetPixelWidth));
  }

  /** Synchronously fetch a cached render for the requested (or closest) width. */
  getCachedPage(pageNum: number, desiredPixelWidth?: number): RenderedPage | null {
    if (this.destroyed || pageNum < 1 || pageNum > this.pageCount) {
      return null;
    }
    if (desiredPixelWidth !== undefined) {
      const bucket = quantizeRenderPixelWidth(desiredPixelWidth);
      const exact = this.renderCache.get(this.cacheKey(pageNum, bucket));
      if (exact) {
        return exact;
      }
    }
    // Fallback to any cached render of the same page so transitions stay instantaneous.
    let best: RenderedPage | null = null;
    for (const entry of this.renderCache.values()) {
      if (entry.pageNum === pageNum) {
        if (!best || entry.targetPixelWidth > best.targetPixelWidth) {
          best = entry;
        }
      }
    }
    return best;
  }

  getCachedAutoCrop(pageNum: number): NormalizedRect | null {
    return this.autoCropCache.get(pageNum) ?? null;
  }

  async getPageDimensions(pageNum: number): Promise<PageDimensions> {
    if (this.destroyed) {
      throw new Error('PDF document has been destroyed');
    }
    const clampedPage = Math.max(1, Math.min(this.pageCount, pageNum));
    const cached = this.pageDimensionsCache.get(clampedPage);
    if (cached) {
      return cached;
    }
    const page = await this.doc.getPage(clampedPage);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const dims: PageDimensions = {
        width: viewport.width,
        height: viewport.height,
        aspectRatio: viewport.height > 0 ? viewport.width / viewport.height : 0.707,
      };
      this.pageDimensionsCache.set(clampedPage, dims);
      return dims;
    } finally {
      page.cleanup();
    }
  }

  async renderPage(
    pageNum: number,
    desiredPixelWidth?: number,
  ): Promise<RenderedPage> {
    if (this.destroyed) {
      throw new Error('PDF document has been destroyed');
    }
    const safePage = Math.max(1, Math.min(this.pageCount, Math.round(pageNum)));
    const bucketWidth = quantizeRenderPixelWidth(desiredPixelWidth ?? 1200);
    const key = this.cacheKey(safePage, bucketWidth);

    const cached = this.renderCache.get(key);
    if (cached && cached.canvas.width > 0 && cached.canvas.height > 0) {
      return cached;
    }

    const existingPromise = this.inFlightRenders.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const renderPromise = this.performRender(safePage, bucketWidth).finally(() => {
      this.inFlightRenders.delete(key);
    });
    this.inFlightRenders.set(key, renderPromise);
    return renderPromise;
  }

  private async performRender(
    pageNum: number,
    bucketWidth: number,
  ): Promise<RenderedPage> {
    const page: PDFPageProxy = await this.doc.getPage(pageNum);
    try {
      if (this.destroyed) {
        throw new Error('PDF document destroyed during page fetch');
      }

      const baseViewport = page.getViewport({ scale: 1 });
      this.pageDimensionsCache.set(pageNum, {
        width: baseViewport.width,
        height: baseViewport.height,
        aspectRatio:
          baseViewport.height > 0 ? baseViewport.width / baseViewport.height : 0.707,
      });

      let scale =
        baseViewport.width > 0 ? bucketWidth / baseViewport.width : 1.5;
      let viewport = page.getViewport({ scale });

      let pixelWidth = Math.max(1, Math.round(viewport.width));
      let pixelHeight = Math.max(1, Math.round(viewport.height));

      if (
        pixelWidth > MAX_CANVAS_DIMENSION ||
        pixelHeight > MAX_CANVAS_DIMENSION ||
        pixelWidth * pixelHeight > MAX_CANVAS_PIXELS
      ) {
        const capFactor = Math.min(
          MAX_CANVAS_DIMENSION / pixelWidth,
          MAX_CANVAS_DIMENSION / pixelHeight,
          Math.sqrt(MAX_CANVAS_PIXELS / (pixelWidth * pixelHeight)),
          1,
        );
        scale *= capFactor;
        viewport = page.getViewport({ scale });
        pixelWidth = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(viewport.width)));
        pixelHeight = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(viewport.height)));
      }

      const canvas = document.createElement('canvas');
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        releaseCanvasMemory(canvas);
        throw new Error('Failed to create 2D canvas context for PDF render');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        background: '#ffffff',
      });
      this.activeTasks.add(renderTask);

      try {
        await renderTask.promise;
      } catch (error) {
        releaseCanvasMemory(canvas);
        throw error;
      } finally {
        this.activeTasks.delete(renderTask);
      }

      if (this.destroyed) {
        releaseCanvasMemory(canvas);
        throw new Error('PDF document destroyed after page render');
      }

      let autoCrop = this.autoCropCache.get(pageNum);
      if (!autoCrop) {
        autoCrop = computeAutoCropFromCanvas(canvas);
        this.autoCropCache.set(pageNum, autoCrop);
      }

      const entry: RenderedPage = {
        pageNum,
        targetPixelWidth: bucketWidth,
        canvas,
        pixelWidth,
        pixelHeight,
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
        autoCrop,
      };

      this.renderCache.set(this.cacheKey(pageNum, bucketWidth), entry);
      return entry;
    } finally {
      page.cleanup();
    }
  }

  /**
   * Compute or return cached auto-crop bounds for a page.
   */
  async getAutoCrop(pageNum: number, desiredPixelWidth = 640): Promise<NormalizedRect> {
    const safePage = Math.max(1, Math.min(this.pageCount, pageNum));
    const cached = this.autoCropCache.get(safePage);
    if (cached) {
      return cached;
    }
    const rendered = await this.renderPage(safePage, desiredPixelWidth);
    return rendered.autoCrop;
  }

  /**
   * Warm the LRU cache around `currentPage` in priority order:
   * current, next (+1), previous (-1), next+1 (+2).
   */
  prefetchAround(currentPage: number, desiredPixelWidth?: number): void {
    if (this.destroyed) {
      return;
    }
    const bucketWidth = quantizeRenderPixelWidth(desiredPixelWidth ?? 1200);
    const candidates = [
      currentPage,
      currentPage + 1,
      currentPage - 1,
      currentPage + 2,
    ].filter((p) => p >= 1 && p <= this.pageCount);

    for (const pageNum of candidates) {
      const key = this.cacheKey(pageNum, bucketWidth);
      if (this.renderCache.has(key) || this.inFlightRenders.has(key)) {
        // Touch recency if already present so neighbor pages do not get evicted prematurely.
        this.renderCache.get(key);
        continue;
      }
      void this.renderPage(pageNum, bucketWidth).catch(() => {
        // Ignore background prefetch cancellation/disposal errors.
      });
    }
  }

  clearCache(): void {
    this.renderCache.clear();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const task of this.activeTasks) {
      try {
        task.cancel();
      } catch {
        // Ignore already completed tasks.
      }
    }
    this.activeTasks.clear();
    this.inFlightRenders.clear();
    this.pinnedPages.clear();
    this.pinnedKeys.clear();
    this.renderCache.clear();
    this.pageDimensionsCache.clear();
    this.autoCropCache.clear();
    await this.doc.destroy();
  }
}

/**
 * Load a PDF document from raw bytes without mutating/detaching the caller's Uint8Array.
 * Supports optional AbortSignal to cancel loading cleanly.
 */
export async function loadPdfDocument(
  pdfBytes: Uint8Array,
  cacheCapacity = 10,
  signal?: AbortSignal,
): Promise<PdfScoreDocument> {
  if (signal?.aborted) {
    throw new DOMException('PDF loading aborted', 'AbortError');
  }

  const safeCopy = pdfBytes.slice();
  const loadingTask = pdfjsLib.getDocument({
    data: safeCopy,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const onAbort = () => {
    void loadingTask.destroy().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const doc = await loadingTask.promise;
    if (signal?.aborted) {
      await doc.destroy().catch(() => {});
      throw new DOMException('PDF loading aborted', 'AbortError');
    }
    return new PdfScoreDocument(doc, cacheCapacity);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
