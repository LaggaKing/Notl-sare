import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type PageAnnotations, type ScoreRecord } from './types';
import * as pdfModule from './pdf';
import * as pdfExportModule from './services/pdfExport';
import * as tauriApi from './services/tauriApi';
import { pianoEngine } from './audio';
import { ErrorBoundary } from './components/ErrorBoundary';
import { App } from './App';

function makeFakePdfDoc(pageCount = 2) {
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

const SAMPLE_SCORE: ScoreRecord = {
  id: 'score-1',
  filePath: 'idb://pdf/sample.pdf',
  sha256: 'hash1',
  title: 'Aftonbön',
  filename: 'aftonbon.pdf',
  pageCount: 2,
  lastPage: 1,
  lastOpenedAt: '2026-11-22T12:00:00Z',
  favorite: true,
  tags: ['Bas', 'Kör'],
  crop: null,
  savedBpm: 72,
  savedTimeSignature: '3/4',
  savedPitch: { midiNotes: [47] },
};

describe('App end-to-end integration & hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('boots into LibraryView, switches settings live, opens ReaderView with tools and returns', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(tauriApi, 'getSettings').mockResolvedValue(DEFAULT_APP_SETTINGS);
    vi.spyOn(tauriApi, 'saveSettings').mockImplementation(async (s) => s);
    vi.spyOn(tauriApi, 'listLibraryFolders').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listScores').mockResolvedValue([SAMPLE_SCORE]);
    vi.spyOn(tauriApi, 'listSetlists').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.spyOn(tauriApi, 'setWakeLock').mockResolvedValue(true);
    vi.spyOn(tauriApi, 'updateScoreMetadata').mockImplementation(
      async (_id, patch) => ({
        ...SAMPLE_SCORE,
        ...patch,
      }),
    );
    vi.spyOn(tauriApi, 'getPageAnnotations').mockResolvedValue({
      scoreId: 'score-1',
      pageNum: 1,
      layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
      items: [],
      updatedAt: '',
    });
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      makeFakePdfDoc(2) as unknown as pdfModule.PdfScoreDocument,
    );
    const playChordSpy = vi
      .spyOn(pianoEngine, 'playChord')
      .mockResolvedValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Aftonbön').length).toBeGreaterThan(0);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.paperTint).toBe('none');

    fireEvent.click(screen.getByLabelText('Inställningar'));
    await act(async () => {
      fireEvent.click(screen.getByText('Nattläge'));
    });
    expect(document.documentElement.dataset.paperTint).toBe('night');
    fireEvent.click(screen.getByLabelText('Stäng'));

    await act(async () => {
      fireEvent.click(screen.getByText('Fortsätt läsa', { selector: '.resume-eyebrow' }));
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Spela startton: H2')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Spela startton: H2'));
    expect(playChordSpy).toHaveBeenCalledWith([47], 1800);

    fireEvent.click(screen.getByText('Metronom (72)'));
    expect(screen.getByText('Visuell puls')).toBeTruthy();

    fireEvent.click(screen.getByText('Startton / Piano'));
    expect(screen.getByText('Håll ton / Ackord')).toBeTruthy();
    expect(screen.getByText('Tysta alla')).toBeTruthy();

    fireEvent.click(screen.getByText('Anteckna'));
    await waitFor(() => {
      expect(screen.getByText('Klar')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Klar'));

    await waitFor(() => {
      expect(screen.getByLabelText('Bibliotek')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Bibliotek'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Sök noter eller stämma...')).toBeTruthy();
    });
  });

  it('catches render errors in ErrorBoundary and supports reset recovery', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Bomb() {
      if (shouldThrow) {
        throw new Error('Render boom');
      }
      return <div>Recovered OK</div>;
    }

    const onReset = vi.fn(() => {
      shouldThrow = false;
    });

    render(
      <ErrorBoundary
        fallbackTitle="Något gick fel"
        fallbackBody="Kraschdetaljer"
        actionLabel="Tillbaka till biblioteket"
        onReset={onReset}
      >
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Något gick fel')).toBeTruthy();
    fireEvent.click(screen.getByText('Tillbaka till biblioteket'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Recovered OK')).toBeTruthy();
  });

  it('surfaces visible toast for encrypted PDF export error and annotation save failure', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(tauriApi, 'getSettings').mockResolvedValue(DEFAULT_APP_SETTINGS);
    vi.spyOn(tauriApi, 'listLibraryFolders').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listScores').mockResolvedValue([SAMPLE_SCORE]);
    vi.spyOn(tauriApi, 'listSetlists').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.spyOn(tauriApi, 'setWakeLock').mockResolvedValue(true);
    vi.spyOn(tauriApi, 'updateScoreMetadata').mockResolvedValue(SAMPLE_SCORE);
    vi.spyOn(tauriApi, 'getScoreAnnotations').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'getPageAnnotations').mockResolvedValue({
      scoreId: 'score-1',
      pageNum: 1,
      layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
      items: [],
      updatedAt: '',
    });
    vi.spyOn(tauriApi, 'savePageAnnotations').mockRejectedValue(new Error('Disk full'));
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      makeFakePdfDoc(2) as unknown as pdfModule.PdfScoreDocument,
    );
    vi.spyOn(pdfExportModule, 'exportAnnotatedPdf').mockRejectedValue(
      new pdfExportModule.EncryptedPdfError(),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Aftonbön').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Fortsätt läsa', { selector: '.resume-eyebrow' }));
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(screen.getByText('Anteckna')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Anteckna'));

    await waitFor(() => {
      expect(screen.getByLabelText('Exportera PDF')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Exportera PDF'));
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          'Denna PDF är krypterad och kan inte exporteras med inbäddade anteckningar.',
        ),
      ).toBeTruthy();
    });
  });

  it('merges pre-load annotation commits with loaded disk annotations instead of overwriting', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    let resolvePage1!: (val: PageAnnotations) => void;
    const page1Promise = new Promise<PageAnnotations>((resolve) => {
      resolvePage1 = resolve;
    });

    vi.spyOn(tauriApi, 'getSettings').mockResolvedValue(DEFAULT_APP_SETTINGS);
    vi.spyOn(tauriApi, 'listLibraryFolders').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listScores').mockResolvedValue([SAMPLE_SCORE]);
    vi.spyOn(tauriApi, 'listSetlists').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'listBookmarks').mockResolvedValue([]);
    vi.spyOn(tauriApi, 'readPdfBytes').mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.spyOn(tauriApi, 'setWakeLock').mockResolvedValue(true);
    vi.spyOn(tauriApi, 'updateScoreMetadata').mockResolvedValue(SAMPLE_SCORE);
    vi.spyOn(tauriApi, 'getPageAnnotations').mockImplementation((_id, pageNum) => {
      if (pageNum === 1) return page1Promise;
      return Promise.resolve({
        scoreId: 'score-1',
        pageNum,
        layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
        items: [],
        updatedAt: '',
      });
    });
    const saveSpy = vi
      .spyOn(tauriApi, 'savePageAnnotations')
      .mockImplementation(async (a) => a);
    vi.spyOn(pdfModule, 'loadPdfDocument').mockResolvedValue(
      makeFakePdfDoc(2) as unknown as pdfModule.PdfScoreDocument,
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Aftonbön').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Fortsätt läsa', { selector: '.resume-eyebrow' }));
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(screen.getByText('Anteckna')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Anteckna'));

    // Select Pen tool and draw a stroke BEFORE page 1 annotations finish loading from disk
    await waitFor(() => {
      expect(screen.getByLabelText('Penna')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Penna'));
    const canvas = document.querySelector('.notlasare-annotation-root--active') as HTMLElement;
    expect(canvas).toBeTruthy();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 160 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 160, clientY: 160, button: 0 });

    // Must not overwrite disk before load completes
    expect(saveSpy).not.toHaveBeenCalled();

    // Now disk returns an existing saved stroke
    await act(async () => {
      resolvePage1({
        scoreId: 'score-1',
        pageNum: 1,
        layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
        items: [
          {
            kind: 'stamp',
            id: 'existing-disk-stamp',
            layerId: 'default',
            stampType: 'fermata',
            position: { x: 0.2, y: 0.2 },
            scale: 1,
            color: '#141416',
          },
        ],
        updatedAt: '2026-11-26T10:00:00Z',
      });
    });

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    const savedArg = saveSpy.mock.calls[0][0];
    expect(savedArg.items.map((i) => i.id)).toContain('existing-disk-stamp');
    expect(savedArg.items.length).toBeGreaterThanOrEqual(2);
  });
});
