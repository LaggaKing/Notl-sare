import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pencil, Trash2 } from 'lucide-react';
import './annotations.css';
import type {
  AnnotationItem,
  AppLanguage,
  NormalizedPoint,
  PageAnnotations,
  ShapeAnnotation,
  StampAnnotation,
  StrokeAnnotation,
  TextAnnotation,
} from '../../types';
import {
  DEFAULT_PAGE_ASPECT,
  HIGHLIGHTER_WIDTH_PRESETS,
  PEN_WIDTH_PRESETS,
  STAMP_SCALE_PRESETS,
  TEXT_SIZE_PRESETS,
  clamp01,
  computeBracketPoints,
  computeDefaultSlurControl,
  computeItemBounds,
  createAnnotationId,
  estimateTextMetrics,
  hitTestItem,
  smoothStrokePoints,
  svgPathForPoints,
  translateAnnotationItem,
  type AnnotationToolState,
} from './geometry';
import { getAnnotationTranslations } from './i18n';
import { renderStampPrimitives } from './StampPalette';
import { getStampDefinition } from './stamps';

export { smoothStrokePoints, hitTestItem, svgPathForPoints };

const VB_WIDTH = 1000;

export interface PinchPanPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface AnnotationCanvasProps {
  pageAnnotations: PageAnnotations;
  onChange: (next: PageAnnotations) => void;
  toolState: AnnotationToolState;
  activeLayerId: string;
  active: boolean;
  showAllAnnotations: boolean;
  language: AppLanguage;
  pageWidth?: number;
  pageHeight?: number;
  onPinchPanStart?: (pointers: PinchPanPointer[]) => void;
  onPinchPanMove?: (pointers: PinchPanPointer[]) => void;
  onPinchPanEnd?: () => void;
  className?: string;
}

type DraftInteraction =
  | {
      type: 'stroke';
      startClientX: number;
      startClientY: number;
      startTime: number;
      maxMovePx: number;
      item: StrokeAnnotation;
    }
  | {
      type: 'shape';
      startClientX: number;
      startClientY: number;
      startTime: number;
      maxMovePx: number;
      item: ShapeAnnotation;
    }
  | {
      type: 'stamp';
      startClientX: number;
      startClientY: number;
      startTime: number;
      maxMovePx: number;
      item: StampAnnotation;
    }
  | {
      type: 'erase';
      erasedIds: Set<string>;
    }
  | {
      type: 'move';
      itemId: string;
      originNorm: NormalizedPoint;
      baseItem: AnnotationItem;
      moved: boolean;
      latestPreviewItem?: AnnotationItem;
    }
  | {
      type: 'resize-stamp';
      itemId: string;
      centerNorm: NormalizedPoint;
      baseStamp: StampAnnotation;
      startDist: number;
      startScale: number;
      latestPreviewItem?: StampAnnotation;
    }
  | {
      type: 'pending-text';
      startClientX: number;
      startClientY: number;
      norm: NormalizedPoint;
      moved: boolean;
    };

interface TextEditorState {
  itemId: string | null;
  position: NormalizedPoint;
  text: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

const SAFE_HEX_COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SAFE_RGB_COLOR_RE =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/;

export function sanitizeAnnotationColor(
  value: string | undefined,
  fallback = '#141416',
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (SAFE_HEX_COLOR_RE.test(trimmed)) {
    return trimmed;
  }
  const rgbMatch = SAFE_RGB_COLOR_RE.exec(trimmed);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (r <= 255 && g <= 255 && b <= 255) {
      return trimmed;
    }
  }
  return fallback;
}

export const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({
  pageAnnotations,
  onChange,
  toolState,
  activeLayerId,
  active,
  showAllAnnotations,
  language,
  pageWidth,
  pageHeight,
  onPinchPanStart,
  onPinchPanMove,
  onPinchPanEnd,
  className,
}) => {
  const t = getAnnotationTranslations(language);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(
    new Map()
  );
  const gestureLockedRef = useRef(false);
  const isPinchingRef = useRef(false);
  const interactionRef = useRef<DraftInteraction | null>(null);

  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number }>({
    width: pageWidth && pageWidth > 0 ? pageWidth : 1000,
    height:
      pageHeight && pageHeight > 0
        ? pageHeight
        : 1000 * DEFAULT_PAGE_ASPECT,
  });

  const [draftItem, setDraftItem] = useState<AnnotationItem | null>(null);
  const [draftMoveItem, setDraftMoveItem] = useState<AnnotationItem | null>(null);
  const [pendingErasedIds, setPendingErasedIds] = useState<Set<string>>(() => new Set());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditorRef = useRef<TextEditorState | null>(null);
  textEditorRef.current = textEditor;
  const commitTextEditorRef = useRef<() => void>(() => {});
  const prevActiveRef = useRef(active);

  useEffect(() => {
    if (pageWidth && pageWidth > 0 && pageHeight && pageHeight > 0) {
      setMeasuredSize({ width: pageWidth, height: pageHeight });
      return;
    }
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        setMeasuredSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageWidth, pageHeight]);

  // Reset transient editing states when switching pages or exiting annotation mode
  useEffect(() => {
    setSelectedItemId(null);
    setTextEditor(null);
    setDraftItem(null);
    setDraftMoveItem(null);
    setPendingErasedIds(new Set());
    interactionRef.current = null;
    activePointersRef.current.clear();
    gestureLockedRef.current = false;
    isPinchingRef.current = false;
  }, [pageAnnotations.scoreId, pageAnnotations.pageNum]);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;
    if (wasActive && !active) {
      if (textEditorRef.current && textEditorRef.current.text.trim()) {
        commitTextEditorRef.current();
      }
      setSelectedItemId(null);
      setTextEditor(null);
      setDraftItem(null);
      setDraftMoveItem(null);
      setPendingErasedIds(new Set());
      interactionRef.current = null;
      activePointersRef.current.clear();
      gestureLockedRef.current = false;
      isPinchingRef.current = false;
    } else if (!active) {
      setSelectedItemId(null);
      setTextEditor(null);
      setDraftItem(null);
      setDraftMoveItem(null);
      setPendingErasedIds(new Set());
      interactionRef.current = null;
      activePointersRef.current.clear();
      gestureLockedRef.current = false;
      isPinchingRef.current = false;
    }
  }, [active]);

  useEffect(() => {
    const clearPointersOnBlur = () => {
      if (isPinchingRef.current) {
        isPinchingRef.current = false;
        onPinchPanEnd?.();
      }
      activePointersRef.current.clear();
      gestureLockedRef.current = false;
    };
    window.addEventListener('blur', clearPointersOnBlur);
    return () => window.removeEventListener('blur', clearPointersOnBlur);
  }, [onPinchPanEnd]);

  const hasTextEditor = Boolean(textEditor);
  const textEditorItemId = textEditor?.itemId ?? null;
  useEffect(() => {
    if (hasTextEditor) {
      const timer = window.setTimeout(() => {
        textInputRef.current?.focus();
      }, 20);
      return () => window.clearTimeout(timer);
    }
  }, [hasTextEditor, textEditorItemId]);

  const pageAspect =
    measuredSize.width > 0 && measuredSize.height > 0
      ? measuredSize.height / measuredSize.width
      : DEFAULT_PAGE_ASPECT;
  const vbHeight = VB_WIDTH * pageAspect;

  const layerMap = useMemo(
    () => new Map(pageAnnotations.layers.map((l) => [l.id, l])),
    [pageAnnotations.layers]
  );

  const visibleItems = useMemo(() => {
    if (!showAllAnnotations) return [];
    return pageAnnotations.items
      .filter((item) => {
        if (pendingErasedIds.has(item.id)) return false;
        const layer = layerMap.get(item.layerId);
        return layer ? layer.visible : pageAnnotations.layers.length === 0;
      })
      .map((item) =>
        draftMoveItem && draftMoveItem.id === item.id ? draftMoveItem : item
      );
  }, [
    showAllAnnotations,
    pageAnnotations.items,
    pageAnnotations.layers.length,
    layerMap,
    pendingErasedIds,
    draftMoveItem,
  ]);

  const isItemEditable = useCallback(
    (item: AnnotationItem): boolean => {
      const layer = layerMap.get(item.layerId);
      if (!layer) return pageAnnotations.layers.length === 0;
      return layer.visible && !layer.locked;
    },
    [layerMap, pageAnnotations.layers.length]
  );

  const resolveWritableLayerId = useCallback((): string => {
    const activeLayer = layerMap.get(activeLayerId);
    if (activeLayer && !activeLayer.locked) return activeLayer.id;
    const firstUnlocked = pageAnnotations.layers.find((l) => !l.locked);
    return firstUnlocked?.id ?? activeLayerId ?? 'default';
  }, [layerMap, activeLayerId, pageAnnotations.layers]);

  const commitPageChange = useCallback(
    (nextItems: AnnotationItem[], targetLayerIdToShow?: string) => {
      let nextLayers = pageAnnotations.layers;
      if (targetLayerIdToShow) {
        const target = nextLayers.find((l) => l.id === targetLayerIdToShow);
        if (target && !target.visible) {
          nextLayers = nextLayers.map((l) =>
            l.id === targetLayerIdToShow ? { ...l, visible: true } : l
          );
        }
      }
      onChange({
        ...pageAnnotations,
        layers: nextLayers,
        items: nextItems,
        updatedAt: nowIso(),
      });
    },
    [onChange, pageAnnotations]
  );

  const toNormalizedPoint = useCallback(
    (clientX: number, clientY: number): NormalizedPoint => {
      const el = containerRef.current;
      if (!el) return { x: 0.5, y: 0.5 };
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
      return {
        x: clamp01((clientX - rect.left) / rect.width),
        y: clamp01((clientY - rect.top) / rect.height),
      };
    },
    []
  );

  const getPinchPanPointers = useCallback((): PinchPanPointer[] => {
    return Array.from(activePointersRef.current.entries()).map(([pointerId, p]) => ({
      pointerId,
      clientX: p.clientX,
      clientY: p.clientY,
    }));
  }, []);

  const findTopHitItem = useCallback(
    (norm: NormalizedPoint, kindFilter?: AnnotationItem['kind']): AnnotationItem | null => {
      for (let i = visibleItems.length - 1; i >= 0; i--) {
        const item = visibleItems[i];
        if (kindFilter && item.kind !== kindFilter) continue;
        if (!isItemEditable(item)) continue;
        if (hitTestItem(item, norm, 0.025, pageAspect)) {
          return item;
        }
      }
      return null;
    },
    [visibleItems, isItemEditable, pageAspect]
  );

  const abortOrCommitOnMultiTouch = useCallback(() => {
    const interaction = interactionRef.current;
    if (interaction && interaction.type === 'stroke') {
      const elapsed = performance.now() - interaction.startTime;
      if (interaction.maxMovePx >= 8 && elapsed >= 60) {
        const smoothed = smoothStrokePoints(interaction.item.points);
        commitPageChange(
          [...pageAnnotations.items, { ...interaction.item, points: smoothed }],
          interaction.item.layerId
        );
      }
    }
    interactionRef.current = null;
    setDraftItem(null);
    setDraftMoveItem(null);
    setPendingErasedIds(new Set());
  }, [commitPageChange, pageAnnotations.items]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events in tests may not support pointer capture
      }

      if (activePointersRef.current.size >= 2) {
        abortOrCommitOnMultiTouch();
        gestureLockedRef.current = true;
        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          onPinchPanStart?.(getPinchPanPointers());
        }
        return;
      }

      if (gestureLockedRef.current) return;

      if (textEditor) {
        if (textEditor.text.trim().length > 0) {
          commitTextEditorRef.current();
        } else {
          setTextEditor(null);
        }
        return;
      }

      if (!showAllAnnotations) {
        return;
      }

      const norm = toNormalizedPoint(e.clientX, e.clientY);
      const targetLayerId = resolveWritableLayerId();
      const now = performance.now();

      switch (toolState.tool) {
        case 'highlighter':
        case 'pen': {
          setSelectedItemId(null);
          const isHighlighter = toolState.tool === 'highlighter';
          const stroke: StrokeAnnotation = {
            kind: 'stroke',
            id: createAnnotationId('stroke'),
            layerId: targetLayerId,
            tool: toolState.tool,
            points: [
              {
                x: norm.x,
                y: norm.y,
                ...(e.pressure > 0 && e.pressure < 1 ? { p: e.pressure } : {}),
              },
            ],
            color: isHighlighter ? toolState.highlighterColor : toolState.penColor,
            width: isHighlighter
              ? HIGHLIGHTER_WIDTH_PRESETS[toolState.highlighterSize]
              : PEN_WIDTH_PRESETS[toolState.penSize],
            opacity: isHighlighter ? 0.48 : 1,
            multiply: isHighlighter,
          };
          interactionRef.current = {
            type: 'stroke',
            startClientX: e.clientX,
            startClientY: e.clientY,
            startTime: now,
            maxMovePx: 0,
            item: stroke,
          };
          setDraftItem(stroke);
          break;
        }
        case 'shape': {
          setSelectedItemId(null);
          const shape: ShapeAnnotation = {
            kind: 'shape',
            id: createAnnotationId('shape'),
            layerId: targetLayerId,
            shapeType: toolState.shapeType,
            start: norm,
            end: norm,
            ...(toolState.shapeType === 'slur'
              ? { control: computeDefaultSlurControl(norm, norm, pageAspect) }
              : {}),
            color: toolState.shapeColor,
            width: PEN_WIDTH_PRESETS[toolState.shapeSize],
          };
          interactionRef.current = {
            type: 'shape',
            startClientX: e.clientX,
            startClientY: e.clientY,
            startTime: now,
            maxMovePx: 0,
            item: shape,
          };
          setDraftItem(shape);
          break;
        }
        case 'stamp': {
          setSelectedItemId(null);
          const stamp: StampAnnotation = {
            kind: 'stamp',
            id: createAnnotationId('stamp'),
            layerId: targetLayerId,
            stampType: toolState.stampType,
            position: norm,
            scale: STAMP_SCALE_PRESETS[toolState.stampSize],
            color: toolState.stampColor,
          };
          interactionRef.current = {
            type: 'stamp',
            startClientX: e.clientX,
            startClientY: e.clientY,
            startTime: now,
            maxMovePx: 0,
            item: stamp,
          };
          setDraftItem(stamp);
          break;
        }
        case 'eraser': {
          setSelectedItemId(null);
          const erasedIds = new Set<string>();
          const hit = findTopHitItem(norm);
          if (hit) {
            erasedIds.add(hit.id);
            setPendingErasedIds(new Set(erasedIds));
          }
          interactionRef.current = {
            type: 'erase',
            erasedIds,
          };
          break;
        }
        case 'select': {
          const hit = findTopHitItem(norm);
          if (hit) {
            setSelectedItemId(hit.id);
            interactionRef.current = {
              type: 'move',
              itemId: hit.id,
              originNorm: norm,
              baseItem: hit,
              moved: false,
            };
          } else {
            setSelectedItemId(null);
            interactionRef.current = null;
          }
          break;
        }
        case 'text': {
          const hitText = findTopHitItem(norm, 'text');
          if (hitText) {
            setSelectedItemId(hitText.id);
            interactionRef.current = {
              type: 'move',
              itemId: hitText.id,
              originNorm: norm,
              baseItem: hitText,
              moved: false,
            };
          } else {
            setSelectedItemId(null);
            interactionRef.current = {
              type: 'pending-text',
              startClientX: e.clientX,
              startClientY: e.clientY,
              norm,
              moved: false,
            };
          }
          break;
        }
      }
    },
    [
      active,
      showAllAnnotations,
      abortOrCommitOnMultiTouch,
      onPinchPanStart,
      getPinchPanPointers,
      textEditor,
      toNormalizedPoint,
      resolveWritableLayerId,
      toolState,
      pageAspect,
      findTopHitItem,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active) return;
      if (!activePointersRef.current.has(e.pointerId)) return;

      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (gestureLockedRef.current) {
        if (activePointersRef.current.size >= 2) {
          onPinchPanMove?.(getPinchPanPointers());
        }
        return;
      }

      const interaction = interactionRef.current;
      if (!interaction) return;

      const norm = toNormalizedPoint(e.clientX, e.clientY);

      switch (interaction.type) {
        case 'stroke': {
          const distPx = Math.hypot(
            e.clientX - interaction.startClientX,
            e.clientY - interaction.startClientY
          );
          if (distPx > interaction.maxMovePx) {
            interaction.maxMovePx = distPx;
          }
          const pts = interaction.item.points;
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(norm.x - last.x, norm.y - last.y) >= 0.0012) {
            const nextItem: StrokeAnnotation = {
              ...interaction.item,
              points: [
                ...pts,
                {
                  x: norm.x,
                  y: norm.y,
                  ...(e.pressure > 0 && e.pressure < 1 ? { p: e.pressure } : {}),
                },
              ],
            };
            interaction.item = nextItem;
            setDraftItem(nextItem);
          }
          break;
        }
        case 'shape': {
          const distPx = Math.hypot(
            e.clientX - interaction.startClientX,
            e.clientY - interaction.startClientY
          );
          if (distPx > interaction.maxMovePx) {
            interaction.maxMovePx = distPx;
          }
          const nextItem: ShapeAnnotation = {
            ...interaction.item,
            end: norm,
            ...(interaction.item.shapeType === 'slur'
              ? {
                  control: computeDefaultSlurControl(
                    interaction.item.start,
                    norm,
                    pageAspect
                  ),
                }
              : {}),
          };
          interaction.item = nextItem;
          setDraftItem(nextItem);
          break;
        }
        case 'stamp': {
          const distPx = Math.hypot(
            e.clientX - interaction.startClientX,
            e.clientY - interaction.startClientY
          );
          if (distPx > interaction.maxMovePx) {
            interaction.maxMovePx = distPx;
          }
          const nextItem: StampAnnotation = {
            ...interaction.item,
            position: norm,
          };
          interaction.item = nextItem;
          setDraftItem(nextItem);
          break;
        }
        case 'erase': {
          for (let i = visibleItems.length - 1; i >= 0; i--) {
            const candidate = visibleItems[i];
            if (interaction.erasedIds.has(candidate.id)) continue;
            if (!isItemEditable(candidate)) continue;
            if (hitTestItem(candidate, norm, 0.025, pageAspect)) {
              interaction.erasedIds.add(candidate.id);
              setPendingErasedIds(new Set(interaction.erasedIds));
            }
          }
          break;
        }
        case 'move': {
          const dx = norm.x - interaction.originNorm.x;
          const dy = norm.y - interaction.originNorm.y;
          if (Math.hypot(dx, dy * pageAspect) > 0.004) {
            interaction.moved = true;
          }
          if (interaction.moved) {
            const movedItem = translateAnnotationItem(interaction.baseItem, dx, dy);
            interaction.latestPreviewItem = movedItem;
            setDraftMoveItem(movedItem);
          }
          break;
        }
        case 'resize-stamp': {
          const currentDist = Math.hypot(
            norm.x - interaction.centerNorm.x,
            (norm.y - interaction.centerNorm.y) * pageAspect
          );
          const ratio = currentDist / Math.max(0.015, interaction.startDist);
          const nextScale = Math.max(
            0.4,
            Math.min(3.5, Number((interaction.startScale * ratio).toFixed(3)))
          );
          const resized: StampAnnotation = {
            ...interaction.baseStamp,
            scale: nextScale,
          };
          interaction.latestPreviewItem = resized;
          setDraftMoveItem(resized);
          break;
        }
        case 'pending-text': {
          if (
            Math.hypot(
              e.clientX - interaction.startClientX,
              e.clientY - interaction.startClientY
            ) > 10
          ) {
            interaction.moved = true;
          }
          break;
        }
      }
    },
    [
      active,
      onPinchPanMove,
      getPinchPanPointers,
      toNormalizedPoint,
      pageAspect,
      visibleItems,
      isItemEditable,
    ]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const wasTracked = activePointersRef.current.has(e.pointerId);
      activePointersRef.current.delete(e.pointerId);
      try {
        if (containerRef.current?.hasPointerCapture(e.pointerId)) {
          containerRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore synthetic test events
      }

      if (!wasTracked) return;

      if (gestureLockedRef.current) {
        if (isPinchingRef.current && activePointersRef.current.size < 2) {
          isPinchingRef.current = false;
          onPinchPanEnd?.();
        }
        if (activePointersRef.current.size === 0) {
          gestureLockedRef.current = false;
          isPinchingRef.current = false;
        }
        return;
      }

      const interaction = interactionRef.current;
      interactionRef.current = null;
      if (!interaction) return;

      if (e.type === 'pointercancel') {
        setDraftItem(null);
        setDraftMoveItem(null);
        setPendingErasedIds(new Set());
        return;
      }

      switch (interaction.type) {
        case 'stroke': {
          const smoothed = smoothStrokePoints(interaction.item.points);
          setDraftItem(null);
          commitPageChange(
            [...pageAnnotations.items, { ...interaction.item, points: smoothed }],
            interaction.item.layerId
          );
          break;
        }
        case 'shape': {
          const { start, end } = interaction.item;
          const span = Math.hypot(end.x - start.x, (end.y - start.y) * pageAspect);
          setDraftItem(null);
          if (span >= 0.008) {
            commitPageChange(
              [...pageAnnotations.items, interaction.item],
              interaction.item.layerId
            );
          }
          break;
        }
        case 'stamp': {
          setDraftItem(null);
          commitPageChange(
            [...pageAnnotations.items, interaction.item],
            interaction.item.layerId
          );
          break;
        }
        case 'erase': {
          const erased = interaction.erasedIds;
          setPendingErasedIds(new Set());
          if (erased.size > 0) {
            commitPageChange(
              pageAnnotations.items.filter((item) => !erased.has(item.id))
            );
          }
          break;
        }
        case 'move': {
          const preview = interaction.latestPreviewItem;
          setDraftMoveItem(null);
          if (interaction.moved && preview && preview.id === interaction.itemId) {
            commitPageChange(
              pageAnnotations.items.map((item) =>
                item.id === preview.id ? preview : item
              )
            );
          } else if (
            !interaction.moved &&
            toolState.tool === 'text' &&
            interaction.baseItem.kind === 'text'
          ) {
            setTextEditor({
              itemId: interaction.baseItem.id,
              position: interaction.baseItem.position,
              text: interaction.baseItem.text,
            });
          }
          break;
        }
        case 'resize-stamp': {
          const preview = interaction.latestPreviewItem;
          setDraftMoveItem(null);
          if (preview && preview.id === interaction.itemId) {
            commitPageChange(
              pageAnnotations.items.map((item) =>
                item.id === preview.id ? preview : item
              )
            );
          }
          break;
        }
        case 'pending-text': {
          if (!interaction.moved) {
            setTextEditor({
              itemId: null,
              position: {
                x: Math.min(0.82, interaction.norm.x),
                y: Math.min(0.9, interaction.norm.y),
              },
              text: '',
            });
          }
          break;
        }
      }
    },
    [
      onPinchPanEnd,
      commitPageChange,
      pageAnnotations.items,
      pageAspect,
      toolState.tool,
    ]
  );

  const handleDeleteSelected = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedItemId) return;
      const targetId = selectedItemId;
      setSelectedItemId(null);
      commitPageChange(pageAnnotations.items.filter((item) => item.id !== targetId));
    },
    [selectedItemId, commitPageChange, pageAnnotations.items]
  );

  const handleResizeHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, stamp: StampAnnotation) => {
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic test events
      }
      const norm = toNormalizedPoint(e.clientX, e.clientY);
      const startDist = Math.hypot(
        norm.x - stamp.position.x,
        (norm.y - stamp.position.y) * pageAspect
      );
      interactionRef.current = {
        type: 'resize-stamp',
        itemId: stamp.id,
        centerNorm: stamp.position,
        baseStamp: stamp,
        startDist,
        startScale: stamp.scale,
      };
    },
    [toNormalizedPoint, pageAspect]
  );

  const handleSaveTextEditor = useCallback(() => {
    if (!textEditor) return;
    const trimmed = textEditor.text.trim();
    if (!trimmed) {
      if (textEditor.itemId) {
        commitPageChange(
          pageAnnotations.items.filter((item) => item.id !== textEditor.itemId)
        );
      }
      setTextEditor(null);
      return;
    }

    if (textEditor.itemId) {
      commitPageChange(
        pageAnnotations.items.map((item) =>
          item.id === textEditor.itemId && item.kind === 'text'
            ? { ...item, text: trimmed }
            : item
        )
      );
    } else {
      const targetLayerId = resolveWritableLayerId();
      const newText: TextAnnotation = {
        kind: 'text',
        id: createAnnotationId('text'),
        layerId: targetLayerId,
        position: textEditor.position,
        text: trimmed,
        fontSize: TEXT_SIZE_PRESETS[toolState.textSize],
        color: toolState.textColor,
        bgColor: '#fcfbf7',
      };
      commitPageChange([...pageAnnotations.items, newText], targetLayerId);
    }
    setTextEditor(null);
  }, [
    textEditor,
    commitPageChange,
    pageAnnotations.items,
    resolveWritableLayerId,
    toolState.textSize,
    toolState.textColor,
  ]);

  commitTextEditorRef.current = handleSaveTextEditor;

  useEffect(() => {
    if (!active || !selectedItemId || textEditor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      const targetId = selectedItemId;
      setSelectedItemId(null);
      commitPageChange(pageAnnotations.items.filter((item) => item.id !== targetId));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, selectedItemId, textEditor, commitPageChange, pageAnnotations.items]);

  const highlighterItems = useMemo(() => {
    const base = visibleItems.filter(
      (i): i is StrokeAnnotation => i.kind === 'stroke' && i.tool === 'highlighter'
    );
    if (
      draftItem &&
      draftItem.kind === 'stroke' &&
      draftItem.tool === 'highlighter'
    ) {
      return [...base, draftItem];
    }
    return base;
  }, [visibleItems, draftItem]);

  const foregroundItems = useMemo(() => {
    const base = visibleItems.filter(
      (i) => !(i.kind === 'stroke' && i.tool === 'highlighter')
    );
    if (
      draftItem &&
      !(draftItem.kind === 'stroke' && draftItem.tool === 'highlighter')
    ) {
      return [...base, draftItem];
    }
    return base;
  }, [visibleItems, draftItem]);

  const selectedItem = useMemo(() => {
    if (!active || !selectedItemId) return null;
    return visibleItems.find((item) => item.id === selectedItemId) ?? null;
  }, [active, selectedItemId, visibleItems]);

  const selectedBounds = useMemo(() => {
    if (!selectedItem) return null;
    return computeItemBounds(selectedItem, pageAspect);
  }, [selectedItem, pageAspect]);

  const renderShape = (shape: ShapeAnnotation) => {
    const strokeW = shape.width * VB_WIDTH;
    const strokeColor = sanitizeAnnotationColor(shape.color);
    const x1 = shape.start.x * VB_WIDTH;
    const y1 = shape.start.y * vbHeight;
    const x2 = shape.end.x * VB_WIDTH;
    const y2 = shape.end.y * vbHeight;

    switch (shape.shapeType) {
      case 'line':
        return (
          <line
            key={shape.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        );
      case 'bracket': {
        const pts = computeBracketPoints(shape.start, shape.end);
        const d = pts
          .map(
            (p, idx) =>
              `${idx === 0 ? 'M' : 'L'} ${(p.x * VB_WIDTH).toFixed(2)} ${(p.y * vbHeight).toFixed(2)}`
          )
          .join(' ');
        return (
          <path
            key={shape.id}
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      }
      case 'circle': {
        const r = Math.hypot(x2 - x1, y2 - y1);
        return (
          <circle
            key={shape.id}
            cx={x1}
            cy={y1}
            r={r}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeW}
          />
        );
      }
      case 'oval': {
        const cx = (x1 + x2) * 0.5;
        const cy = (y1 + y2) * 0.5;
        const rx = Math.abs(x2 - x1) * 0.5;
        const ry = Math.abs(y2 - y1) * 0.5;
        return (
          <ellipse
            key={shape.id}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeW}
          />
        );
      }
      case 'slur': {
        const ctrl =
          shape.control ??
          computeDefaultSlurControl(shape.start, shape.end, pageAspect);
        const cx = ctrl.x * VB_WIDTH;
        const cy = ctrl.y * vbHeight;
        return (
          <path
            key={shape.id}
            d={`M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        );
      }
    }
  };

  const renderStamp = (stamp: StampAnnotation) => {
    const def = getStampDefinition(stamp.stampType);
    const renderedW = VB_WIDTH * def.baseWidthRatio * stamp.scale;
    const scaleFactor = renderedW / def.width;
    const cx = stamp.position.x * VB_WIDTH;
    const cy = stamp.position.y * vbHeight;
    const rot = stamp.rotation ?? 0;
    const stampColor = sanitizeAnnotationColor(stamp.color);

    return (
      <g
        key={stamp.id}
        transform={`translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) rotate(${rot}) scale(${scaleFactor.toFixed(4)})`}
        style={{ color: stampColor }}
      >
        {renderStampPrimitives(def.primitives)}
      </g>
    );
  };

  const renderText = (item: TextAnnotation) => {
    const fontSizeSvg = item.fontSize * VB_WIDTH;
    const { width, height, lines, lineHeightNormY } = estimateTextMetrics(
      item,
      pageAspect
    );
    const xSvg = item.position.x * VB_WIDTH;
    const ySvg = item.position.y * vbHeight;
    const boxW = width * VB_WIDTH;
    const boxH = height * vbHeight;
    const lineHeightSvg = lineHeightNormY * vbHeight;
    const padX = fontSizeSvg * 0.25;
    const textColor = sanitizeAnnotationColor(item.color);
    const bgColor = item.bgColor
      ? sanitizeAnnotationColor(item.bgColor, '#fcfbf7')
      : undefined;

    return (
      <g key={item.id}>
        {bgColor && (
          <rect
            x={xSvg - padX}
            y={ySvg}
            width={boxW}
            height={boxH}
            rx={fontSizeSvg * 0.22}
            fill={bgColor}
            fillOpacity={0.9}
            stroke={textColor}
            strokeOpacity={0.22}
            strokeWidth={1.2}
          />
        )}
        {lines.map((line, idx) => (
          <text
            key={idx}
            x={xSvg}
            y={ySvg + fontSizeSvg * 0.92 + idx * lineHeightSvg}
            fill={textColor}
            fontSize={fontSizeSvg}
            fontWeight={600}
            fontFamily='var(--font-sans, "Segoe UI", sans-serif)'
            dominantBaseline="alphabetic"
          >
            {line}
          </text>
        ))}
      </g>
    );
  };

  if (!showAllAnnotations && !active) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`notlasare-annotation-root ${active ? 'notlasare-annotation-root--active' : ''} ${className ?? ''}`}
      data-annotation-active={active ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      {/* Dedicated multiply-blended highlighter layer so black staff lines & lyrics stay crisp */}
      {showAllAnnotations && (
        <svg
          className="notlasare-annotation-svg notlasare-annotation-svg--highlighter"
          viewBox={`0 0 ${VB_WIDTH} ${vbHeight.toFixed(2)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {highlighterItems.map((stroke) => (
            <path
              key={stroke.id}
              d={svgPathForPoints(stroke.points, VB_WIDTH, vbHeight)}
              fill="none"
              stroke={sanitizeAnnotationColor(stroke.color, '#f7c948')}
              strokeWidth={stroke.width * VB_WIDTH}
              strokeOpacity={stroke.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      )}

      {/* Pen strokes, shapes, stamps, and text annotations */}
      {showAllAnnotations && (
        <svg
          className={`notlasare-annotation-svg ${active ? 'notlasare-annotation-svg--interactive' : ''}`}
          viewBox={`0 0 ${VB_WIDTH} ${vbHeight.toFixed(2)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {foregroundItems.map((item) => {
            switch (item.kind) {
              case 'stroke':
                return (
                  <path
                    key={item.id}
                    d={svgPathForPoints(item.points, VB_WIDTH, vbHeight)}
                    fill="none"
                    stroke={sanitizeAnnotationColor(item.color)}
                    strokeWidth={item.width * VB_WIDTH}
                    strokeOpacity={item.opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              case 'shape':
                return renderShape(item);
              case 'stamp':
                return renderStamp(item);
              case 'text':
                return renderText(item);
            }
          })}
        </svg>
      )}

      {/* Selection bounding box & >=48px touch handles */}
      {active && selectedItem && selectedBounds && (
        <div className="notlasare-annotation-controls-layer">
          <div
            className="notlasare-selection-box"
            style={{
              left: `${clamp01(selectedBounds.minX) * 100}%`,
              top: `${clamp01(selectedBounds.minY) * 100}%`,
              width: `${Math.max(0.02, clamp01(selectedBounds.maxX) - clamp01(selectedBounds.minX)) * 100}%`,
              height: `${Math.max(0.02, clamp01(selectedBounds.maxY) - clamp01(selectedBounds.minY)) * 100}%`,
            }}
          />

          <button
            type="button"
            className="notlasare-selection-handle notlasare-selection-handle--delete"
            style={{
              left: `${clamp01(selectedBounds.maxX) * 100}%`,
              top: `${clamp01(selectedBounds.minY) * 100}%`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleDeleteSelected}
            aria-label={t.actions.deleteItem}
            title={t.actions.deleteItem}
          >
            <Trash2 size={20} />
          </button>

          {selectedItem.kind === 'stamp' && (
            <button
              type="button"
              className="notlasare-selection-handle notlasare-selection-handle--resize"
              style={{
                left: `${clamp01(selectedBounds.maxX) * 100}%`,
                top: `${clamp01(selectedBounds.maxY) * 100}%`,
              }}
              onPointerDown={(e) => handleResizeHandlePointerDown(e, selectedItem)}
              aria-label={t.actions.resizeStamp}
              title={t.actions.resizeStamp}
            >
              <Maximize2 size={18} />
            </button>
          )}

          {selectedItem.kind === 'text' && (
            <button
              type="button"
              className="notlasare-selection-handle notlasare-selection-handle--edit"
              style={{
                left: `${clamp01(selectedBounds.minX) * 100}%`,
                top: `${clamp01(selectedBounds.minY) * 100}%`,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setTextEditor({
                  itemId: selectedItem.id,
                  position: selectedItem.position,
                  text: selectedItem.text,
                });
              }}
              aria-label={t.actions.editText}
              title={t.actions.editText}
            >
              <Pencil size={18} />
            </button>
          )}
        </div>
      )}

      {/* Inline floating text popover */}
      {active && textEditor && (
        <div
          className="notlasare-text-popover"
          style={{
            left: `${Math.min(62, Math.max(3, textEditor.position.x * 100))}%`,
            top: `${Math.min(72, Math.max(4, textEditor.position.y * 100))}%`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textInputRef}
            className="notlasare-text-popover-input"
            rows={2}
            value={textEditor.text}
            placeholder={t.textEditor.placeholder}
            aria-label={t.textEditor.title}
            onChange={(e) =>
              setTextEditor((prev) => (prev ? { ...prev, text: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveTextEditor();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setTextEditor(null);
              }
            }}
          />
          <div className="notlasare-text-popover-actions">
            <button
              type="button"
              className="notlasare-btn-secondary"
              onClick={() => setTextEditor(null)}
            >
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="notlasare-btn-primary"
              onClick={handleSaveTextEditor}
            >
              {t.actions.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
