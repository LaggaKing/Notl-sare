import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Crop,
  Eye,
  EyeOff,
  Maximize2,
  Pencil,
  Piano,
  Rows2,
  Settings,
  Timer,
  Volume2,
} from 'lucide-react';
import type {
  AppSettings,
  CropMode,
  SavedPitch,
  ScoreRecord,
  Setlist,
} from '../../types';
import { formatMessage, formatPitchLabel, useI18n } from '../../i18n';

export interface ReaderHudProps {
  visible: boolean;
  score: ScoreRecord;
  settings: AppSettings;
  currentPage: number;
  pageCount: number;
  cropMode: CropMode;
  halfPageMode: boolean;
  zoomScale: number;
  bookmarkCount: number;
  isAnnotating: boolean;
  showAnnotations: boolean;
  metronomeOpen: boolean;
  pianoOpen: boolean;
  setlist?: Setlist | null;
  setlistIndex?: number;
  setlistTotal?: number;
  onBackToLibrary: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onJumpToPage: (page: number) => void;
  onPrevSetlistPiece?: () => void;
  onNextSetlistPiece?: () => void;
  onPlaySavedPitch?: (pitch: SavedPitch) => void;
  onOpenBookmarks: () => void;
  onSelectCropMode: (mode: CropMode) => void;
  onOpenManualCropEditor: () => void;
  onOpenSettings: () => void;
  onToggleAnnotating: () => void;
  onToggleShowAnnotations: () => void;
  onToggleMetronome: () => void;
  onTogglePiano: () => void;
  onToggleHalfPageMode: () => void;
  onResetZoom: () => void;
  onHudHeightsChange?: (heights: { top: number; bottom: number }) => void;
}

export function ReaderHud({
  visible,
  score,
  settings,
  currentPage,
  pageCount,
  cropMode,
  halfPageMode,
  zoomScale,
  bookmarkCount,
  isAnnotating,
  showAnnotations,
  metronomeOpen,
  pianoOpen,
  setlist,
  setlistIndex = 0,
  setlistTotal = 0,
  onBackToLibrary,
  onPrevPage,
  onNextPage,
  onJumpToPage,
  onPrevSetlistPiece,
  onNextSetlistPiece,
  onPlaySavedPitch,
  onOpenBookmarks,
  onSelectCropMode,
  onOpenManualCropEditor,
  onOpenSettings,
  onToggleAnnotating,
  onToggleShowAnnotations,
  onToggleMetronome,
  onTogglePiano,
  onToggleHalfPageMode,
  onResetZoom,
  onHudHeightsChange,
}: ReaderHudProps) {
  const { language, t } = useI18n();
  const [cropMenuOpen, setCropMenuOpen] = useState(false);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  const cropButtonRef = useRef<HTMLButtonElement | null>(null);
  const cropMenuRef = useRef<HTMLDivElement | null>(null);
  const [topHeight, setTopHeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setCropMenuOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!cropMenuOpen) return;
    const handleOutsidePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !cropMenuRef.current?.contains(target) &&
        !cropButtonRef.current?.contains(target)
      ) {
        setCropMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [cropMenuOpen]);

  useEffect(() => {
    if (!visible) {
      onHudHeightsChange?.({ top: 0, bottom: 0 });
      return;
    }
    const measure = () => {
      const top = topBarRef.current?.getBoundingClientRect().height ?? 0;
      const bottom = bottomBarRef.current?.getBoundingClientRect().height ?? 0;
      setTopHeight(top);
      onHudHeightsChange?.({ top, bottom });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (topBarRef.current) observer.observe(topBarRef.current);
    if (bottomBarRef.current) observer.observe(bottomBarRef.current);
    return () => observer.disconnect();
  }, [visible, onHudHeightsChange]);

  if (!visible) {
    return null;
  }

  const savedPitchNotes = score.savedPitch?.midiNotes ?? [];
  const savedPitchLabel =
    savedPitchNotes.length > 0
      ? formatPitchLabel(savedPitchNotes, language, settings.noteNaming)
      : '';

  const cropLabel =
    cropMode === 'auto'
      ? t.reader.cropAuto
      : cropMode === 'manual'
        ? t.reader.cropManual
        : t.reader.cropNone;

  return (
    <div
      className="reader-hud-layer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div ref={topBarRef} className="reader-hud-bar">
        <div className="reader-hud-group" style={{ minWidth: 0 }}>
          <button
            type="button"
            className="hud-btn"
            onClick={onBackToLibrary}
            aria-label={t.reader.backToLibrary}
          >
            <ArrowLeft size={18} />
            <span>{t.reader.backToLibrary}</span>
          </button>

          <div className="reader-hud-title-block">
            <span className="reader-hud-title">{score.title}</span>
            <span className="reader-hud-subtitle">
              <span>
                {formatMessage(t.common.pageOf, {
                  page: currentPage,
                  total: Math.max(1, pageCount),
                })}
              </span>
              {setlist && setlistTotal > 0 && (
                <span>
                  · {setlist.name} ({setlistIndex + 1}/{setlistTotal})
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="reader-hud-group">
          {savedPitchLabel && score.savedPitch && onPlaySavedPitch && (
            <button
              type="button"
              className="hud-btn is-accent-pill"
              onClick={() => onPlaySavedPitch(score.savedPitch!)}
              aria-label={`${t.reader.playStartPitch}: ${savedPitchLabel}`}
              title={t.reader.playStartPitch}
            >
              <Volume2 size={17} />
              <span>{savedPitchLabel}</span>
            </button>
          )}

          {setlist && setlistTotal > 1 && (
            <>
              <button
                type="button"
                className="hud-btn hud-btn-icon"
                disabled={setlistIndex <= 0}
                onClick={onPrevSetlistPiece}
                aria-label={t.setlists.previousPiece}
                title={t.setlists.previousPiece}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="hud-btn hud-btn-icon"
                disabled={setlistIndex >= setlistTotal - 1}
                onClick={onNextSetlistPiece}
                aria-label={t.setlists.nextPiece}
                title={t.setlists.nextPiece}
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}

          <button
            type="button"
            className="hud-btn"
            onClick={onOpenBookmarks}
            aria-label={t.reader.bookmarks}
          >
            <Bookmark size={18} />
            {bookmarkCount > 0 && <span>{bookmarkCount}</span>}
          </button>

          <button
            ref={cropButtonRef}
            type="button"
            className={`hud-btn ${cropMode !== 'none' ? 'is-accent-pill' : ''}`}
            onClick={() => setCropMenuOpen((prev) => !prev)}
            aria-label={t.reader.cropMargins}
            aria-expanded={cropMenuOpen}
          >
            <Crop size={18} />
            <span>{cropLabel}</span>
          </button>

          <button
            type="button"
            className="hud-btn hud-btn-icon"
            onClick={onOpenSettings}
            aria-label={t.reader.settings}
            title={t.reader.settings}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {cropMenuOpen && (
        <div
          ref={cropMenuRef}
          className="hud-popover"
          role="menu"
          aria-label={t.reader.cropMargins}
          style={topHeight > 0 ? { top: Math.round(topHeight + 8) } : undefined}
        >
          <button
            type="button"
            className={`hud-btn ${cropMode === 'auto' ? 'is-active' : ''}`}
            onClick={() => {
              onSelectCropMode('auto');
              setCropMenuOpen(false);
            }}
          >
            {t.reader.cropAuto}
          </button>
          <button
            type="button"
            className={`hud-btn ${cropMode === 'manual' ? 'is-active' : ''}`}
            onClick={() => {
              onSelectCropMode('manual');
              setCropMenuOpen(false);
            }}
          >
            {t.reader.cropManual}
          </button>
          <button
            type="button"
            className={`hud-btn ${cropMode === 'none' ? 'is-active' : ''}`}
            onClick={() => {
              onSelectCropMode('none');
              setCropMenuOpen(false);
            }}
          >
            {t.reader.cropNone}
          </button>
          <button
            type="button"
            className="hud-btn is-accent-pill"
            onClick={() => {
              setCropMenuOpen(false);
              onOpenManualCropEditor();
            }}
          >
            <Crop size={16} />
            <span>{t.reader.cropAdjust}</span>
          </button>
        </div>
      )}

      <div ref={bottomBarRef} className="reader-hud-bar is-bottom">
        <div className="hud-scrubber-row">
          <button
            type="button"
            className="hud-btn hud-btn-icon"
            onClick={onPrevPage}
            aria-label={t.reader.previousPage}
          >
            <ChevronLeft size={20} />
          </button>

          <input
            type="range"
            className="hud-scrubber-input"
            min={1}
            max={Math.max(1, pageCount)}
            value={currentPage}
            aria-label={t.reader.pageScrubber}
            onChange={(e) => onJumpToPage(Number(e.target.value))}
          />

          <button
            type="button"
            className="hud-btn hud-btn-icon"
            onClick={onNextPage}
            aria-label={t.reader.nextPage}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="hud-tools-row">
          <div className="reader-hud-group">
            <button
              type="button"
              className={`hud-btn ${isAnnotating ? 'is-active' : ''}`}
              onClick={onToggleAnnotating}
            >
              <Pencil size={17} />
              <span>{t.reader.annotate}</span>
            </button>

            <button
              type="button"
              className={`hud-btn hud-btn-icon ${showAnnotations ? 'is-accent-pill' : ''}`}
              onClick={onToggleShowAnnotations}
              aria-label={
                showAnnotations
                  ? t.reader.hideAnnotations
                  : t.reader.showAnnotations
              }
              title={
                showAnnotations
                  ? t.reader.hideAnnotations
                  : t.reader.showAnnotations
              }
            >
              {showAnnotations ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>

            <button
              type="button"
              className={`hud-btn ${metronomeOpen ? 'is-active' : ''}`}
              onClick={onToggleMetronome}
            >
              <Timer size={17} />
              <span>
                {t.reader.metronome}
                {score.savedBpm ? ` (${score.savedBpm})` : ''}
              </span>
            </button>

            <button
              type="button"
              className={`hud-btn ${pianoOpen ? 'is-active' : ''}`}
              onClick={onTogglePiano}
            >
              <Piano size={17} />
              <span>{t.reader.piano}</span>
            </button>

            <button
              type="button"
              className={`hud-btn ${halfPageMode ? 'is-active' : ''}`}
              onClick={onToggleHalfPageMode}
              aria-pressed={halfPageMode}
            >
              <Rows2 size={17} />
              <span>{t.reader.halfPageTurn}</span>
            </button>
          </div>

          {zoomScale > 1.05 && (
            <button
              type="button"
              className="hud-btn is-accent-pill"
              onClick={onResetZoom}
            >
              <Maximize2 size={15} />
              <span>
                {formatMessage(t.reader.zoomPercent, {
                  percent: Math.round(zoomScale * 100),
                })}{' '}
                · {t.reader.resetZoom}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
