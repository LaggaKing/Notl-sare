import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  DEFAULT_APP_SETTINGS,
  type AnnotationLayer,
  type AppSettings,
  type LibraryFolder,
  type PageAnnotations,
  type SavedPitch,
  type ScoreMetadataPatch,
  type ScoreRecord,
  type Setlist,
  type TimeSignature,
} from './types';
import { formatMessage, getTranslations, I18nProvider } from './i18n';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LibraryView } from './components/library';
import {
  ReaderView,
  type AnnotationOverlayContext,
} from './components/reader';
import { SettingsModal } from './components/settings';
import {
  AnnotationCanvas,
  AnnotationToolbar,
  StampPalette,
  useAnnotationSession,
} from './components/annotations';
import { MetronomeOverlay, PianoOverlay } from './components/tools';
import { metronomeEngine, pianoEngine } from './audio';
import { EncryptedPdfError, exportAnnotatedPdf } from './services/pdfExport';
import {
  deleteScoreRecord,
  exportPdfWithDialog,
  getPageAnnotations,
  getScoreAnnotations,
  getSettings,
  isTauriEnv,
  listLibraryFolders,
  listScores,
  listSetlists,
  pickAndAddLibraryFolder,
  pickAndImportPdfFiles,
  readPdfBytes,
  removeLibraryFolder,
  sanitizeExportFilename,
  savePageAnnotations,
  saveSettings,
  scanLibrary,
  setWakeLock,
  updateScoreMetadata,
} from './services/tauriApi';

interface ActiveReaderSession {
  scoreId: string;
  initialPage?: number;
  setlistId: string | null;
  setlistIndex: number;
}

interface AppToast {
  message: string;
  isError: boolean;
}

function makeFallbackAnnotations(
  scoreId: string,
  pageNum: number,
  language: AppSettings['language'],
): PageAnnotations {
  return {
    scoreId,
    pageNum,
    layers: [
      {
        id: 'default',
        name: getTranslations(language).annotations.defaultLayerName,
        visible: true,
      },
    ],
    items: [],
    updatedAt: '',
  };
}

function annotationKey(scoreId: string, pageNum: number): string {
  return `${scoreId}::${pageNum}`;
}

/**
 * Merges a pre-load pending user edit onto freshly loaded page annotations
 * by layer ID and item ID so saved annotations on disk are never overwritten.
 */
function mergePageAnnotations(
  loaded: PageAnnotations,
  pending: PageAnnotations,
): PageAnnotations {
  const layerById = new Map<string, AnnotationLayer>();
  for (const l of loaded.layers) {
    layerById.set(l.id, l);
  }
  for (const l of pending.layers) {
    layerById.set(l.id, l);
  }

  const itemById = new Map(loaded.items.map((item) => [item.id, item]));
  for (const item of pending.items) {
    itemById.set(item.id, item);
  }

  return {
    scoreId: loaded.scoreId,
    pageNum: loaded.pageNum,
    layers: Array.from(layerById.values()),
    items: Array.from(itemById.values()),
    updatedAt: pending.updatedAt || loaded.updatedAt,
  };
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<AppToast | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreEpoch, setRestoreEpoch] = useState(0);

  // Active reader state
  const [readerSession, setReaderSession] = useState<ActiveReaderSession | null>(
    null,
  );
  const [readerPage, setReaderPage] = useState(1);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [metronomeOpen, setMetronomeOpen] = useState(false);
  const [pianoOpen, setPianoOpen] = useState(false);
  const [stampPaletteOpen, setStampPaletteOpen] = useState(false);
  const [toolbarDock, setToolbarDock] = useState<'top' | 'bottom'>('top');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Cached per-page annotations keyed by `${scoreId}::${pageNum}`
  const [annotationsByPage, setAnnotationsByPage] = useState<
    Record<string, PageAnnotations>
  >({});
  const [loadedAnnotationKeys, setLoadedAnnotationKeys] = useState<
    Record<string, true>
  >({});

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsRevRef = useRef(0);
  const scoreUpdateRevRef = useRef<Record<string, number>>({});
  const annotationSaveRevRef = useRef<Record<string, number>>({});
  const loadedAnnotationKeysRef = useRef<Set<string>>(new Set());
  const inFlightAnnotationKeysRef = useRef<Set<string>>(new Set());
  const pendingPreloadCommitsRef = useRef<Map<string, PageAnnotations>>(new Map());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, isError: boolean) => {
    setToast({ message, isError });
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 4500);
  }, []);

  const showErrorToast = useCallback(
    (message: string) => {
      showToast(message, true);
    },
    [showToast],
  );

  const showSuccessToast = useCallback(
    (message: string) => {
      showToast(message, false);
    },
    [showToast],
  );

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Apply theme, paper tint, language, and audio reference pitch globally
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.paperTint = settings.paperTint;
    document.documentElement.lang = settings.language;
    pianoEngine.setReferencePitchHz(settings.referencePitchHz);
  }, [settings]);

  const refreshLibraryData = useCallback(async () => {
    const [loadedSettings, loadedFolders, loadedScores, loadedSetlists] =
      await Promise.all([
        getSettings(),
        listLibraryFolders(),
        listScores(),
        listSetlists(),
      ]);
    setSettings(loadedSettings);
    setFolders(loadedFolders);
    setScores(loadedScores);
    setSetlists(loadedSetlists);
  }, []);

  useEffect(() => {
    void refreshLibraryData().catch(() => {
      // Keep safe defaults if initial load fails
    });
  }, [refreshLibraryData]);

  const activeScore = useMemo(() => {
    if (!readerSession) return null;
    return scores.find((s) => s.id === readerSession.scoreId) ?? null;
  }, [readerSession, scores]);

  const activeSetlist = useMemo(() => {
    if (!readerSession?.setlistId) return null;
    return setlists.find((sl) => sl.id === readerSession.setlistId) ?? null;
  }, [readerSession?.setlistId, setlists]);

  const activeSetlistScores = useMemo(() => {
    if (!activeSetlist) return [];
    const byId = new Map(scores.map((s) => [s.id, s]));
    return [...activeSetlist.items]
      .sort((a, b) => a.position - b.position)
      .map((item) => byId.get(item.scoreId))
      .filter((s): s is ScoreRecord => s !== undefined);
  }, [activeSetlist, scores]);

  // Centralized Wake Lock lifecycle: active only when reading a score with wakeLockEnabled
  const isReading = Boolean(activeScore && readerSession);
  useEffect(() => {
    const shouldLock = isReading && settings.wakeLockEnabled;
    void setWakeLock(shouldLock).catch(() => {});
    return () => {
      if (shouldLock) {
        void setWakeLock(false).catch(() => {});
      }
    };
  }, [isReading, settings.wakeLockEnabled]);

  const persistPageAnnotations = useCallback(
    (next: PageAnnotations) => {
      const key = annotationKey(next.scoreId, next.pageNum);
      const rev = (annotationSaveRevRef.current[key] ?? 0) + 1;
      annotationSaveRevRef.current[key] = rev;
      setAnnotationsByPage((prev) => ({ ...prev, [key]: next }));
      void savePageAnnotations(next)
        .then((saved) => {
          if (annotationSaveRevRef.current[key] !== rev) return;
          setAnnotationsByPage((prev) => ({ ...prev, [key]: saved }));
        })
        .catch(() => {
          showErrorToast(
            getTranslations(settingsRef.current.language).errors.saveAnnotationsFailed,
          );
        });
    },
    [showErrorToast],
  );

  // Preload current page and neighbor annotations while reading
  useEffect(() => {
    if (!activeScore) return;
    let cancelled = false;
    const scoreId = activeScore.id;
    const pagesToLoad = [readerPage, readerPage + 1].filter((p) => p >= 1);

    for (const pageNum of pagesToLoad) {
      const key = annotationKey(scoreId, pageNum);
      if (
        loadedAnnotationKeysRef.current.has(key) ||
        inFlightAnnotationKeysRef.current.has(key)
      ) {
        continue;
      }

      inFlightAnnotationKeysRef.current.add(key);
      void getPageAnnotations(scoreId, pageNum)
        .then((loaded) => {
          inFlightAnnotationKeysRef.current.delete(key);
          loadedAnnotationKeysRef.current.add(key);
          if (!cancelled) {
            setLoadedAnnotationKeys((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
          }

          const pending = pendingPreloadCommitsRef.current.get(key);
          if (pending) {
            pendingPreloadCommitsRef.current.delete(key);
            const merged = mergePageAnnotations(loaded, pending);
            persistPageAnnotations(merged);
            return;
          }

          if (!cancelled) {
            setAnnotationsByPage((prev) => ({ ...prev, [key]: loaded }));
          }
        })
        .catch(() => {
          inFlightAnnotationKeysRef.current.delete(key);
          const pending = pendingPreloadCommitsRef.current.get(key);
          if (pending) {
            pendingPreloadCommitsRef.current.delete(key);
            loadedAnnotationKeysRef.current.add(key);
            persistPageAnnotations(pending);
            return;
          }
          if (!cancelled) {
            showErrorToast(
              getTranslations(settingsRef.current.language).errors.saveAnnotationsFailed,
            );
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [activeScore, readerPage, restoreEpoch, persistPageAnnotations, showErrorToast]);

  const activeAnnotationKey = activeScore
    ? annotationKey(activeScore.id, readerPage)
    : null;
  const annotationsReady = activeAnnotationKey
    ? Boolean(loadedAnnotationKeys[activeAnnotationKey])
    : false;

  const currentPageAnnotations = useMemo(() => {
    if (!activeScore) {
      return makeFallbackAnnotations('none', 1, settings.language);
    }
    const key = annotationKey(activeScore.id, readerPage);
    return (
      annotationsByPage[key] ??
      makeFallbackAnnotations(activeScore.id, readerPage, settings.language)
    );
  }, [activeScore, readerPage, annotationsByPage, settings.language]);

  const handleCommitPageAnnotations = useCallback(
    (next: PageAnnotations) => {
      const key = annotationKey(next.scoreId, next.pageNum);
      if (!loadedAnnotationKeysRef.current.has(key)) {
        // Queue/merge onto loaded page once preload resolves instead of overwriting disk state
        pendingPreloadCommitsRef.current.set(key, next);
        setAnnotationsByPage((prev) => ({ ...prev, [key]: next }));
        return;
      }
      persistPageAnnotations(next);
    },
    [persistPageAnnotations],
  );

  const annotationSession = useAnnotationSession({
    pageAnnotations: currentPageAnnotations,
    onCommit: handleCommitPageAnnotations,
    language: settings.language,
    restoreEpoch,
  });

  const handleUpdateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const rev = settingsRevRef.current + 1;
      settingsRevRef.current = rev;
      const next: AppSettings = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      try {
        const persisted = await saveSettings(next);
        if (settingsRevRef.current === rev) {
          settingsRef.current = persisted;
          setSettings(persisted);
        }
      } catch {
        // Keep optimistic UI state on transient storage failure
      }
    },
    [],
  );

  const handleUpdateScore = useCallback(
    async (scoreId: string, patch: ScoreMetadataPatch) => {
      const rev = (scoreUpdateRevRef.current[scoreId] ?? 0) + 1;
      scoreUpdateRevRef.current[scoreId] = rev;
      try {
        const updated = await updateScoreMetadata(scoreId, patch);
        if (scoreUpdateRevRef.current[scoreId] === rev) {
          setScores((prev) =>
            prev.map((s) => (s.id === updated.id ? updated : s)),
          );
        }
      } catch (err) {
        showErrorToast(
          getTranslations(settingsRef.current.language).errors.saveMetadataFailed,
        );
        throw err;
      }
    },
    [showErrorToast],
  );

  const handleDeleteScore = useCallback(
    async (scoreId: string) => {
      try {
        await deleteScoreRecord(scoreId);
        const [nextScores, nextSetlists] = await Promise.all([
          listScores(),
          listSetlists(),
        ]);
        setScores(nextScores);
        setSetlists(nextSetlists);
      } catch {
        showErrorToast(
          getTranslations(settingsRef.current.language).errors.deleteScoreFailed,
        );
      }
    },
    [showErrorToast],
  );

  const handleScanLibrary = useCallback(
    async (folderId?: string) => {
      if (isScanning) return;
      setIsScanning(true);
      try {
        const res = await scanLibrary(folderId);
        setScores(res.scores);
        const dict = getTranslations(settingsRef.current.language);
        setStatusMessage(
          formatMessage(dict.library.scanSummary, {
            added: res.added,
            updated: res.updated,
            missing: res.missing,
          }),
        );
      } catch {
        const dict = getTranslations(settingsRef.current.language);
        setStatusMessage(dict.common.error);
      } finally {
        setIsScanning(false);
      }
    },
    [isScanning],
  );

  const handleAddFolder = useCallback(async () => {
    try {
      const added = await pickAndAddLibraryFolder();
      if (!added) {
        if (!isTauriEnv()) {
          setStatusMessage(
            settingsRef.current.language === 'en'
              ? 'Folder linking requires the desktop app. Use "Open PDF" in browser mode.'
              : 'Länkade mappar kräver skrivbordsappen. Använd "Öppna PDF" i webbläsaren.',
          );
        }
        return;
      }
      const updatedFolders = await listLibraryFolders();
      setFolders(updatedFolders);
      await handleScanLibrary(added.id);
    } catch {
      showErrorToast(
        getTranslations(settingsRef.current.language).errors.folderActionFailed,
      );
    }
  }, [handleScanLibrary, showErrorToast]);

  const handleRemoveFolder = useCallback(
    async (folderId: string) => {
      try {
        await removeLibraryFolder(folderId);
        const [nextFolders, nextScores] = await Promise.all([
          listLibraryFolders(),
          listScores(),
        ]);
        setFolders(nextFolders);
        setScores(nextScores);
      } catch {
        showErrorToast(
          getTranslations(settingsRef.current.language).errors.folderActionFailed,
        );
      }
    },
    [showErrorToast],
  );

  const openSingleScoreInReader = useCallback((score: ScoreRecord) => {
    setIsAnnotating(false);
    setStampPaletteOpen(false);
    setMetronomeOpen(false);
    setPianoOpen(false);
    setReaderPage(Math.max(1, score.lastPage || 1));
    setReaderSession({
      scoreId: score.id,
      setlistId: null,
      setlistIndex: 0,
    });
  }, []);

  const handleOpenPdfFiles = useCallback(async () => {
    try {
      const imported = await pickAndImportPdfFiles();
      if (imported.length === 0) return;
      const nextScores = await listScores();
      setScores(nextScores);
      if (imported.length === 1) {
        openSingleScoreInReader(imported[0]);
      }
    } catch {
      showErrorToast(
        getTranslations(settingsRef.current.language).errors.importPdfFailed,
      );
    }
  }, [openSingleScoreInReader, showErrorToast]);

  const handleOpenSetlist = useCallback(
    (setlist: Setlist, startIndex = 0) => {
      const byId = new Map(scores.map((s) => [s.id, s]));
      const ordered = [...setlist.items]
        .sort((a, b) => a.position - b.position)
        .map((item) => byId.get(item.scoreId))
        .filter((s): s is ScoreRecord => s !== undefined);
      if (ordered.length === 0) return;
      const safeIndex = Math.max(0, Math.min(ordered.length - 1, startIndex));
      const target = ordered[safeIndex];
      setIsAnnotating(false);
      setStampPaletteOpen(false);
      setMetronomeOpen(false);
      setPianoOpen(false);
      setReaderPage(1);
      setReaderSession({
        scoreId: target.id,
        initialPage: 1,
        setlistId: setlist.id,
        setlistIndex: safeIndex,
      });
    },
    [scores],
  );

  const handleSelectSetlistScore = useCallback(
    (nextIndex: number, targetPage: number) => {
      if (!readerSession?.setlistId) return;
      if (nextIndex < 0 || nextIndex >= activeSetlistScores.length) return;
      const targetScore = activeSetlistScores[nextIndex];
      setIsAnnotating(false);
      setStampPaletteOpen(false);
      setReaderPage(
        targetPage === -1 ? Math.max(1, targetScore.pageCount || 1) : targetPage,
      );
      setReaderSession({
        scoreId: targetScore.id,
        initialPage: targetPage,
        setlistId: readerSession.setlistId,
        setlistIndex: nextIndex,
      });
    },
    [readerSession, activeSetlistScores],
  );

  const handleBackToLibrary = useCallback(() => {
    metronomeEngine.stop();
    metronomeEngine.setAudible(false);
    pianoEngine.stopAll();
    setIsAnnotating(false);
    setStampPaletteOpen(false);
    setMetronomeOpen(false);
    setPianoOpen(false);
    setReaderSession(null);
  }, []);

  const handlePlaySavedPitch = useCallback(
    (pitch: SavedPitch) => {
      pianoEngine.setReferencePitchHz(settings.referencePitchHz);
      void pianoEngine.playChord(pitch.midiNotes, 1800);
    },
    [settings.referencePitchHz],
  );

  const handleExportPdf = useCallback(async () => {
    if (!activeScore || isExportingPdf) return;
    setIsExportingPdf(true);
    const dict = getTranslations(settingsRef.current.language);
    try {
      const [originalBytes, storedAnnotations] = await Promise.all([
        readPdfBytes(activeScore.id, activeScore.filePath),
        getScoreAnnotations(activeScore.id),
      ]);

      // Merge any in-memory page edits so export always reflects latest state
      const mergedMap = new Map<number, PageAnnotations>();
      for (const ann of storedAnnotations) {
        mergedMap.set(ann.pageNum, ann);
      }
      for (const ann of Object.values(annotationsByPage)) {
        if (ann.scoreId === activeScore.id) {
          mergedMap.set(ann.pageNum, ann);
        }
      }

      const exportedBytes = await exportAnnotatedPdf(
        originalBytes,
        Array.from(mergedMap.values()),
      );
      const baseTitle = sanitizeExportFilename(activeScore.title, 'score');
      const exportName = `${baseTitle}${dict.reader.exportFilenameSuffix}.pdf`;
      const saved = await exportPdfWithDialog(exportName, exportedBytes);
      if (saved) {
        showSuccessToast(dict.errors.exportPdfSuccess);
      }
    } catch (err) {
      if (
        err instanceof EncryptedPdfError ||
        (err instanceof Error && (err as { code?: string }).code === 'ENCRYPTED_PDF')
      ) {
        showErrorToast(dict.errors.exportPdfEncrypted);
      } else {
        showErrorToast(dict.errors.exportPdfFailed);
      }
    } finally {
      setIsExportingPdf(false);
    }
  }, [activeScore, isExportingPdf, annotationsByPage, showErrorToast, showSuccessToast]);

  const handleBackupRestored = useCallback(async () => {
    loadedAnnotationKeysRef.current.clear();
    inFlightAnnotationKeysRef.current.clear();
    pendingPreloadCommitsRef.current.clear();
    setLoadedAnnotationKeys({});
    setAnnotationsByPage({});
    setRestoreEpoch((n) => n + 1);
    await refreshLibraryData();
  }, [refreshLibraryData]);

  const renderPageOverlay = useCallback(
    (ctx: AnnotationOverlayContext) => {
      const key = annotationKey(ctx.score.id, ctx.pageNum);
      const isCurrentEditable = ctx.isAnnotating && ctx.pageNum === readerPage;
      const pageData = isCurrentEditable
        ? annotationSession.normalizedAnnotations
        : annotationsByPage[key] ??
          makeFallbackAnnotations(ctx.score.id, ctx.pageNum, settings.language);

      return (
        <AnnotationCanvas
          pageAnnotations={pageData}
          onChange={
            isCurrentEditable ? annotationSession.handleCanvasChange : () => {}
          }
          toolState={annotationSession.toolState}
          activeLayerId={annotationSession.activeLayerId}
          active={isCurrentEditable}
          showAllAnnotations={ctx.showAnnotations}
          language={settings.language}
          pageWidth={ctx.pageWidth}
          pageHeight={ctx.pageHeight}
          onPinchPanStart={ctx.pinchHandlers.onPinchPanStart}
          onPinchPanMove={ctx.pinchHandlers.onPinchPanMove}
          onPinchPanEnd={ctx.pinchHandlers.onPinchPanEnd}
        />
      );
    },
    [
      readerPage,
      annotationSession.normalizedAnnotations,
      annotationSession.handleCanvasChange,
      annotationSession.toolState,
      annotationSession.activeLayerId,
      annotationsByPage,
      settings.language,
    ],
  );

  const annotationToolbarSlot = activeScore ? (
    <>
      <AnnotationToolbar
        language={settings.language}
        toolState={annotationSession.toolState}
        onToolStateChange={annotationSession.setToolState}
        layers={annotationSession.layers}
        activeLayerId={annotationSession.activeLayerId}
        onSelectLayer={annotationSession.setActiveLayerId}
        onAddLayer={annotationSession.addLayer}
        onToggleLayerVisibility={annotationSession.toggleLayerVisibility}
        onRenameLayer={annotationSession.renameLayer}
        onDeleteLayer={annotationSession.deleteLayer}
        canUndo={annotationSession.canUndo}
        canRedo={annotationSession.canRedo}
        onUndo={annotationSession.undo}
        onRedo={annotationSession.redo}
        showAllAnnotations={annotationSession.showAllAnnotations}
        onToggleShowAllAnnotations={annotationSession.toggleShowAllAnnotations}
        onClearPage={annotationSession.clearPage}
        onOpenStampPalette={() => setStampPaletteOpen(true)}
        onExportPdf={() => void handleExportPdf()}
        isExportingPdf={isExportingPdf}
        onDone={() => {
          setStampPaletteOpen(false);
          setIsAnnotating(false);
        }}
        dockPosition={toolbarDock}
        onDockPositionChange={setToolbarDock}
      />
      <StampPalette
        open={stampPaletteOpen}
        language={settings.language}
        activeStamp={annotationSession.toolState.stampType}
        activeColor={annotationSession.toolState.stampColor}
        onSelectStamp={(stampType) => {
          annotationSession.setToolState({
            ...annotationSession.toolState,
            tool: 'stamp',
            stampType,
          });
          setStampPaletteOpen(false);
        }}
        onClose={() => setStampPaletteOpen(false)}
      />
    </>
  ) : null;

  const metronomeSlot = activeScore ? (
    <MetronomeOverlay
      initialBpm={activeScore.savedBpm}
      initialTimeSignature={activeScore.savedTimeSignature}
      language={settings.language}
      isOpen={metronomeOpen}
      onClose={() => setMetronomeOpen(false)}
      onSaveTempo={(bpm: number, timeSignature: TimeSignature) =>
        handleUpdateScore(activeScore.id, {
          savedBpm: bpm,
          savedTimeSignature: timeSignature,
        })
      }
    />
  ) : null;

  const pianoSlot = activeScore ? (
    <PianoOverlay
      language={settings.language}
      noteNaming={settings.noteNaming}
      referencePitchHz={settings.referencePitchHz}
      savedPitch={activeScore.savedPitch}
      isOpen={pianoOpen}
      onClose={() => setPianoOpen(false)}
      onSavePitch={(pitch: SavedPitch) =>
        handleUpdateScore(activeScore.id, { savedPitch: pitch })
      }
    />
  ) : null;

  const t = getTranslations(settings.language);

  return (
    <I18nProvider
      language={settings.language}
      onChangeLanguage={(lang) => void handleUpdateSettings({ language: lang })}
    >
      {activeScore && readerSession ? (
        <ErrorBoundary
          fallbackTitle={t.errors.unexpectedCrashTitle}
          fallbackBody={t.errors.unexpectedCrashBody}
          actionLabel={t.errors.backToLibrary}
          onReset={handleBackToLibrary}
        >
          <ReaderView
            key={`${activeScore.id}-${readerSession.setlistId ?? 'solo'}-${readerSession.setlistIndex}`}
            score={activeScore}
            settings={settings}
            initialPage={readerSession.initialPage}
            setlist={activeSetlist}
            setlistScores={activeSetlistScores}
            setlistIndex={readerSession.setlistIndex}
            onSelectSetlistScore={handleSelectSetlistScore}
            onBackToLibrary={handleBackToLibrary}
            onUpdateScore={handleUpdateScore}
            onPageChange={setReaderPage}
            onOpenSettings={() => setSettingsOpen(true)}
            onPlaySavedPitch={handlePlaySavedPitch}
            isAnnotating={isAnnotating}
            onAnnotatingChange={(next) => {
              if (!next) setStampPaletteOpen(false);
              setIsAnnotating(next);
            }}
            showAnnotations={annotationSession.showAllAnnotations}
            onShowAnnotationsChange={annotationSession.setShowAllAnnotations}
            metronomeOpen={metronomeOpen}
            onMetronomeOpenChange={setMetronomeOpen}
            pianoOpen={pianoOpen}
            onPianoOpenChange={setPianoOpen}
            modalOpen={settingsOpen}
            restoreEpoch={restoreEpoch}
            annotationsReady={annotationsReady}
            onError={showErrorToast}
            renderPageOverlay={renderPageOverlay}
            annotationToolbarSlot={annotationToolbarSlot}
            metronomeSlot={metronomeSlot}
            pianoSlot={pianoSlot}
          />
        </ErrorBoundary>
      ) : (
        <LibraryView
          scores={scores}
          folders={folders}
          setlists={setlists}
          settings={settings}
          isScanning={isScanning}
          statusMessage={statusMessage}
          onDismissStatus={() => setStatusMessage(null)}
          onOpenScore={openSingleScoreInReader}
          onOpenSetlist={handleOpenSetlist}
          onAddFolder={handleAddFolder}
          onRemoveFolder={handleRemoveFolder}
          onScanLibrary={handleScanLibrary}
          onOpenPdfFiles={handleOpenPdfFiles}
          onUpdateScore={handleUpdateScore}
          onDeleteScore={handleDeleteScore}
          onSetlistsChange={setSetlists}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {toast && (
        <div
          role={toast.isError ? 'alert' : 'status'}
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 90,
            maxWidth: 'min(92vw, 480px)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: `1px solid ${toast.isError ? 'var(--danger)' : 'var(--success)'}`,
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span style={{ fontSize: '0.92rem', flex: 1 }}>{toast.message}</span>
          <button
            type="button"
            onClick={dismissToast}
            aria-label={t.common.close}
            style={{
              minWidth: 36,
              minHeight: 36,
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onClose={() => setSettingsOpen(false)}
        onBackupRestored={handleBackupRestored}
      />
    </I18nProvider>
  );
}

export default App;
