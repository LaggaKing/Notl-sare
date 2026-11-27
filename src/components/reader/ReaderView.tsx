import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Bookmark, BookmarkPlus, Trash2, X } from 'lucide-react';
import type {
  AppSettings,
  Bookmark as ScoreBookmark,
  CropMode,
  CropSettings,
  NormalizedRect,
  SavedPitch,
  ScoreMetadataPatch,
  ScoreRecord,
  Setlist,
} from '../../types';
import { formatMessage, useI18n } from '../../i18n';
import {
  clampNormalizedRect,
  FULL_PAGE_RECT,
  loadPdfDocument,
  PdfScoreDocument,
  type RenderedPage,
} from '../../pdf';
import {
  deleteBookmark,
  listBookmarks,
  readPdfBytes,
  upsertBookmark,
} from '../../services/tauriApi';
import { CropControlsBar, CropOverlay } from './CropOverlay';
import { ReaderHud } from './ReaderHud';
import './reader.css';

export interface PinchPoint {
  x: number;
  y: number;
}

export interface PinchPanPointerInput {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface PinchPanHandlers {
  onPinchPanStart: (pointers: PinchPanPointerInput[]) => void;
  onPinchPanMove: (pointers: PinchPanPointerInput[]) => void;
  onPinchPanEnd: () => void;
}

export interface AnnotationOverlayContext {
  score: ScoreRecord;
  pageNum: number;
  pageWidth: number;
  pageHeight: number;
  isAnnotating: boolean;
  showAnnotations: boolean;
  zoomScale: number;
  pinchHandlers: PinchPanHandlers;
}

export interface ReaderViewProps {
  score: ScoreRecord;
  settings: AppSettings;
  initialPage?: number;
  setlist?: Setlist | null;
  setlistScores?: ScoreRecord[];
  setlistIndex?: number;
  onSelectSetlistScore?: (nextIndex: number, targetPage: number) => void;
  onBackToLibrary: () => void;
  onUpdateScore: (scoreId: string, patch: ScoreMetadataPatch) => void | Promise<void>;
  onPageChange?: (pageNum: number) => void;
  onPageCountReady?: (pageCount: number) => void;
  onOpenSettings: () => void;
  onPlaySavedPitch?: (pitch: SavedPitch) => void;
  isAnnotating?: boolean;
  onAnnotatingChange?: (annotating: boolean) => void;
  showAnnotations?: boolean;
  onShowAnnotationsChange?: (visible: boolean) => void;
  metronomeOpen?: boolean;
  onMetronomeOpenChange?: (open: boolean) => void;
  pianoOpen?: boolean;
  onPianoOpenChange?: (open: boolean) => void;
  modalOpen?: boolean;
  restoreEpoch?: number;
  annotationsReady?: boolean;
  onError?: (message: string) => void;
  renderPageOverlay?: (ctx: AnnotationOverlayContext) => ReactNode;
  annotationToolbarSlot?: ReactNode;
  metronomeSlot?: ReactNode;
  pianoSlot?: ReactNode;
}

interface ViewTransform {
  scale: number;
  panX: number;
  panY: number;
}

const IDENTITY_TRANSFORM: ViewTransform = { scale: 1, panX: 0, panY: 0 };

function computeFittedLayout(
  viewportW: number,
  viewportH: number,
  pageW: number,
  pageH: number,
  cropRect: NormalizedRect,
) {
  const safeVw = Math.max(100, viewportW);
  const safeVh = Math.max(100, viewportH);
  const safePw = Math.max(1, pageW);
  const safePh = Math.max(1, pageH);
  const cw = Math.max(0.05, Math.min(1, cropRect.width));
  const ch = Math.max(0.05, Math.min(1, cropRect.height));

  const croppedPdfW = cw * safePw;
  const croppedPdfH = ch * safePh;
  const scale = Math.min(safeVw / croppedPdfW, safeVh / croppedPdfH);

  const frameW = Math.round(croppedPdfW * scale);
  const frameH = Math.round(croppedPdfH * scale);
  const fullW = frameW / cw;
  const fullH = frameH / ch;
  const offsetX = -cropRect.x * fullW;
  const offsetY = -cropRect.y * fullH;

  return { frameW, frameH, fullW, fullH, offsetX, offsetY };
}

function RenderedCanvasMirror({
  rendered,
  width,
  height,
  onEvicted,
}: {
  rendered: RenderedPage | null;
  width: number;
  height: number;
  onEvicted?: (evicted: RenderedPage) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const target = canvasRef.current;
    if (!target || !rendered) return;
    if (rendered.canvas.width === 0 || rendered.canvas.height === 0) {
      onEvicted?.(rendered);
      return;
    }
    if (
      target.width !== rendered.pixelWidth ||
      target.height !== rendered.pixelHeight
    ) {
      target.width = rendered.pixelWidth;
      target.height = rendered.pixelHeight;
    }
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(rendered.canvas, 0, 0);
  }, [rendered, onEvicted]);

  return (
    <canvas
      ref={canvasRef}
      className="reader-page-canvas"
      style={{ width, height }}
    />
  );
}

export function ReaderView({
  score,
  settings,
  initialPage,
  setlist = null,
  setlistScores = [],
  setlistIndex = 0,
  onSelectSetlistScore,
  onBackToLibrary,
  onUpdateScore,
  onPageChange,
  onPageCountReady,
  onOpenSettings,
  onPlaySavedPitch,
  isAnnotating: controlledAnnotating,
  onAnnotatingChange,
  showAnnotations: controlledShowAnnotations,
  onShowAnnotationsChange,
  metronomeOpen: controlledMetronomeOpen,
  onMetronomeOpenChange,
  pianoOpen: controlledPianoOpen,
  onPianoOpenChange,
  modalOpen = false,
  restoreEpoch = 0,
  annotationsReady: _annotationsReady = true,
  onError,
  renderPageOverlay,
  annotationToolbarSlot,
  metronomeSlot,
  pianoSlot,
}: ReaderViewProps) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 780,
    height: typeof window !== 'undefined' ? window.innerHeight : 1160,
  });

  // PDF document & rendering state
  const [pdfDoc, setPdfDoc] = useState<PdfScoreDocument | null>(null);
  const [loadErrorCode, setLoadErrorCode] = useState<'load' | 'empty' | 'render' | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [pageCount, setPageCount] = useState(Math.max(1, score.pageCount || 1));
  const [currentPage, setCurrentPage] = useState(Math.max(1, score.lastPage || 1));
  const [renderedCurrent, setRenderedCurrent] = useState<RenderedPage | null>(null);
  const [renderedNext, setRenderedNext] = useState<RenderedPage | null>(null);
  const [renderEpoch, setRenderEpoch] = useState(0);
  const retriedEvictedRef = useRef<WeakSet<RenderedPage>>(new WeakSet());
  const handleCanvasEvicted = useCallback((evicted: RenderedPage) => {
    if (retriedEvictedRef.current.has(evicted)) return;
    retriedEvictedRef.current.add(evicted);
    setRenderEpoch((n) => n + 1);
  }, []);

  // Reader UI state
  const [hudVisible, setHudVisible] = useState(false);
  const [hudHeights, setHudHeights] = useState<{ top: number; bottom: number }>({
    top: 0,
    bottom: 0,
  });
  const handleHudHeightsChange = useCallback(
    (next: { top: number; bottom: number }) => {
      setHudHeights((prev) =>
        prev.top === next.top && prev.bottom === next.bottom ? prev : next,
      );
    },
    [],
  );
  const [halfPageMode, setHalfPageMode] = useState(settings.halfPageModeDefault);
  const [halfTurnPending, setHalfTurnPending] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropDraftRect, setCropDraftRect] = useState<NormalizedRect>({
    x: 0.04,
    y: 0.04,
    width: 0.92,
    height: 0.92,
  });

  // Uncontrolled fallbacks for Stage 3 tool toggles
  const [uncontrolledAnnotating, setUncontrolledAnnotating] = useState(false);
  const [uncontrolledShowAnnotations, setUncontrolledShowAnnotations] = useState(true);
  const [uncontrolledMetronomeOpen, setUncontrolledMetronomeOpen] = useState(false);
  const [uncontrolledPianoOpen, setUncontrolledPianoOpen] = useState(false);

  const isAnnotating = controlledAnnotating ?? uncontrolledAnnotating;
  const showAnnotations = controlledShowAnnotations ?? uncontrolledShowAnnotations;
  const metronomeOpen = controlledMetronomeOpen ?? uncontrolledMetronomeOpen;
  const pianoOpen = controlledPianoOpen ?? uncontrolledPianoOpen;

  const setAnnotating = useCallback(
    (next: boolean) => {
      if (next) {
        setHalfTurnPending(false);
      }
      if (onAnnotatingChange) {
        onAnnotatingChange(next);
      } else {
        setUncontrolledAnnotating(next);
      }
    },
    [onAnnotatingChange],
  );

  const setShowAnnotations = useCallback(
    (next: boolean) => {
      if (onShowAnnotationsChange) {
        onShowAnnotationsChange(next);
      } else {
        setUncontrolledShowAnnotations(next);
      }
    },
    [onShowAnnotationsChange],
  );

  const setMetronomeOpen = useCallback(
    (next: boolean) => {
      if (onMetronomeOpenChange) {
        onMetronomeOpenChange(next);
      } else {
        setUncontrolledMetronomeOpen(next);
      }
    },
    [onMetronomeOpenChange],
  );

  const setPianoOpen = useCallback(
    (next: boolean) => {
      if (onPianoOpenChange) {
        onPianoOpenChange(next);
      } else {
        setUncontrolledPianoOpen(next);
      }
    },
    [onPianoOpenChange],
  );

  // Bookmarks state
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<ScoreBookmark[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState('');

  // Zoom / Pan state
  const [transform, setTransform] = useState<ViewTransform>(IDENTITY_TRANSFORM);
  const transformRef = useRef<ViewTransform>(IDENTITY_TRANSFORM);
  const updateTransform = useCallback((next: ViewTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const resetZoom = useCallback(() => {
    updateTransform(IDENTITY_TRANSFORM);
  }, [updateTransform]);

  // Auto-close Metronome/Piano overlays when entering annotation mode
  useEffect(() => {
    if (isAnnotating) {
      if (metronomeOpen) setMetronomeOpen(false);
      if (pianoOpen) setPianoOpen(false);
    }
  }, [isAnnotating, metronomeOpen, pianoOpen, setMetronomeOpen, setPianoOpen]);

  // Keep stage dimensions measured cleanly
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load bookmarks when score or restore epoch changes
  useEffect(() => {
    let cancelled = false;
    listBookmarks(score.id)
      .then((items) => {
        if (!cancelled) {
          setBookmarks(items);
        }
      })
      .catch(() => {
        if (!cancelled) setBookmarks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [score.id, restoreEpoch]);

  // Load PDF document whenever score file changes
  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PdfScoreDocument | null = null;

    setLoadingPdf(true);
    setLoadErrorCode(null);
    setRenderedCurrent(null);
    setRenderedNext(null);
    setHalfTurnPending(false);
    setIsCropping(false);
    resetZoom();

    async function openPdf() {
      try {
        const bytes = await readPdfBytes(score.id, score.filePath);
        if (cancelled) return;
        const doc = await loadPdfDocument(bytes);
        if (cancelled) {
          await doc.destroy();
          return;
        }
        if (doc.pageCount === 0) {
          await doc.destroy();
          if (!cancelled) {
            setPdfDoc(null);
            setLoadErrorCode('empty');
          }
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        const total = doc.pageCount;
        setPageCount(total);
        onPageCountReady?.(total);

        const requestedPage =
          initialPage === -1
            ? total
            : initialPage !== undefined
              ? initialPage
              : score.lastPage || 1;
        const clamped = Math.max(1, Math.min(total, requestedPage));
        setCurrentPage(clamped);
        onPageChange?.(clamped);

        const patch: ScoreMetadataPatch = {
          lastOpenedAt: new Date().toISOString(),
          lastPage: clamped,
        };
        if (score.pageCount !== total) {
          patch.pageCount = total;
        }
        void onUpdateScore(score.id, patch);
      } catch {
        if (!cancelled) {
          setLoadErrorCode('load');
          setPdfDoc(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingPdf(false);
        }
      }
    }

    void openPdf();

    return () => {
      cancelled = true;
      setPdfDoc(null);
      if (loadedDoc) {
        void loadedDoc.destroy();
      }
    };
    // Intentionally keyed to score.id & filePath so metadata updates do not reload PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score.id, score.filePath]);

  const desiredRenderPixelWidth = useMemo(() => {
    const dpr =
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
    const zoomBoost = transform.scale > 1.75 ? 1.5 : 1;
    return Math.round(viewportSize.width * dpr * zoomBoost);
  }, [viewportSize.width, transform.scale]);

  // Render current page (+ next page if half-turn split is active) and warm LRU cache
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    const cachedCurr = pdfDoc.getCachedPage(currentPage, desiredRenderPixelWidth);
    if (cachedCurr && cachedCurr.canvas.width > 0 && cachedCurr.canvas.height > 0) {
      setRenderedCurrent(cachedCurr);
    }

    if (halfTurnPending && currentPage < pageCount) {
      const cachedNext = pdfDoc.getCachedPage(currentPage + 1, desiredRenderPixelWidth);
      if (cachedNext && cachedNext.canvas.width > 0 && cachedNext.canvas.height > 0) {
        setRenderedNext(cachedNext);
      }
    } else {
      setRenderedNext(null);
    }

    const isCancelError = (err: unknown) => {
      const name = err instanceof Error ? err.name : '';
      return name === 'RenderingCancelledException' || name === 'AbortError';
    };

    void pdfDoc
      .renderPage(currentPage, desiredRenderPixelWidth)
      .then((rendered) => {
        if (!cancelled) {
          setLoadErrorCode((prev) => (prev === 'render' ? null : prev));
          setRenderedCurrent(rendered);
        }
      })
      .catch((err) => {
        if (!cancelled && !isCancelError(err)) {
          setLoadErrorCode('render');
        }
      });

    if (halfTurnPending && currentPage < pageCount) {
      void pdfDoc
        .renderPage(currentPage + 1, desiredRenderPixelWidth)
        .then((rendered) => {
          if (!cancelled) {
            setRenderedNext(rendered);
          }
        })
        .catch((err) => {
          if (!cancelled && !isCancelError(err)) {
            setLoadErrorCode('render');
          }
        });
    }

    pdfDoc.prefetchAround(currentPage, desiredRenderPixelWidth);

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, pageCount, halfTurnPending, desiredRenderPixelWidth, renderEpoch]);

  // Persist lastPage when page changes
  const jumpToPage = useCallback(
    (targetPage: number) => {
      const clamped = Math.max(1, Math.min(pageCount, Math.round(targetPage)));
      setHalfTurnPending(false);
      setCurrentPage(clamped);
      onPageChange?.(clamped);
      void onUpdateScore(score.id, { lastPage: clamped });
    },
    [pageCount, onPageChange, onUpdateScore, score.id],
  );

  // Sync page when navigating across repeated scores in a setlist
  useEffect(() => {
    if (!pdfDoc || initialPage === undefined) return;
    const target = initialPage === -1 ? pageCount : initialPage;
    const clamped = Math.max(1, Math.min(pageCount, target));
    setHalfTurnPending(false);
    setCurrentPage(clamped);
    onPageChange?.(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPage, setlistIndex]);

  const goNext = useCallback(() => {
    if (halfPageMode) {
      if (halfTurnPending) {
        if (currentPage < pageCount) {
          jumpToPage(currentPage + 1);
          return;
        }
        setHalfTurnPending(false);
      } else if (currentPage < pageCount) {
        setHalfTurnPending(true);
        return;
      }
    } else if (currentPage < pageCount) {
      jumpToPage(currentPage + 1);
      return;
    }

    // At last page: advance to next piece in setlist if available
    if (
      setlist &&
      onSelectSetlistScore &&
      setlistIndex < setlistScores.length - 1
    ) {
      onSelectSetlistScore(setlistIndex + 1, 1);
    }
  }, [
    halfPageMode,
    halfTurnPending,
    currentPage,
    pageCount,
    jumpToPage,
    setlist,
    onSelectSetlistScore,
    setlistIndex,
    setlistScores.length,
  ]);

  const goPrev = useCallback(() => {
    if (halfTurnPending) {
      setHalfTurnPending(false);
      return;
    }
    if (currentPage > 1) {
      jumpToPage(currentPage - 1);
      return;
    }
    // At page 1: move to last page of previous piece in setlist if available
    if (setlist && onSelectSetlistScore && setlistIndex > 0) {
      onSelectSetlistScore(setlistIndex - 1, -1);
    }
  }, [
    halfTurnPending,
    currentPage,
    jumpToPage,
    setlist,
    onSelectSetlistScore,
    setlistIndex,
  ]);

  // Keyboard & Bluetooth pedal support
  useEffect(() => {
    function isInputLike(el: HTMLElement | null): boolean {
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    }

    function isInteractiveElement(el: HTMLElement | null): boolean {
      if (!el) return false;
      if (
        isInputLike(el) ||
        el.tagName === 'BUTTON' ||
        el.tagName === 'A'
      ) {
        return true;
      }
      return Boolean(el.closest('button, a, [role="button"]'));
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (modalOpen) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target as HTMLElement | null;
      if (isInputLike(target)) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isCropping) {
          setIsCropping(false);
        } else if (bookmarksOpen) {
          setBookmarksOpen(false);
        } else if (isAnnotating) {
          setAnnotating(false);
        } else {
          setHudVisible((prev) => !prev);
        }
        return;
      }

      if (isCropping || isAnnotating || bookmarksOpen) {
        return;
      }

      if (e.key === ' ') {
        const activeEl =
          typeof document !== 'undefined'
            ? (document.activeElement as HTMLElement | null)
            : null;
        if (isInteractiveElement(activeEl) || isInteractiveElement(target)) {
          return;
        }
        e.preventDefault();
        goNext();
        return;
      }

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === 'PageDown'
      ) {
        e.preventDefault();
        goNext();
      } else if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp' ||
        e.key === 'PageUp'
      ) {
        e.preventDefault();
        goPrev();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    modalOpen,
    isCropping,
    bookmarksOpen,
    isAnnotating,
    setAnnotating,
    goNext,
    goPrev,
  ]);

  // Pinch-zoom & pan math shared between reading viewport and AnnotationCanvas
  const clampPan = useCallback(
    (panX: number, panY: number, scale: number): { panX: number; panY: number } => {
      if (scale <= 1.01) {
        return { panX: 0, panY: 0 };
      }
      const maxX = viewportSize.width * (scale - 1) * 0.65 + 80;
      const maxY = viewportSize.height * (scale - 1) * 0.65 + 80;
      return {
        panX: Math.max(-maxX, Math.min(maxX, panX)),
        panY: Math.max(-maxY, Math.min(maxY, panY)),
      };
    },
    [viewportSize.width, viewportSize.height],
  );

  const pinchStateRef = useRef<{
    initialDist: number;
    initialMid: PinchPoint;
    initialScale: number;
    initialPanX: number;
    initialPanY: number;
  } | null>(null);

  const onPinchPanStart = useCallback((pointers: PinchPanPointerInput[]) => {
    if (pointers.length < 2) return;
    const [p1, p2] = pointers;
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const current = transformRef.current;
    pinchStateRef.current = {
      initialDist: dist,
      initialMid: {
        x: (p1.clientX + p2.clientX) / 2,
        y: (p1.clientY + p2.clientY) / 2,
      },
      initialScale: current.scale,
      initialPanX: current.panX,
      initialPanY: current.panY,
    };
  }, []);

  const onPinchPanMove = useCallback(
    (pointers: PinchPanPointerInput[]) => {
      if (pointers.length < 2) return;
      const [p1, p2] = pointers;
      const ps = pinchStateRef.current;
      const stage = stageRef.current;
      if (!ps || !stage) return;

      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dist = Math.max(
        1,
        Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY),
      );
      const midX = (p1.clientX + p2.clientX) / 2;
      const midY = (p1.clientY + p2.clientY) / 2;

      const nextScale = Math.max(
        1,
        Math.min(4, ps.initialScale * (dist / ps.initialDist)),
      );

      if (nextScale <= 1.01) {
        updateTransform(IDENTITY_TRANSFORM);
        return;
      }

      const contentX = (ps.initialMid.x - centerX - ps.initialPanX) / ps.initialScale;
      const contentY = (ps.initialMid.y - centerY - ps.initialPanY) / ps.initialScale;
      const rawPanX = midX - centerX - contentX * nextScale;
      const rawPanY = midY - centerY - contentY * nextScale;
      const clamped = clampPan(rawPanX, rawPanY, nextScale);

      updateTransform({
        scale: nextScale,
        panX: clamped.panX,
        panY: clamped.panY,
      });
    },
    [clampPan, updateTransform],
  );

  const onPinchPanEnd = useCallback(() => {
    pinchStateRef.current = null;
    if (transformRef.current.scale <= 1.03) {
      updateTransform(IDENTITY_TRANSFORM);
    }
  }, [updateTransform]);

  const pinchHandlers = useMemo<PinchPanHandlers>(
    () => ({ onPinchPanStart, onPinchPanMove, onPinchPanEnd }),
    [onPinchPanStart, onPinchPanMove, onPinchPanEnd],
  );

  // Reading mode pointer gesture state (tap zones, swipe, 1-finger pan, 2-finger pinch)
  const activePointersRef = useRef<Map<number, PinchPoint>>(new Map());
  const singleGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    initialPanX: number;
    initialPanY: number;
    hadMultiTouch: boolean;
    moved: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);

  function toPinchInputs(): PinchPanPointerInput[] {
    return Array.from(activePointersRef.current.entries()).map(
      ([pointerId, pt]) => ({
        pointerId,
        clientX: pt.x,
        clientY: pt.y,
      }),
    );
  }

  const clearStagePointers = useCallback(() => {
    if (pinchStateRef.current) {
      onPinchPanEnd();
    }
    activePointersRef.current.clear();
    singleGestureRef.current = null;
  }, [onPinchPanEnd]);

  useEffect(() => {
    if (isAnnotating || isCropping) {
      clearStagePointers();
    }
  }, [isAnnotating, isCropping, clearStagePointers]);

  useEffect(() => {
    window.addEventListener('blur', clearStagePointers);
    return () => window.removeEventListener('blur', clearStagePointers);
  }, [clearStagePointers]);

  function handleStagePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (isAnnotating || isCropping) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events in tests that lack pointer capture.
    }

    const pt = { x: e.clientX, y: e.clientY };
    activePointersRef.current.set(e.pointerId, pt);

    if (activePointersRef.current.size === 1) {
      singleGestureRef.current = {
        pointerId: e.pointerId,
        startX: pt.x,
        startY: pt.y,
        startTime: performance.now(),
        initialPanX: transformRef.current.panX,
        initialPanY: transformRef.current.panY,
        hadMultiTouch: false,
        moved: false,
      };
    } else if (activePointersRef.current.size === 2) {
      if (singleGestureRef.current) {
        singleGestureRef.current.hadMultiTouch = true;
      }
      onPinchPanStart(toPinchInputs());
    } else if (singleGestureRef.current) {
      singleGestureRef.current.hadMultiTouch = true;
    }
  }

  function handleStagePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (isAnnotating || isCropping) return;
    if (!activePointersRef.current.has(e.pointerId)) return;

    const pt = { x: e.clientX, y: e.clientY };
    activePointersRef.current.set(e.pointerId, pt);

    if (activePointersRef.current.size >= 2) {
      onPinchPanMove(toPinchInputs());
      return;
    }

    const g = singleGestureRef.current;
    if (!g || g.pointerId !== e.pointerId || g.hadMultiTouch) return;

    const dx = pt.x - g.startX;
    const dy = pt.y - g.startY;
    if (Math.hypot(dx, dy) > 10) {
      g.moved = true;
    }

    if (transformRef.current.scale > 1.05) {
      const clamped = clampPan(
        g.initialPanX + dx,
        g.initialPanY + dy,
        transformRef.current.scale,
      );
      updateTransform({
        scale: transformRef.current.scale,
        panX: clamped.panX,
        panY: clamped.panY,
      });
    }
  }

  function releaseStagePointerCapture(e: ReactPointerEvent<HTMLDivElement>) {
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors in synthetic environments.
    }
  }

  function handleStagePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    releaseStagePointerCapture(e);

    if (isAnnotating || isCropping) {
      activePointersRef.current.delete(e.pointerId);
      return;
    }

    const wasPinching = activePointersRef.current.size >= 2;
    activePointersRef.current.delete(e.pointerId);

    if (wasPinching && activePointersRef.current.size < 2) {
      onPinchPanEnd();
    }

    const g = singleGestureRef.current;
    if (activePointersRef.current.size === 0) {
      singleGestureRef.current = null;
    }

    if (!g || g.pointerId !== e.pointerId || g.hadMultiTouch) {
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - g.startTime;

    // Swipe navigation when not zoomed
    if (
      settings.swipeEnabled &&
      transformRef.current.scale <= 1.05 &&
      Math.abs(dx) >= 48 &&
      Math.abs(dx) > Math.abs(dy) * 1.25 &&
      elapsed < 700
    ) {
      if (dx < 0) {
        goNext();
      } else {
        goPrev();
      }
      return;
    }

    // Tap / Double-tap
    if (dist < 14 && elapsed < 380) {
      const now = performance.now();
      const prevTap = lastTapRef.current;
      if (
        prevTap &&
        now - prevTap.time < 280 &&
        Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 32
      ) {
        lastTapRef.current = null;
        if (transformRef.current.scale > 1.05) {
          resetZoom();
          return;
        }
      } else {
        lastTapRef.current = { x: e.clientX, y: e.clientY, time: now };
      }

      if (!settings.tapZonesEnabled) {
        setHudVisible((prev) => !prev);
        return;
      }

      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const relX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      if (transformRef.current.scale > 1.05) {
        if (relX >= 0.25 && relX <= 0.75) {
          setHudVisible((prev) => !prev);
        }
        return;
      }
      if (relX < 0.25) {
        goPrev();
      } else if (relX > 0.75) {
        goNext();
      } else {
        setHudVisible((prev) => !prev);
      }
    }
  }

  function handleStagePointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    releaseStagePointerCapture(e);
    const wasPinching = activePointersRef.current.size >= 2;
    activePointersRef.current.delete(e.pointerId);
    if (wasPinching && activePointersRef.current.size < 2) {
      onPinchPanEnd();
    }
    if (activePointersRef.current.size === 0) {
      singleGestureRef.current = null;
    }
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function handleWheel(e: WheelEvent) {
      if (isCropping) return;
      if (!e.ctrlKey && Math.abs(e.deltaY) === 0) return;
      if (!e.ctrlKey && transformRef.current.scale <= 1.01) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextScale = Math.max(
        1,
        Math.min(4, transformRef.current.scale * factor),
      );
      if (nextScale <= 1.02) {
        resetZoom();
        return;
      }
      const clamped = clampPan(
        transformRef.current.panX,
        transformRef.current.panY,
        nextScale,
      );
      updateTransform({ scale: nextScale, panX: clamped.panX, panY: clamped.panY });
    }

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [isCropping, clampPan, resetZoom, updateTransform]);

  // Crop resolution logic
  const effectiveCropMode: CropMode =
    score.crop?.mode ?? (settings.autoCropDefault ? 'auto' : 'none');

  function getCropRectForPage(
    pageNum: number,
    rendered: RenderedPage | null,
  ): NormalizedRect {
    if (isCropping) {
      return FULL_PAGE_RECT;
    }
    if (effectiveCropMode === 'none') {
      return FULL_PAGE_RECT;
    }
    if (effectiveCropMode === 'manual') {
      return score.crop?.manualBox ?? FULL_PAGE_RECT;
    }
    return (
      score.crop?.autoCache?.[pageNum] ??
      rendered?.autoCrop ??
      pdfDoc?.getCachedAutoCrop(pageNum) ??
      FULL_PAGE_RECT
    );
  }

  const enterManualCrop = useCallback(() => {
    resetZoom();
    setCropDraftRect(
      clampNormalizedRect(
        score.crop?.manualBox ??
          renderedCurrent?.autoCrop ?? {
            x: 0.04,
            y: 0.04,
            width: 0.92,
            height: 0.92,
          },
        0.15,
      ),
    );
    setIsCropping(true);
    setHudVisible(false);
  }, [resetZoom, score.crop?.manualBox, renderedCurrent?.autoCrop]);

  function handleSelectCropMode(mode: CropMode) {
    if (mode === 'manual' && !score.crop?.manualBox) {
      enterManualCrop();
      return;
    }
    const nextCrop: CropSettings = {
      mode,
      manualBox: score.crop?.manualBox,
      autoCache: score.crop?.autoCache,
    };
    void onUpdateScore(score.id, { crop: nextCrop });
  }

  function handleApplyManualCrop(rect: NormalizedRect) {
    const nextCrop: CropSettings = {
      mode: 'manual',
      manualBox: rect,
      autoCache: score.crop?.autoCache,
    };
    void onUpdateScore(score.id, { crop: nextCrop });
    setIsCropping(false);
  }

  async function handleAddBookmark(e: FormEvent) {
    e.preventDefault();
    const label =
      bookmarkDraft.trim() ||
      formatMessage(t.common.pageOf, { page: currentPage, total: pageCount });
    try {
      const created = await upsertBookmark({
        scoreId: score.id,
        pageNum: currentPage,
        label,
      });
      setBookmarks((prev) =>
        [...prev.filter((b) => b.id !== created.id), created].sort(
          (a, b) => a.pageNum - b.pageNum,
        ),
      );
      setBookmarkDraft('');
    } catch {
      onError?.(t.errors.bookmarkActionFailed);
    }
  }

  async function handleDeleteBookmark(id: string) {
    try {
      await deleteBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } catch {
      onError?.(t.errors.bookmarkActionFailed);
    }
  }

  const loadErrorMessage =
    loadErrorCode === 'empty'
      ? t.errors.emptyPdf
      : loadErrorCode === 'render'
        ? t.errors.renderFailed
        : loadErrorCode === 'load'
          ? t.reader.loadError
          : null;

  const currCrop = getCropRectForPage(currentPage, renderedCurrent);
  const currLayout = computeFittedLayout(
    viewportSize.width,
    viewportSize.height,
    renderedCurrent?.pageWidth ?? 595,
    renderedCurrent?.pageHeight ?? 842,
    currCrop,
  );

  const nextPageNum = Math.min(pageCount, currentPage + 1);
  const nextCrop = getCropRectForPage(nextPageNum, renderedNext);
  const nextLayout = computeFittedLayout(
    viewportSize.width,
    viewportSize.height,
    renderedNext?.pageWidth ?? renderedCurrent?.pageWidth ?? 595,
    renderedNext?.pageHeight ?? renderedCurrent?.pageHeight ?? 842,
    nextCrop,
  );

  const showHalfSplit = halfTurnPending && currentPage < pageCount && !isCropping;
  const splitFrameW = Math.max(currLayout.frameW, nextLayout.frameW);
  const splitFrameH = Math.max(currLayout.frameH, nextLayout.frameH);

  return (
    <div className="reader-root">
      <div
        ref={stageRef}
        className="reader-stage"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
        onLostPointerCapture={handleStagePointerCancel}
      >
        {loadingPdf && !renderedCurrent ? (
          <div className="reader-loading-state">
            <span>{t.reader.loadingScore}</span>
          </div>
        ) : loadErrorMessage ? (
          <div className="reader-loading-state">
            <span>{loadErrorMessage}</span>
            <button type="button" className="hud-btn" onClick={onBackToLibrary}>
              {t.reader.backToLibrary}
            </button>
          </div>
        ) : (
          <div
            className="reader-transform-layer"
            style={{
              transform: `translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.scale})`,
            }}
          >
            {showHalfSplit ? (
              <div
                className="reader-crop-frame"
                style={{
                  width: splitFrameW,
                  height: splitFrameH,
                }}
              >
                <div className="reader-half-split">
                  <div className="reader-half-pane">
                    <div
                      className="reader-half-pane-clip"
                      style={{ width: nextLayout.frameW }}
                    >
                      <div
                        className="reader-page-surface paper-tinted"
                        style={{
                          width: nextLayout.fullW,
                          height: nextLayout.fullH,
                          left: nextLayout.offsetX,
                          top: nextLayout.offsetY,
                        }}
                      >
                        <RenderedCanvasMirror
                          rendered={renderedNext}
                          width={nextLayout.fullW}
                          height={nextLayout.fullH}
                          onEvicted={handleCanvasEvicted}
                        />
                        {showAnnotations && renderPageOverlay && (
                          <div
                            className="reader-overlay-layer"
                            style={{ pointerEvents: 'none' }}
                          >
                            {renderPageOverlay({
                              score,
                              pageNum: nextPageNum,
                              pageWidth: nextLayout.fullW,
                              pageHeight: nextLayout.fullH,
                              isAnnotating: false,
                              showAnnotations,
                              zoomScale: transform.scale,
                              pinchHandlers,
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="reader-half-label reader-half-label-top">
                      {formatMessage(t.reader.halfPageTopNext, {
                        page: nextPageNum,
                      })}
                    </span>
                  </div>

                  <div className="reader-half-divider" />

                  <div className="reader-half-pane">
                    <div
                      className="reader-half-pane-clip"
                      style={{ width: currLayout.frameW }}
                    >
                      <div
                        className="reader-page-surface paper-tinted"
                        style={{
                          width: currLayout.fullW,
                          height: currLayout.fullH,
                          left: currLayout.offsetX,
                          top: currLayout.offsetY - currLayout.frameH / 2,
                        }}
                      >
                        <RenderedCanvasMirror
                          rendered={renderedCurrent}
                          width={currLayout.fullW}
                          height={currLayout.fullH}
                          onEvicted={handleCanvasEvicted}
                        />
                        {showAnnotations && renderPageOverlay && (
                          <div
                            className="reader-overlay-layer"
                            style={{ pointerEvents: 'none' }}
                          >
                            {renderPageOverlay({
                              score,
                              pageNum: currentPage,
                              pageWidth: currLayout.fullW,
                              pageHeight: currLayout.fullH,
                              isAnnotating: false,
                              showAnnotations,
                              zoomScale: transform.scale,
                              pinchHandlers,
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="reader-half-label reader-half-label-bottom">
                      {formatMessage(t.reader.halfPageBottomCurrent, {
                        page: currentPage,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={`reader-crop-frame ${isCropping ? 'is-cropping' : ''}`}
                style={{
                  width: currLayout.frameW,
                  height: currLayout.frameH,
                }}
              >
                <div
                  className="reader-page-surface paper-tinted"
                  style={{
                    width: currLayout.fullW,
                    height: currLayout.fullH,
                    left: currLayout.offsetX,
                    top: currLayout.offsetY,
                  }}
                >
                  <RenderedCanvasMirror
                    rendered={renderedCurrent}
                    width={currLayout.fullW}
                    height={currLayout.fullH}
                    onEvicted={handleCanvasEvicted}
                  />
                  {renderPageOverlay && !isCropping && (
                    <div
                      className="reader-overlay-layer"
                      style={{ pointerEvents: isAnnotating ? 'auto' : 'none' }}
                    >
                      {renderPageOverlay({
                        score,
                        pageNum: currentPage,
                        pageWidth: currLayout.fullW,
                        pageHeight: currLayout.fullH,
                        isAnnotating,
                        showAnnotations,
                        zoomScale: transform.scale,
                        pinchHandlers,
                      })}
                    </div>
                  )}
                </div>

                {isCropping && (
                  <CropOverlay
                    initialRect={cropDraftRect}
                    rect={cropDraftRect}
                    onRectChange={setCropDraftRect}
                    showControls={false}
                    onApply={handleApplyManualCrop}
                    onCancel={() => setIsCropping(false)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isCropping && !loadingPdf && !loadErrorMessage && (
        <CropControlsBar
          onReset={() => setCropDraftRect({ ...FULL_PAGE_RECT })}
          onCancel={() => setIsCropping(false)}
          onApply={() => handleApplyManualCrop(cropDraftRect)}
        />
      )}

      <ReaderHud
        visible={hudVisible && !isCropping && !isAnnotating}
        score={score}
        settings={settings}
        currentPage={currentPage}
        pageCount={pageCount}
        cropMode={effectiveCropMode}
        halfPageMode={halfPageMode}
        zoomScale={transform.scale}
        bookmarkCount={bookmarks.length}
        isAnnotating={isAnnotating}
        showAnnotations={showAnnotations}
        metronomeOpen={metronomeOpen}
        pianoOpen={pianoOpen}
        setlist={setlist}
        setlistIndex={setlistIndex}
        setlistTotal={setlistScores.length}
        onBackToLibrary={onBackToLibrary}
        onPrevPage={goPrev}
        onNextPage={goNext}
        onJumpToPage={jumpToPage}
        onPrevSetlistPiece={() => {
          if (setlist && onSelectSetlistScore && setlistIndex > 0) {
            onSelectSetlistScore(setlistIndex - 1, 1);
          }
        }}
        onNextSetlistPiece={() => {
          if (
            setlist &&
            onSelectSetlistScore &&
            setlistIndex < setlistScores.length - 1
          ) {
            onSelectSetlistScore(setlistIndex + 1, 1);
          }
        }}
        onPlaySavedPitch={onPlaySavedPitch}
        onOpenBookmarks={() => setBookmarksOpen(true)}
        onSelectCropMode={handleSelectCropMode}
        onOpenManualCropEditor={enterManualCrop}
        onOpenSettings={onOpenSettings}
        onToggleAnnotating={() => setAnnotating(!isAnnotating)}
        onToggleShowAnnotations={() => setShowAnnotations(!showAnnotations)}
        onToggleMetronome={() => setMetronomeOpen(!metronomeOpen)}
        onTogglePiano={() => setPianoOpen(!pianoOpen)}
        onToggleHalfPageMode={() => {
          setHalfPageMode((prev) => {
            if (prev) setHalfTurnPending(false);
            return !prev;
          });
        }}
        onResetZoom={resetZoom}
        onHudHeightsChange={handleHudHeightsChange}
      />

      {isAnnotating && annotationToolbarSlot && (
        <div
          className="reader-slot-toolbar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {annotationToolbarSlot}
        </div>
      )}

      {metronomeOpen && metronomeSlot && (
        <div
          className={`reader-slot-top-floating ${hudVisible && !isCropping && !isAnnotating ? 'has-hud' : ''}`}
          style={
            hudVisible && !isCropping && !isAnnotating && hudHeights.top > 0
              ? { top: Math.round(hudHeights.top + 8) }
              : undefined
          }
          onPointerDown={(e) => e.stopPropagation()}
        >
          {metronomeSlot}
        </div>
      )}

      {pianoOpen && pianoSlot && (
        <div
          className={`reader-slot-bottom-floating ${hudVisible && !isCropping && !isAnnotating ? 'has-hud' : ''}`}
          style={
            hudVisible && !isCropping && !isAnnotating && hudHeights.bottom > 0
              ? { bottom: Math.round(hudHeights.bottom + 8) }
              : undefined
          }
          onPointerDown={(e) => e.stopPropagation()}
        >
          {pianoSlot}
        </div>
      )}

      {bookmarksOpen && (
        <div
          className="bookmarks-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t.reader.bookmarks}
          onClick={(e) => {
            if (e.target === e.currentTarget) setBookmarksOpen(false);
          }}
        >
          <div className="bookmarks-drawer">
            <div className="bookmarks-drawer-head">
              <h2>{t.reader.bookmarks}</h2>
              <button
                type="button"
                className="hud-btn hud-btn-icon"
                onClick={() => setBookmarksOpen(false)}
                aria-label={t.common.close}
              >
                <X size={20} />
              </button>
            </div>

            <form className="bookmark-add-form" onSubmit={handleAddBookmark}>
              <input
                type="text"
                value={bookmarkDraft}
                onChange={(e) => setBookmarkDraft(e.target.value)}
                placeholder={t.reader.bookmarkPlaceholder}
                aria-label={t.reader.addBookmark}
              />
              <button type="submit" className="hud-btn is-active">
                <BookmarkPlus size={18} />
                <span>{t.common.add}</span>
              </button>
            </form>

            <div
              className="scroll-area"
              style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}
            >
              {bookmarks.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  {t.reader.noBookmarks}
                </p>
              ) : (
                bookmarks.map((bm) => (
                  <div key={bm.id} className="bookmark-item">
                    <button
                      type="button"
                      className="bookmark-jump-btn"
                      onClick={() => {
                        jumpToPage(bm.pageNum);
                        setBookmarksOpen(false);
                      }}
                    >
                      <Bookmark size={16} color="var(--accent)" />
                      <span style={{ flex: 1, fontWeight: 600 }}>{bm.label}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                        {formatMessage(t.common.pageShort, {
                          page: bm.pageNum,
                          total: pageCount,
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="hud-btn hud-btn-icon"
                      aria-label={t.common.delete}
                      onClick={() => void handleDeleteBookmark(bm.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
