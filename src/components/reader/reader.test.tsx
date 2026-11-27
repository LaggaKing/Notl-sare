import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  type ScoreRecord,
  type Setlist,
} from '../../types';
import { I18nProvider } from '../../i18n';
import * as pdfModule from '../../pdf';
import * as tauriApi from '../../services/tauriApi';
import { CropOverlay, ReaderHud, ReaderView } from './index';

const SAMPLE_SCORE: ScoreRecord = {
  id: 'score-1',
  filePath: 'idb://pdf/sample.pdf',
  sha256: 'hash1',
  title: 'Sång till Norden',
  filename: 'sang.pdf',
  pageCount: 3,
  lastPage: 1,
  lastOpenedAt: '2026-11-22T12:00:00Z',
  favorite: false,
  tags: ['Bas'],
  crop: null,
  savedBpm: 88,
  savedTimeSignature: '3/4',
  savedPitch: { midiNotes: [47, 50] },
};

function makeFakePdfDoc(pageCount = 3) {
  const makeRendered = (pageNum: number) => ({
    pageNum,
    targetPixelWidth: 960,
    canvas: document.createElement('canvas'),
    pixelWidth: 600,
    pixelHeight: 850,
    pageWidth: 595,
    pageHeight: 842,
    autoCrop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
  });

  return {
    pageCount,
    getCachedPage: vi.fn((p: number) => makeRendered(p)),
    getCachedAutoCrop: vi.fn(() => ({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })),
    getPageDimensions: vi.fn(async () => ({
      width: 595,
      height: 842,
      aspectRatio: 595 / 842,
    })),
    renderPage: vi.fn(async (p: number) => makeRendered(p)),
    getAutoCrop: vi.fn(async () => ({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })),
    prefetchAround: vi.fn(),
    clearCache: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

describe('ReaderHud, CropOverlay & ReaderView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('displays score title, Swedish H/B starting pitch pill, and triggers controls', () => {
    const onPlaySavedPitch = vi.fn();
    const onToggleHalfPageMode = vi.fn();
    const onSelectCropMode = vi.fn();

    render(
      <I18nProvider language="sv">
        <ReaderHud
          visible={true}
          score={SAMPLE_SCORE}
          settings={DEFAULT_APP_SETTINGS}
          currentPage={2}
          pageCount={5}
          cropMode="auto"
          halfPageMode={false}
          zoomScale={1}
          bookmarkCount={2}
          isAnnotating={false}
          showAnnotations={true}
          metronomeOpen={false}
          pianoOpen={false}
          onBackToLibrary={vi.fn()}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
          onJumpToPage={vi.fn()}
          onPlaySavedPitch={onPlaySavedPitch}
          onOpenBookmarks={vi.fn()}
          onSelectCropMode={onSelectCropMode}
          onOpenManualCropEditor={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleAnnotating={vi.fn()}
          onToggleShowAnnotations={vi.fn()}
          onToggleMetronome={vi.fn()}
          onTogglePiano={vi.fn()}
          onToggleHalfPageMode={onToggleHalfPageMode}
          onResetZoom={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Sång till Norden')).toBeTruthy();
    expect(screen.getByText('Sida 2 av 5')).toBeTruthy();
    expect(screen.getByText('H2 · D3')).toBeTruthy();

    fireEvent.click(screen.getByText('H2 · D3'));
    expect(onPlaySavedPitch).toHaveBeenCalledWith({ midiNotes: [47, 50] });

    fireEvent.click(screen.getByText('Halvsidesskift'));
    expect(onToggleHalfPageMode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Beskär marginaler'));
    fireEvent.click(screen.getByText('Hela sidan'));
    expect(onSelectCropMode).toHaveBeenCalledWith('none');
  });

  it('renders 8 CropOverlay handles and applies clamped box', () => {
    const onApply = vi.fn();
    render(
      <I18nProvider language="sv">
        <CropOverlay
          initialRect={{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }}
          onApply={onApply}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByLabelText('Justera övre vänstra hörnet')).toBeTruthy();
    expect(screen.getByLabelText('Justera nedre högra hörnet')).toBeTruthy();

    fireEvent.click(screen.getByText('Använd'));
    expect(onApply).toHaveBeenCalledWith({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });
  });

  it('manages half-page turns, keyboard pedals, and setlist continuity', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));
    const fakeDoc = makeFakePdfDoc(3);
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      fakeDoc as unknown as pdfModule.PdfScoreDocument,
    );

    const setlist: Setlist = {
      id: 'sl-1',
      name: 'Konsert',
      createdAt: '2026-11-22T12:00:00Z',
      items: [
        { scoreId: 'score-1', position: 0 },
        { scoreId: 'score-2', position: 1 },
      ],
    };
    const score2: ScoreRecord = {
      ...SAMPLE_SCORE,
      id: 'score-2',
      title: 'Stycke två',
    };

    const onSelectSetlistScore = vi.fn();
    const onPageChange = vi.fn();

    render(
      <I18nProvider language="sv">
        <ReaderView
          score={SAMPLE_SCORE}
          settings={{ ...DEFAULT_APP_SETTINGS, halfPageModeDefault: true }}
          setlist={setlist}
          setlistScores={[SAMPLE_SCORE, score2]}
          setlistIndex={0}
          onSelectSetlistScore={onSelectSetlistScore}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onPageChange={onPageChange}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    // 1st ArrowRight in half-page mode opens split view (page 2 top, page 1 bottom)
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByText('Nästa sida (s. 2) ↑')).toBeTruthy();
    expect(screen.getByText('Aktuell sida (s. 1) ↓')).toBeTruthy();

    // 2nd ArrowRight completes turn to page 2
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    // Advance to page 3 (2 steps: half + full)
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    // On last page (3/3), ArrowRight transitions to next piece in setlist
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(onSelectSetlistScore).toHaveBeenCalledWith(1, 1);

    // Escape toggles HUD open
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByText('Sång till Norden')).toBeTruthy();
  });

  it('guards RenderedCanvasMirror against 0x0 evicted canvases and triggers re-render', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));

    const evictedCanvas = document.createElement('canvas');
    evictedCanvas.width = 0;
    evictedCanvas.height = 0;

    const freshCanvas = document.createElement('canvas');
    freshCanvas.width = 600;
    freshCanvas.height = 850;

    let callCount = 0;
    const fakeDoc = {
      pageCount: 2,
      getCachedPage: vi.fn(() => ({
        pageNum: 1,
        targetPixelWidth: 960,
        canvas: evictedCanvas,
        pixelWidth: 600,
        pixelHeight: 850,
        pageWidth: 595,
        pageHeight: 842,
        autoCrop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      })),
      getCachedAutoCrop: vi.fn(() => ({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })),
      getPageDimensions: vi.fn(async () => ({
        width: 595,
        height: 842,
        aspectRatio: 595 / 842,
      })),
      renderPage: vi.fn(async (p: number) => {
        callCount += 1;
        return {
          pageNum: p,
          targetPixelWidth: 960,
          canvas: callCount === 1 ? evictedCanvas : freshCanvas,
          pixelWidth: 600,
          pixelHeight: 850,
          pageWidth: 595,
          pageHeight: 842,
          autoCrop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        };
      }),
      getAutoCrop: vi.fn(async () => ({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 })),
      prefetchAround: vi.fn(),
      clearCache: vi.fn(),
      destroy: vi.fn(async () => {}),
    };

    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      fakeDoc as unknown as pdfModule.PdfScoreDocument,
    );

    render(
      <I18nProvider language="sv">
        <ReaderView
          score={SAMPLE_SCORE}
          settings={DEFAULT_APP_SETTINGS}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(fakeDoc.renderPage).toHaveBeenCalledTimes(2);
    });
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(freshCanvas, 0, 0);
  });

  it('shows localized emptyPdf error, suppresses shortcuts when modalOpen, and renders crop controls outside transform layer', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));

    const emptyDoc = makeFakePdfDoc(0);
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValueOnce(
      emptyDoc as unknown as pdfModule.PdfScoreDocument,
    );

    const { rerender } = render(
      <I18nProvider language="sv">
        <ReaderView
          score={SAMPLE_SCORE}
          settings={DEFAULT_APP_SETTINGS}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('PDF-filen innehåller inga sidor.')).toBeTruthy();
    });

    // Switching language updates error text dynamically
    rerender(
      <I18nProvider language="en">
        <ReaderView
          score={SAMPLE_SCORE}
          settings={{ ...DEFAULT_APP_SETTINGS, language: 'en' }}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('The PDF file contains no pages.')).toBeTruthy();

    // Non-empty score: modalOpen suppresses Escape/arrows & CropControlsBar sits outside transform layer
    cleanup();
    const validDoc = makeFakePdfDoc(3);
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      validDoc as unknown as pdfModule.PdfScoreDocument,
    );
    const onPageChange = vi.fn();

    render(
      <I18nProvider language="sv">
        <ReaderView
          score={{ ...SAMPLE_SCORE, id: 'score-valid' }}
          settings={DEFAULT_APP_SETTINGS}
          modalOpen={true}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onPageChange={onPageChange}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sång till Norden')).toBeNull();

    // Test crop controls placement on a fresh render with modalOpen=false
    cleanup();
    const { container: c2 } = render(
      <I18nProvider language="sv">
        <ReaderView
          score={{ ...SAMPLE_SCORE, id: 'score-crop' }}
          settings={DEFAULT_APP_SETTINGS}
          onBackToLibrary={vi.fn()}
          onUpdateScore={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(c2.querySelector('.reader-transform-layer')).toBeTruthy();
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    fireEvent.click(screen.getByLabelText('Beskär marginaler'));
    fireEvent.click(screen.getByText('Justera beskärning'));

    const controlsBar = c2.querySelector('.crop-controls-bar');
    const transformLayer = c2.querySelector('.reader-transform-layer');
    expect(controlsBar).toBeTruthy();
    expect(transformLayer?.contains(controlsBar)).toBe(false);
    expect(c2.querySelector('.reader-crop-frame.is-cropping')).toBeTruthy();
  });
});
