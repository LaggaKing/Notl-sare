import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSetlist,
  deleteScoreRecord,
  exportBackupJson,
  getScoreAnnotations,
  getSettings,
  importBackupJson,
  listBookmarks,
  listScores,
  listSetlists,
  readPdfBytes,
  registerMockPdf,
  sanitizeExportFilename,
  savePageAnnotations,
  saveSettings,
  setSetlistItems,
  setWakeLock,
  upsertBookmark,
} from './tauriApi';
import { DEFAULT_APP_SETTINGS } from '../types';

describe('sanitizeExportFilename', () => {
  it('strips path separators, traversal dots, illegal chars, and control characters while keeping Swedish characters', () => {
    expect(sanitizeExportFilename('../../evil/<bad>:name|"?.pdf')).toBe('evil_bad_name_.pdf');
    expect(sanitizeExportFilename('Aftonbön & Kör - noter.pdf')).toBe('Aftonbön & Kör - noter.pdf');
    expect(sanitizeExportFilename('line\u0000break\u001fname.pdf')).toBe('linebreakname.pdf');
    expect(sanitizeExportFilename('   ...   ', 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('guards Windows reserved filenames and caps length <= 120 chars', () => {
    expect(sanitizeExportFilename('CON.pdf')).toBe('_CON.pdf');
    expect(sanitizeExportFilename('prn')).toBe('_prn');
    expect(sanitizeExportFilename('com1.txt')).toBe('_com1.txt');
    expect(sanitizeExportFilename('LPT9.pdf')).toBe('_LPT9.pdf');

    const longName = `${'a'.repeat(180)}.pdf`;
    const sanitized = sanitizeExportFilename(longName);
    expect(sanitized.length).toBeLessThanOrEqual(120);
    expect(sanitized.endsWith('.pdf')).toBe(true);
  });
});

describe('backup export/import, validation, and browser store', () => {
  beforeEach(async () => {
    await window.__NOTL_SARE_TEST_API__?.resetBrowserStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('omits local filePath on export and reconciles on import via sha256 + filename', async () => {
    const score = await registerMockPdf('aftonbon.pdf', new Uint8Array([37, 80, 68, 70]), {
      id: 'score-1',
      filePath: 'C:\\Users\\SecretUser\\Music\\aftonbon.pdf',
      title: 'Aftonbön',
      pageCount: 4,
      lastPage: 2,
      favorite: true,
      tags: ['Bas', 'Kör'],
    });

    await saveSettings({ ...DEFAULT_APP_SETTINGS, language: 'en', referencePitchHz: 442 });
    await upsertBookmark({ scoreId: score.id, pageNum: 3, label: 'Repris' });
    await savePageAnnotations({
      scoreId: score.id,
      pageNum: 1,
      layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
      items: [
        {
          kind: 'stamp',
          id: 'st-1',
          layerId: 'default',
          stampType: 'breath',
          position: { x: 0.4, y: 0.5 },
          scale: 1,
          color: '#d64545',
        },
      ],
      updatedAt: '2026-11-27T10:00:00Z',
    });
    const sl = await createSetlist('Julkonsert');
    await setSetlistItems(sl.id, [{ scoreId: score.id, position: 0 }]);

    const backupJson = await exportBackupJson();
    expect(backupJson).not.toContain('SecretUser');
    expect(backupJson).not.toContain('"filePath"');

    const parsed = JSON.parse(backupJson);
    expect(parsed.scores[0].sha256).toBe(score.sha256);
    expect(parsed.scores[0].filename).toBe('aftonbon.pdf');
    expect(parsed.setlists[0].items[0].filename).toBe('aftonbon.pdf');

    // Reset and re-register PDF at a different path (moved file scenario)
    await window.__NOTL_SARE_TEST_API__?.resetBrowserStore();
    const moved = await registerMockPdf('aftonbon.pdf', new Uint8Array([37, 80, 68, 70]), {
      id: 'score-moved',
      filePath: 'idb://pdf/new-location/aftonbon.pdf',
    });

    const result = await importBackupJson(backupJson);
    expect(result).toEqual({ scoresUpdated: 1, annotationsRestored: 1 });

    const restoredSettings = await getSettings();
    expect(restoredSettings.language).toBe('en');
    expect(restoredSettings.referencePitchHz).toBe(442);

    const scores = await listScores();
    expect(scores[0].title).toBe('Aftonbön');
    expect(scores[0].favorite).toBe(true);
    expect(scores[0].tags).toEqual(['Bas', 'Kör']);

    const bookmarks = await listBookmarks(moved.id);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].label).toBe('Repris');

    const anns = await getScoreAnnotations(moved.id);
    expect(anns).toHaveLength(1);
    expect(anns[0].items).toHaveLength(1);

    const setlists = await listSetlists();
    expect(setlists).toHaveLength(1);
    expect(setlists[0].items[0].scoreId).toBe(moved.id);
  });

  it('rejects prototype pollution, malformed JSON, invalid colors, and oversized backups before writing anything', async () => {
    await saveSettings({ ...DEFAULT_APP_SETTINGS, referencePitchHz: 441 });

    await expect(importBackupJson('{invalid')).rejects.toThrow();

    const protoPayload = '{"version":1,"scores":[],"__proto__":{"polluted":true}}';
    await expect(importBackupJson(protoPayload)).rejects.toThrow(/Forbidden key/);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const constructorPayload =
      '{"version":1,"scores":[{"sha256":"abc","constructor":{"prototype":{"x":1}}}]}';
    await expect(importBackupJson(constructorPayload)).rejects.toThrow(/Forbidden key/);

    // Invalid color in second score must fail validation BEFORE mutating settings!
    const badColorBackup = JSON.stringify({
      version: 1,
      settings: { ...DEFAULT_APP_SETTINGS, referencePitchHz: 444 },
      scores: [
        {
          sha256: 'abc',
          filename: 'a.pdf',
          annotations: [
            {
              pageNum: 1,
              layers: [{ id: 'default', name: 'L', visible: true }],
              items: [
                {
                  kind: 'text',
                  id: 't1',
                  layerId: 'default',
                  position: { x: 0.2, y: 0.3 },
                  text: 'Hi',
                  fontSize: 0.02,
                  color: 'javascript:alert(1)',
                },
              ],
            },
          ],
        },
      ],
    });
    await expect(importBackupJson(badColorBackup)).rejects.toThrow(/color/i);
    expect((await getSettings()).referencePitchHz).toBe(441);

    // Oversized > 25 MB string rejection
    const huge = ' '.repeat(25 * 1024 * 1024 + 10);
    await expect(importBackupJson(huge)).rejects.toThrow(/25 MB/);
  });

  it('deletes browser PDF bytes when deleteScoreRecord is called', async () => {
    const score = await registerMockPdf('temp.pdf', new Uint8Array([37, 80, 68, 70]));
    const loaded = await readPdfBytes(score.id, score.filePath);
    expect(loaded).toEqual(new Uint8Array([37, 80, 68, 70]));

    await deleteScoreRecord(score.id);
    await expect(readPdfBytes(score.id, score.filePath)).rejects.toThrow();
  });

  it('serializes browser setWakeLock and releases prior sentinel before acquiring a new one', async () => {
    const events: string[] = [];
    let counter = 0;
    const requestMock = vi.fn(async () => {
      const id = ++counter;
      events.push(`acquire-${id}`);
      return {
        release: vi.fn(async () => {
          events.push(`release-${id}`);
        }),
        addEventListener: vi.fn(),
      };
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      wakeLock: { request: requestMock },
    });

    await Promise.all([setWakeLock(true), setWakeLock(true), setWakeLock(false)]);
    expect(events).toEqual(['acquire-1', 'release-1', 'acquire-2', 'release-2']);
  });
});
