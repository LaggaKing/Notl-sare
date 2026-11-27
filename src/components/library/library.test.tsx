import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, type ScoreRecord, type Setlist } from '../../types';
import { I18nProvider } from '../../i18n';
import * as tauriApi from '../../services/tauriApi';
import { LibraryView, SetlistView } from './index';

function makeScore(overrides: Partial<ScoreRecord> = {}): ScoreRecord {
  return {
    id: overrides.id ?? 'score-1',
    filePath: overrides.filePath ?? 'idb://pdf/score-1.pdf',
    sha256: overrides.sha256 ?? 'abc',
    title: overrides.title ?? 'Vårvindar friska',
    filename: overrides.filename ?? 'varvindar.pdf',
    pageCount: overrides.pageCount ?? 6,
    lastPage: overrides.lastPage ?? 2,
    lastOpenedAt: overrides.lastOpenedAt ?? null,
    favorite: overrides.favorite ?? false,
    tags: overrides.tags ?? [],
    crop: overrides.crop ?? null,
    savedBpm: overrides.savedBpm ?? null,
    savedTimeSignature: overrides.savedTimeSignature ?? null,
    savedPitch: overrides.savedPitch ?? null,
  };
}

describe('LibraryView & SetlistView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders resume card, filters by search/favorites/tags, edits tags, and toggles favorite', async () => {
    const scores: ScoreRecord[] = [
      makeScore({
        id: 's1',
        title: 'Uti vår hage',
        lastOpenedAt: '2026-11-22T10:00:00Z',
        lastPage: 3,
        pageCount: 8,
        favorite: true,
        tags: ['Bas', 'Kör'],
        savedBpm: 92,
        savedPitch: { midiNotes: [46] }, // B2 in Swedish
      }),
      makeScore({
        id: 's2',
        title: 'Gläns över sjö och strand',
        lastOpenedAt: null,
        favorite: false,
        tags: ['Jul'],
      }),
    ];

    const onOpenScore = vi.fn();
    const onUpdateScore = vi.fn();

    render(
      <I18nProvider language="sv">
        <LibraryView
          scores={scores}
          folders={[]}
          setlists={[]}
          settings={DEFAULT_APP_SETTINGS}
          onOpenScore={onOpenScore}
          onOpenSetlist={vi.fn()}
          onAddFolder={vi.fn()}
          onRemoveFolder={vi.fn()}
          onScanLibrary={vi.fn()}
          onOpenPdfFiles={vi.fn()}
          onUpdateScore={onUpdateScore}
          onDeleteScore={vi.fn()}
          onSetlistsChange={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    // Resume card visible with Swedish pitch B2
    expect(screen.getAllByText('Fortsätt läsa').length).toBeGreaterThan(0);
    expect(screen.getAllByText('B2').length).toBeGreaterThan(0);

    // Search filters down to matching score
    const searchInput = screen.getByPlaceholderText('Sök noter eller stämma...');
    fireEvent.change(searchInput, { target: { value: 'Gläns' } });
    expect(screen.getByText('Gläns över sjö och strand')).toBeTruthy();
    expect(screen.queryByText('Uti vår hage', { selector: '.score-card-title' })).toBeNull();

    // Clear search and test favorites filter
    fireEvent.click(screen.getByLabelText('Rensa sökning'));
    fireEvent.click(screen.getByText('Favoriter'));
    expect(screen.queryByText('Gläns över sjö och strand')).toBeNull();

    // Favorite toggle calls onUpdateScore
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Ta bort favoritmarkering'));
    });
    expect(onUpdateScore).toHaveBeenCalledWith('s1', { favorite: false });

    // Edit tags modal adds a new tag and saves
    fireEvent.click(screen.getByLabelText('Redigera titel & etiketter'));
    fireEvent.change(screen.getByPlaceholderText('Ny etikett (t.ex. Bas, Jul)...'), {
      target: { value: 'Vår' },
    });
    fireEvent.click(screen.getByText('Lägg till'));
    await act(async () => {
      fireEvent.click(screen.getByText('Spara'));
    });
    expect(onUpdateScore).toHaveBeenCalledWith('s1', {
      title: 'Uti vår hage',
      tags: ['Bas', 'Kör', 'Vår'],
    });
  });

  it('reorders items in SetlistView with touch Up/Down buttons and launches reader', async () => {
    const scores = [
      makeScore({ id: 's1', title: 'Stycke A' }),
      makeScore({ id: 's2', title: 'Stycke B' }),
    ];
    const setlist: Setlist = {
      id: 'sl-1',
      name: 'Julkonsert',
      createdAt: '2026-11-22T10:00:00Z',
      items: [
        { scoreId: 's1', position: 0 },
        { scoreId: 's2', position: 1 },
      ],
    };

    const setItemsSpy = vi
      .spyOn(tauriApi, 'setSetlistItems')
      .mockImplementation(async (setlistId, items) => ({
        ...setlist,
        id: setlistId,
        items,
      }));

    const onSetlistsChange = vi.fn();
    const onOpenSetlist = vi.fn();

    render(
      <I18nProvider language="sv">
        <SetlistView
          setlists={[setlist]}
          scores={scores}
          settings={DEFAULT_APP_SETTINGS}
          onSetlistsChange={onSetlistsChange}
          onOpenSetlist={onOpenSetlist}
        />
      </I18nProvider>,
    );

    const moveDownButtons = screen.getAllByLabelText('Flytta ner');
    await act(async () => {
      fireEvent.click(moveDownButtons[0]);
    });
    expect(setItemsSpy).toHaveBeenCalledWith('sl-1', [
      { scoreId: 's2', position: 0 },
      { scoreId: 's1', position: 1 },
    ]);
    expect(onSetlistsChange).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Öppna spellista'));
    expect(onOpenSetlist).toHaveBeenCalledWith(setlist, 0);
  });

  it('computes resolved setlist index skipping missing scores, disables missing items, and shows error on failure', async () => {
    const scores = [
      makeScore({ id: 's2', title: 'Stycke B' }),
      makeScore({ id: 's3', title: 'Stycke C' }),
    ];
    const setlist: Setlist = {
      id: 'sl-missing',
      name: 'Blandad lista',
      createdAt: '2026-11-22T10:00:00Z',
      items: [
        { scoreId: 'missing-id', position: 0 },
        { scoreId: 's2', position: 1 },
        { scoreId: 's3', position: 2 },
      ],
    };

    const onOpenSetlist = vi.fn();
    vi.spyOn(tauriApi, 'createSetlist').mockRejectedValue(new Error('DB locked'));

    render(
      <I18nProvider language="sv">
        <SetlistView
          setlists={[setlist]}
          scores={scores}
          settings={DEFAULT_APP_SETTINGS}
          onSetlistsChange={vi.fn()}
          onOpenSetlist={onOpenSetlist}
        />
      </I18nProvider>,
    );

    const missingBtn = screen.getByText('missing-id').closest('button')!;
    expect(missingBtn.disabled).toBe(true);

    // Stycke B is at raw idx 1, but resolved idx 0 among non-missing scores
    fireEvent.click(screen.getByText('Stycke B'));
    expect(onOpenSetlist).toHaveBeenCalledWith(setlist, 0);

    fireEvent.click(screen.getByText('Stycke C'));
    expect(onOpenSetlist).toHaveBeenCalledWith(setlist, 1);

    // Creating setlist failure shows localized error banner instead of throwing
    fireEvent.change(screen.getByLabelText('Ny spellista'), {
      target: { value: 'Jul' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Skapa'));
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Kunde inte uppdatera spellistan.',
    );
  });

  it('localizes suggested choir tags and dismisses modals on Escape', () => {
    const score = makeScore({ id: 's1', title: 'Test Score' });

    render(
      <I18nProvider language="en">
        <LibraryView
          scores={[score]}
          folders={[]}
          setlists={[]}
          settings={{ ...DEFAULT_APP_SETTINGS, language: 'en' }}
          onOpenScore={vi.fn()}
          onOpenSetlist={vi.fn()}
          onAddFolder={vi.fn()}
          onRemoveFolder={vi.fn()}
          onScanLibrary={vi.fn()}
          onOpenPdfFiles={vi.fn()}
          onUpdateScore={vi.fn()}
          onDeleteScore={vi.fn()}
          onSetlistsChange={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByLabelText('Edit title & tags'));
    expect(screen.getByText('Suggestions')).toBeTruthy();
    expect(screen.getByText('Bass')).toBeTruthy();
    expect(screen.getByText('Soprano')).toBeTruthy();
    expect(screen.getByText('Sacred')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
