import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationLayer, AppLanguage, PageAnnotations } from '../../types';
import { getTranslations } from '../../i18n';
import {
  createAnnotationId,
  createDefaultAnnotationToolState,
  type AnnotationToolState,
} from './geometry';
import { getAnnotationTranslations } from './i18n';

const MAX_HISTORY_STEPS = 60;

export interface UseAnnotationSessionOptions {
  pageAnnotations: PageAnnotations;
  onCommit: (next: PageAnnotations) => void;
  language: AppLanguage;
  restoreEpoch?: number;
}

export interface AnnotationSession {
  normalizedAnnotations: PageAnnotations;
  toolState: AnnotationToolState;
  setToolState: (next: AnnotationToolState) => void;
  layers: AnnotationLayer[];
  activeLayerId: string;
  setActiveLayerId: (layerId: string) => void;
  addLayer: (name?: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  deleteLayer: (layerId: string) => void;
  clearPage: () => void;
  handleCanvasChange: (next: PageAnnotations) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  showAllAnnotations: boolean;
  setShowAllAnnotations: (visible: boolean) => void;
  toggleShowAllAnnotations: () => void;
}

export function useAnnotationSession({
  pageAnnotations,
  onCommit,
  language,
  restoreEpoch = 0,
}: UseAnnotationSessionOptions): AnnotationSession {
  const t = getAnnotationTranslations(language);
  const defaultLayerName = getTranslations(language).annotations.defaultLayerName;
  const [toolState, setToolState] = useState<AnnotationToolState>(() =>
    createDefaultAnnotationToolState()
  );
  const [activeLayerId, setActiveLayerId] = useState<string>('default');
  const [showAllAnnotations, setShowAllAnnotations] = useState<boolean>(true);
  const [past, setPast] = useState<PageAnnotations[]>([]);
  const [future, setFuture] = useState<PageAnnotations[]>([]);

  const pageKey = `${pageAnnotations.scoreId}:${pageAnnotations.pageNum}`;
  const prevPageKeyRef = useRef(pageKey);
  const prevRestoreEpochRef = useRef(restoreEpoch);

  useEffect(() => {
    if (
      prevPageKeyRef.current !== pageKey ||
      prevRestoreEpochRef.current !== restoreEpoch
    ) {
      prevPageKeyRef.current = pageKey;
      prevRestoreEpochRef.current = restoreEpoch;
      setPast([]);
      setFuture([]);
    }
  }, [pageKey, restoreEpoch]);

  const layers: AnnotationLayer[] = useMemo(() => {
    if (pageAnnotations.layers && pageAnnotations.layers.length > 0) {
      return pageAnnotations.layers.map((layer) =>
        layer.id === 'default' &&
        (layer.name === 'Anteckningar' || layer.name === 'Annotations')
          ? { ...layer, name: defaultLayerName }
          : layer
      );
    }
    return [{ id: 'default', name: defaultLayerName, visible: true }];
  }, [pageAnnotations.layers, defaultLayerName]);

  const normalizedAnnotations: PageAnnotations = useMemo(
    () => ({
      ...pageAnnotations,
      layers,
    }),
    [pageAnnotations, layers]
  );

  const effectiveActiveLayerId = useMemo(() => {
    if (layers.some((l) => l.id === activeLayerId)) {
      return activeLayerId;
    }
    return layers[0].id;
  }, [layers, activeLayerId]);

  const pushNext = useCallback(
    (next: PageAnnotations) => {
      setPast((prev) => [...prev.slice(-(MAX_HISTORY_STEPS - 1)), normalizedAnnotations]);
      setFuture([]);
      onCommit(next);
    },
    [normalizedAnnotations, onCommit]
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [normalizedAnnotations, ...prev]);
    onCommit(previous);
  }, [past, normalizedAnnotations, onCommit]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const [next, ...rest] = future;
    setFuture(rest);
    setPast((prev) => [...prev.slice(-(MAX_HISTORY_STEPS - 1)), normalizedAnnotations]);
    onCommit(next);
  }, [future, normalizedAnnotations, onCommit]);

  const addLayer = useCallback(
    (name?: string) => {
      const id = createAnnotationId('layer');
      const newLayer: AnnotationLayer = {
        id,
        name: name?.trim() || `${t.layers.newLayerPrefix} ${layers.length + 1}`,
        visible: true,
      };
      setActiveLayerId(id);
      pushNext({
        ...normalizedAnnotations,
        layers: [...layers, newLayer],
        updatedAt: new Date().toISOString(),
      });
    },
    [layers, normalizedAnnotations, pushNext, t.layers.newLayerPrefix]
  );

  const toggleLayerVisibility = useCallback(
    (layerId: string) => {
      pushNext({
        ...normalizedAnnotations,
        layers: layers.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        ),
        updatedAt: new Date().toISOString(),
      });
    },
    [layers, normalizedAnnotations, pushNext]
  );

  const renameLayer = useCallback(
    (layerId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      pushNext({
        ...normalizedAnnotations,
        layers: layers.map((l) =>
          l.id === layerId ? { ...l, name: trimmed } : l
        ),
        updatedAt: new Date().toISOString(),
      });
    },
    [layers, normalizedAnnotations, pushNext]
  );

  const deleteLayer = useCallback(
    (layerId: string) => {
      if (layers.length <= 1 || layerId === 'default') return;
      const nextLayers = layers.filter((l) => l.id !== layerId);
      const nextItems = normalizedAnnotations.items.filter(
        (item) => item.layerId !== layerId
      );
      if (effectiveActiveLayerId === layerId) {
        setActiveLayerId(nextLayers[0].id);
      }
      pushNext({
        ...normalizedAnnotations,
        layers: nextLayers,
        items: nextItems,
        updatedAt: new Date().toISOString(),
      });
    },
    [layers, normalizedAnnotations, effectiveActiveLayerId, pushNext]
  );

  const clearPage = useCallback(() => {
    if (normalizedAnnotations.items.length === 0) return;
    pushNext({
      ...normalizedAnnotations,
      items: [],
      updatedAt: new Date().toISOString(),
    });
  }, [normalizedAnnotations, pushNext]);

  const toggleShowAllAnnotations = useCallback(() => {
    setShowAllAnnotations((prev) => !prev);
  }, []);

  return {
    normalizedAnnotations,
    toolState,
    setToolState,
    layers,
    activeLayerId: effectiveActiveLayerId,
    setActiveLayerId,
    addLayer,
    toggleLayerVisibility,
    renameLayer,
    deleteLayer,
    clearPage,
    handleCanvasChange: pushNext,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    showAllAnnotations,
    setShowAllAnnotations,
    toggleShowAllAnnotations,
  };
}
