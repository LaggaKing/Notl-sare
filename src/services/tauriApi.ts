import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_APP_SETTINGS,
  IPC_COMMANDS,
  type AnnotationItem,
  type AnnotationLayer,
  type AppLanguage,
  type AppSettings,
  type AppTheme,
  type Bookmark,
  type CropMode,
  type CropSettings,
  type IpcCommandName,
  type IpcContractMap,
  type LibraryFolder,
  type LibraryScanResult,
  type NormalizedPoint,
  type NormalizedRect,
  type NoteNaming,
  type PageAnnotations,
  type PaperTint,
  type SavedPitch,
  type ScoreFilter,
  type ScoreMetadataPatch,
  type ScoreRecord,
  type Setlist,
  type SetlistItem,
  type ShapeType,
  type TimeSignature,
  type UpsertBookmarkInput,
} from '../types';

export interface NotlSareBackupScoreV1 {
  sha256: string;
  filePath?: string;
  filename: string;
  title: string;
  pageCount: number;
  lastPage: number;
  lastOpenedAt: string | null;
  favorite: boolean;
  tags: string[];
  crop: CropSettings | null;
  savedBpm: number | null;
  savedTimeSignature: TimeSignature | null;
  savedPitch: SavedPitch | null;
  bookmarks: Array<{
    pageNum: number;
    label: string;
    createdAt: string;
  }>;
  annotations: PageAnnotations[];
}

export interface NotlSareBackupSetlistV1 {
  id: string;
  name: string;
  createdAt: string;
  items: Array<{
    sha256: string;
    filePath?: string;
    filename?: string;
    position: number;
  }>;
}

export interface NotlSareBackupV1 {
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  scores: NotlSareBackupScoreV1[];
  setlists: NotlSareBackupSetlistV1[];
}

export interface ImportBackupResult {
  scoresUpdated: number;
  annotationsRestored: number;
}

export interface NotlSareTestApi {
  registerMockPdf: typeof registerMockPdf;
  listScores: typeof listScores;
  getScoreAnnotations: typeof getScoreAnnotations;
  exportBackupJson: typeof exportBackupJson;
  importBackupJson: typeof importBackupJson;
  resetBrowserStore: () => Promise<void>;
}

declare global {
  interface Window {
    __NOTL_SARE_TEST_API__?: NotlSareTestApi;
  }
}

export function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function tauriInvoke<K extends Exclude<IpcCommandName, typeof IPC_COMMANDS.EXPORT_PDF_WITH_DIALOG>>(
  cmd: K,
  args: IpcContractMap[K]['args'],
): Promise<IpcContractMap[K]['result']> {
  return invoke<IpcContractMap[K]['result']>(cmd, args as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Filename Sanitization & Strict Backup Validation Constants
// ---------------------------------------------------------------------------

const MAX_EXPORT_FILENAME_LEN = 120;
const WINDOWS_RESERVED_NAME_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_SCORES_PER_BACKUP = 10_000;
const MAX_SETLISTS_PER_BACKUP = 2_000;
const MAX_ITEMS_PER_SETLIST = 2_000;
const MAX_PAGES_PER_SCORE = 20_000;
const MAX_BOOKMARKS_PER_SCORE = 1_000;
const MAX_LAYERS_PER_PAGE = 50;
const MAX_ANNOTATIONS_PER_PAGE = 5_000;
const MAX_POINTS_PER_STROKE = 20_000;
const MAX_TAGS_PER_SCORE = 100;
const MAX_STRING_SHORT = 128;
const MAX_STRING_MED = 512;
const MAX_STRING_TEXT = 2_000;
const STRICT_COLOR_RE =
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0|1|0?\.\d+|1\.0+))?\s*\))$/;
const VALID_TIME_SIGNATURES = new Set<TimeSignature>(['2/4', '3/4', '4/4', '6/8', '3/8', '5/4']);
const VALID_SHAPE_TYPES = new Set<ShapeType>(['line', 'bracket', 'circle', 'oval', 'slur']);
const VALID_CROP_MODES = new Set<CropMode>(['auto', 'manual', 'none']);
const VALID_LANGUAGES = new Set<AppLanguage>(['sv', 'en']);
const VALID_NOTE_NAMINGS = new Set<NoteNaming>(['auto', 'sv', 'en']);
const VALID_THEMES = new Set<AppTheme>(['dark', 'light']);
const VALID_PAPER_TINTS = new Set<PaperTint>(['none', 'warm', 'night']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Sanitizes a user-supplied filename for safe local/cross-platform export:
 * strips path separators, `..`, control chars, Windows-disallowed characters,
 * guards Windows reserved device names, and caps length to <= 120 chars.
 */
export function sanitizeExportFilename(rawName: string, fallback = 'export'): string {
  const cleanFallback = sanitizeFilenameCore(fallback) || 'export';
  const cleaned = sanitizeFilenameCore(rawName);
  if (!cleaned) {
    return cleanFallback.slice(0, MAX_EXPORT_FILENAME_LEN);
  }
  return cleaned;
}

function sanitizeFilenameCore(raw: string): string {
  if (typeof raw !== 'string') return '';
  // Replace path separators with underscores, strip control chars and Windows-illegal chars
  let name = raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/<>:"|?*]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s_]+|[.\s]+$/g, '');

  if (!name) return '';

  const dotIdx = name.lastIndexOf('.');
  let stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  let ext = dotIdx > 0 ? name.slice(dotIdx) : '';

  stem = stem.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!stem) return '';

  const baseStem = stem.split('.')[0] ?? stem;
  if (WINDOWS_RESERVED_NAME_RE.test(baseStem)) {
    stem = `_${stem}`;
  }

  // Cap total filename length to 120 chars while keeping reasonable extension
  if (ext.length > 16) {
    stem = `${stem}${ext}`;
    ext = '';
  }
  const maxStemLen = Math.max(1, MAX_EXPORT_FILENAME_LEN - ext.length);
  if (stem.length > maxStemLen) {
    stem = stem.slice(0, maxStemLen).replace(/[.\s]+$/g, '');
  }

  name = `${stem}${ext}`.replace(/[.\s]+$/g, '');
  return name.slice(0, MAX_EXPORT_FILENAME_LEN);
}

function ensureFilenameExtension(filename: string, ext: string): string {
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  const lower = filename.toLowerCase();
  if (lower.endsWith(normalizedExt.toLowerCase())) {
    return sanitizeExportFilename(filename, `notl-sare${normalizedExt}`);
  }
  const maxBaseLen = MAX_EXPORT_FILENAME_LEN - normalizedExt.length;
  const trimmedBase = filename.slice(0, Math.max(1, maxBaseLen)).replace(/[.\s]+$/g, '');
  return sanitizeExportFilename(`${trimmedBase}${normalizedExt}`, `notl-sare${normalizedExt}`);
}

// ---------------------------------------------------------------------------
// Browser Fallback Persistence (localStorage + IndexedDB + in-memory cache)
// ---------------------------------------------------------------------------

const LS_KEYS = {
  folders: 'notl-sare.folders.v1',
  scores: 'notl-sare.scores.v1',
  bookmarks: 'notl-sare.bookmarks.v1',
  setlists: 'notl-sare.setlists.v1',
  annotations: 'notl-sare.annotations.v1',
  settings: 'notl-sare.settings.v1',
} as const;

const IDB_NAME = 'notl-sare-pdfs';
const IDB_STORE = 'files';

const memoryStorageFallback = new Map<string, string>();
const memoryPdfStore = new Map<string, Uint8Array>();

let browserWakeLockActive = false;
let browserWakeLockSentinel: {
  release?: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
} | null = null;
let browserWakeLockQueue: Promise<boolean> = Promise.resolve(false);
let wakeLockVisibilityRegistered = false;

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(key)
        : (memoryStorageFallback.get(key) ?? null);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    const raw = memoryStorageFallback.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
}

function writeStorageJson<T>(key: string, value: T): void {
  const serialized = JSON.stringify(value);
  memoryStorageFallback.set(key, serialized);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    }
  } catch {
    // Ignore quota or storage restriction errors; in-memory fallback remains intact
  }
}

function makeBrowserId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `nl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openPdfIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putBrowserPdfBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  memoryPdfStore.set(filePath, copy);

  const db = await openPdfIndexedDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(copy, filePath);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function getBrowserPdfBytes(filePath: string): Promise<Uint8Array | null> {
  const cached = memoryPdfStore.get(filePath);
  if (cached) {
    return new Uint8Array(cached);
  }

  const db = await openPdfIndexedDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(filePath);
      req.onsuccess = () => {
        db.close();
        const val = req.result;
        if (val instanceof Uint8Array) {
          memoryPdfStore.set(filePath, val);
          resolve(new Uint8Array(val));
        } else if (val instanceof ArrayBuffer) {
          const arr = new Uint8Array(val);
          memoryPdfStore.set(filePath, arr);
          resolve(new Uint8Array(arr));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function deleteBrowserPdfBytes(filePath: string): Promise<void> {
  memoryPdfStore.delete(filePath);
  const db = await openPdfIndexedDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(filePath);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function clearBrowserPdfStore(): Promise<void> {
  memoryPdfStore.clear();
  const db = await openPdfIndexedDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to pure-JS SHA-256
    }
  }
  return sha256HexSync(copy);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256HexSync(data: Uint8Array): string {
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

function deriveTitleFromFilename(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const rawStem = (dotIdx > 0 ? filename.slice(0, dotIdx) : filename).trim();
  if (!rawStem) return 'Namnlös not';
  const hadSpaces = rawStem.includes(' ');
  let replaced = rawStem.replace(/_/g, ' ');
  if (!hadSpaces) {
    replaced = replaced.replace(/-/g, ' ');
  }
  const collapsed = replaced.replace(/\s+/g, ' ').trim();
  return collapsed || rawStem;
}

function filenameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || 'score.pdf';
}

function sortScoresDefault(scores: ScoreRecord[]): ScoreRecord[] {
  return [...scores].sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) {
      const cmp = b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      if (cmp !== 0) return cmp;
    } else if (a.lastOpenedAt && !b.lastOpenedAt) {
      return -1;
    } else if (!a.lastOpenedAt && b.lastOpenedAt) {
      return 1;
    }
    const titleCmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    if (titleCmp !== 0) return titleCmp;
    return a.id.localeCompare(b.id);
  });
}

function defaultPageAnnotations(scoreId: string, pageNum: number): PageAnnotations {
  const defaultLayer: AnnotationLayer = {
    id: 'default',
    name: 'Anteckningar',
    visible: true,
  };
  return {
    scoreId,
    pageNum,
    layers: [defaultLayer],
    items: [],
    updatedAt: '',
  };
}

function triggerBrowserDownload(filename: string, bytes: Uint8Array, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFilesViaBrowserInput(accept: string, multiple: boolean): Promise<File[]> {
  if (typeof document === 'undefined') {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    let settled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      if (focusTimer !== null) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(files);
    };

    const onWindowFocus = () => {
      if (focusTimer !== null) {
        clearTimeout(focusTimer);
      }
      // Give browsers time to dispatch `change` after closing the native picker
      focusTimer = setTimeout(() => {
        if (!settled) {
          finish(input.files ? Array.from(input.files) : []);
        }
      }, 1500);
    };

    input.addEventListener('change', () => {
      finish(input.files ? Array.from(input.files) : []);
    });
    input.addEventListener('cancel', () => {
      finish([]);
    });

    document.body.appendChild(input);
    window.addEventListener('focus', onWindowFocus);
    input.click();
  });
}

async function importBrowserPdfPaths(filePaths: string[]): Promise<ScoreRecord[]> {
  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  const imported: ScoreRecord[] = [];

  for (const filePath of filePaths) {
    const existingByPath = scores.find((s) => s.filePath === filePath);
    if (existingByPath) {
      imported.push(existingByPath);
      continue;
    }

    const bytes = await getBrowserPdfBytes(filePath);
    if (!bytes) {
      throw new Error(`Browser PDF bytes not found for path: ${filePath}`);
    }
    const sha256 = await sha256Hex(bytes);
    const filename = filenameFromPath(filePath);

    // Check SHA-256 reconciliation if an existing browser record lost its binary
    const existingBySha = scores.find((s) => s.sha256 === sha256);
    if (existingBySha && !(await getBrowserPdfBytes(existingBySha.filePath))) {
      existingBySha.filePath = filePath;
      existingBySha.filename = filename;
      imported.push(existingBySha);
      continue;
    }

    const created: ScoreRecord = {
      id: makeBrowserId(),
      filePath,
      sha256,
      title: deriveTitleFromFilename(filename),
      filename,
      pageCount: 0,
      lastPage: 1,
      lastOpenedAt: null,
      favorite: false,
      tags: [],
      crop: null,
      savedBpm: null,
      savedTimeSignature: null,
      savedPitch: null,
    };
    scores.push(created);
    imported.push(created);
  }

  writeStorageJson(LS_KEYS.scores, scores);
  return imported;
}

// ---------------------------------------------------------------------------
// Public IPC & Browser-Fallback API
// ---------------------------------------------------------------------------

export async function pickAndAddLibraryFolder(): Promise<LibraryFolder | null> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.PICK_AND_ADD_LIBRARY_FOLDER, {});
  }
  return null;
}

export async function removeLibraryFolder(folderId: string): Promise<void> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.REMOVE_LIBRARY_FOLDER, { folderId });
  }
  const folders = readStorageJson<LibraryFolder[]>(LS_KEYS.folders, []);
  writeStorageJson(
    LS_KEYS.folders,
    folders.filter((f) => f.id !== folderId),
  );
}

export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.LIST_LIBRARY_FOLDERS, {});
  }
  return readStorageJson<LibraryFolder[]>(LS_KEYS.folders, []);
}

export async function scanLibrary(folderId?: string): Promise<LibraryScanResult> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.SCAN_LIBRARY, folderId ? { folderId } : {});
  }
  const scores = sortScoresDefault(readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []));
  return {
    added: 0,
    updated: 0,
    missing: 0,
    scores,
  };
}

export async function pickAndImportPdfFiles(): Promise<ScoreRecord[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.PICK_AND_IMPORT_PDF_FILES, {});
  }

  const files = await pickFilesViaBrowserInput('application/pdf,.pdf', true);
  if (files.length === 0) return [];
  return importPdfFromFileObjects(files);
}

export async function importPdfFromFileObjects(
  files: FileList | File[],
): Promise<ScoreRecord[]> {
  const list = Array.from(files);
  const paths: string[] = [];
  for (const file of list) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    const pseudoPath = `idb://pdf/${sha256.slice(0, 16)}/${file.name}`;
    await putBrowserPdfBytes(pseudoPath, bytes);
    paths.push(pseudoPath);
  }
  return importBrowserPdfPaths(paths);
}

export async function listScores(filter?: ScoreFilter): Promise<ScoreRecord[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.LIST_SCORES, filter ? { filter } : {});
  }

  const allScores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  let scores: ScoreRecord[];

  if (filter?.setlistId) {
    const setlists = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
    const sl = setlists.find((s) => s.id === filter.setlistId);
    if (!sl) {
      scores = [];
    } else {
      const byId = new Map(allScores.map((s) => [s.id, s]));
      scores = [...sl.items]
        .sort((a, b) => a.position - b.position)
        .map((item) => byId.get(item.scoreId))
        .filter((s): s is ScoreRecord => Boolean(s));
    }
  } else {
    scores = sortScoresDefault(allScores);
  }

  if (filter?.favoriteOnly) {
    scores = scores.filter((s) => s.favorite);
  }
  if (filter?.tag && filter.tag.trim()) {
    const tagLc = filter.tag.trim().toLowerCase();
    scores = scores.filter((s) => s.tags.some((t) => t.toLowerCase() === tagLc));
  }
  if (filter?.query && filter.query.trim()) {
    const qLc = filter.query.trim().toLowerCase();
    scores = scores.filter(
      (s) =>
        s.title.toLowerCase().includes(qLc) ||
        s.filename.toLowerCase().includes(qLc) ||
        s.tags.some((t) => t.toLowerCase().includes(qLc)),
    );
  }

  return scores;
}

export async function getScore(scoreId: string): Promise<ScoreRecord | null> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.GET_SCORE, { scoreId });
  }
  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  return scores.find((s) => s.id === scoreId) ?? null;
}

export async function updateScoreMetadata(
  scoreId: string,
  patch: ScoreMetadataPatch,
): Promise<ScoreRecord> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.UPDATE_SCORE_METADATA, { scoreId, patch });
  }

  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  const idx = scores.findIndex((s) => s.id === scoreId);
  if (idx === -1) {
    throw new Error(`Score not found: ${scoreId}`);
  }

  const current = { ...scores[idx] };
  if (patch.title !== undefined && patch.title.trim()) {
    current.title = patch.title.trim();
  }
  if (patch.pageCount !== undefined) {
    current.pageCount = patch.pageCount;
  }
  if (patch.lastPage !== undefined) {
    current.lastPage = Math.max(1, patch.lastPage);
  }
  if (patch.lastOpenedAt !== undefined) {
    current.lastOpenedAt = patch.lastOpenedAt;
  }
  if (patch.favorite !== undefined) {
    current.favorite = patch.favorite;
  }
  if (patch.tags !== undefined) {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const raw of patch.tags) {
      const t = raw.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        clean.push(t);
      }
    }
    current.tags = clean;
  }
  if (patch.crop !== undefined) {
    current.crop = patch.crop;
  }
  if (patch.savedBpm !== undefined) {
    current.savedBpm =
      patch.savedBpm === null ? null : Math.min(240, Math.max(30, patch.savedBpm));
  }
  if (patch.savedTimeSignature !== undefined) {
    current.savedTimeSignature = patch.savedTimeSignature;
  }
  if (patch.savedPitch !== undefined) {
    current.savedPitch = patch.savedPitch;
  }

  scores[idx] = current;
  writeStorageJson(LS_KEYS.scores, scores);
  return current;
}

export async function deleteScoreRecord(scoreId: string): Promise<void> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.DELETE_SCORE_RECORD, { scoreId });
  }

  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  const target = scores.find((s) => s.id === scoreId);
  const remaining = scores.filter((s) => s.id !== scoreId);
  writeStorageJson(LS_KEYS.scores, remaining);

  if (target?.filePath && !remaining.some((s) => s.filePath === target.filePath)) {
    await deleteBrowserPdfBytes(target.filePath);
  }

  const bookmarks = readStorageJson<Bookmark[]>(LS_KEYS.bookmarks, []);
  writeStorageJson(
    LS_KEYS.bookmarks,
    bookmarks.filter((b) => b.scoreId !== scoreId),
  );

  const setlists = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
  writeStorageJson(
    LS_KEYS.setlists,
    setlists.map((sl) => ({
      ...sl,
      items: sl.items.filter((item) => item.scoreId !== scoreId),
    })),
  );

  const anns = readStorageJson<Record<string, PageAnnotations>>(LS_KEYS.annotations, {});
  const prefix = `${scoreId}::`;
  for (const key of Object.keys(anns)) {
    if (key.startsWith(prefix)) {
      delete anns[key];
    }
  }
  writeStorageJson(LS_KEYS.annotations, anns);
}

export async function readPdfBytes(
  scoreId: string,
  fallbackFilePath?: string,
): Promise<Uint8Array> {
  if (isTauriEnv()) {
    const raw = await tauriInvoke(IPC_COMMANDS.READ_PDF_BYTES, { scoreId });
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }

  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  const match = scores.find((s) => s.id === scoreId);
  const candidatePaths = [match?.filePath, fallbackFilePath, scoreId].filter(
    (p): p is string => Boolean(p),
  );

  for (const path of candidatePaths) {
    const bytes = await getBrowserPdfBytes(path);
    if (bytes) {
      return bytes;
    }
  }

  throw new Error(`PDF not found in browser store: ${scoreId}`);
}

export async function exportPdfWithDialog(
  defaultName: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const safeName = ensureFilenameExtension(
    sanitizeExportFilename(defaultName, 'notl-sare-export.pdf'),
    '.pdf',
  );

  if (isTauriEnv()) {
    return invoke<boolean>(IPC_COMMANDS.EXPORT_PDF_WITH_DIALOG, bytes, {
      headers: {
        'x-default-filename': encodeURIComponent(safeName),
      },
    });
  }

  triggerBrowserDownload(safeName, bytes, 'application/pdf');
  return true;
}

export async function listBookmarks(scoreId: string): Promise<Bookmark[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.LIST_BOOKMARKS, { scoreId });
  }
  const all = readStorageJson<Bookmark[]>(LS_KEYS.bookmarks, []);
  return all
    .filter((b) => b.scoreId === scoreId)
    .sort((a, b) => a.pageNum - b.pageNum || a.createdAt.localeCompare(b.createdAt));
}

export async function upsertBookmark(bookmark: UpsertBookmarkInput): Promise<Bookmark> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.UPSERT_BOOKMARK, { bookmark });
  }
  const all = readStorageJson<Bookmark[]>(LS_KEYS.bookmarks, []);
  const pageNum = Math.max(1, bookmark.pageNum);
  const label = bookmark.label.trim();

  if (bookmark.id) {
    const idx = all.findIndex((b) => b.id === bookmark.id);
    if (idx !== -1) {
      const updated: Bookmark = {
        ...all[idx],
        pageNum,
        label,
      };
      all[idx] = updated;
      writeStorageJson(LS_KEYS.bookmarks, all);
      return updated;
    }
  }

  const created: Bookmark = {
    id: bookmark.id?.trim() || makeBrowserId(),
    scoreId: bookmark.scoreId,
    pageNum,
    label,
    createdAt: new Date().toISOString(),
  };
  writeStorageJson(LS_KEYS.bookmarks, [...all, created]);
  return created;
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.DELETE_BOOKMARK, { bookmarkId });
  }
  const all = readStorageJson<Bookmark[]>(LS_KEYS.bookmarks, []);
  writeStorageJson(
    LS_KEYS.bookmarks,
    all.filter((b) => b.id !== bookmarkId),
  );
}

export async function listSetlists(): Promise<Setlist[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.LIST_SETLISTS, {});
  }
  return readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
}

export async function createSetlist(name: string): Promise<Setlist> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.CREATE_SETLIST, { name });
  }
  const clean = name.trim();
  if (!clean) throw new Error('Setlist name cannot be empty');
  const all = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
  const created: Setlist = {
    id: makeBrowserId(),
    name: clean,
    createdAt: new Date().toISOString(),
    items: [],
  };
  writeStorageJson(LS_KEYS.setlists, [...all, created]);
  return created;
}

export async function renameSetlist(setlistId: string, name: string): Promise<Setlist> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.RENAME_SETLIST, { setlistId, name });
  }
  const clean = name.trim();
  if (!clean) throw new Error('Setlist name cannot be empty');
  const all = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
  const idx = all.findIndex((s) => s.id === setlistId);
  if (idx === -1) throw new Error(`Setlist not found: ${setlistId}`);
  const updated = { ...all[idx], name: clean };
  all[idx] = updated;
  writeStorageJson(LS_KEYS.setlists, all);
  return updated;
}

export async function deleteSetlist(setlistId: string): Promise<void> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.DELETE_SETLIST, { setlistId });
  }
  const all = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
  writeStorageJson(
    LS_KEYS.setlists,
    all.filter((s) => s.id !== setlistId),
  );
}

export async function setSetlistItems(
  setlistId: string,
  items: SetlistItem[],
): Promise<Setlist> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.SET_SETLIST_ITEMS, { setlistId, items });
  }
  const all = readStorageJson<Setlist[]>(LS_KEYS.setlists, []);
  const idx = all.findIndex((s) => s.id === setlistId);
  if (idx === -1) throw new Error(`Setlist not found: ${setlistId}`);
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const updated: Setlist = { ...all[idx], items: sorted };
  all[idx] = updated;
  writeStorageJson(LS_KEYS.setlists, all);
  return updated;
}

export async function getPageAnnotations(
  scoreId: string,
  pageNum: number,
): Promise<PageAnnotations> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.GET_PAGE_ANNOTATIONS, { scoreId, pageNum });
  }
  const anns = readStorageJson<Record<string, PageAnnotations>>(LS_KEYS.annotations, {});
  const found = anns[`${scoreId}::${pageNum}`];
  if (!found) {
    return defaultPageAnnotations(scoreId, pageNum);
  }
  return {
    ...found,
    layers:
      found.layers.length > 0 ? found.layers : defaultPageAnnotations(scoreId, pageNum).layers,
  };
}

export async function getScoreAnnotations(scoreId: string): Promise<PageAnnotations[]> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.GET_SCORE_ANNOTATIONS, { scoreId });
  }
  const anns = readStorageJson<Record<string, PageAnnotations>>(LS_KEYS.annotations, {});
  return Object.values(anns)
    .filter((a) => a.scoreId === scoreId)
    .sort((a, b) => a.pageNum - b.pageNum);
}

export async function savePageAnnotations(
  annotations: PageAnnotations,
): Promise<PageAnnotations> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.SAVE_PAGE_ANNOTATIONS, { annotations });
  }
  const anns = readStorageJson<Record<string, PageAnnotations>>(LS_KEYS.annotations, {});
  const saved: PageAnnotations = {
    scoreId: annotations.scoreId,
    pageNum: annotations.pageNum,
    layers:
      annotations.layers.length > 0
        ? annotations.layers
        : defaultPageAnnotations(annotations.scoreId, annotations.pageNum).layers,
    items: annotations.items,
    updatedAt: new Date().toISOString(),
  };
  anns[`${annotations.scoreId}::${annotations.pageNum}`] = saved;
  writeStorageJson(LS_KEYS.annotations, anns);
  return saved;
}

export async function getSettings(): Promise<AppSettings> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.GET_SETTINGS, {});
  }
  const stored = readStorageJson<Partial<AppSettings>>(LS_KEYS.settings, {});
  return {
    ...DEFAULT_APP_SETTINGS,
    ...stored,
    referencePitchHz: Math.min(
      444,
      Math.max(438, stored.referencePitchHz ?? DEFAULT_APP_SETTINGS.referencePitchHz),
    ),
  };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.SAVE_SETTINGS, { settings });
  }
  const clamped: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
    referencePitchHz: Math.min(444, Math.max(438, settings.referencePitchHz)),
  };
  writeStorageJson(LS_KEYS.settings, clamped);
  return clamped;
}

function ensureWakeLockVisibilityListener(): void {
  if (wakeLockVisibilityRegistered || typeof document === 'undefined') {
    return;
  }
  wakeLockVisibilityRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      browserWakeLockActive &&
      !isTauriEnv()
    ) {
      void setWakeLock(true).catch(() => {});
    }
  });
}

async function applyBrowserWakeLock(enabled: boolean): Promise<boolean> {
  browserWakeLockActive = enabled;
  ensureWakeLockVisibilityListener();

  if (browserWakeLockSentinel?.release) {
    try {
      await browserWakeLockSentinel.release();
    } catch {
      // Ignore release failures on already-released sentinels
    }
    browserWakeLockSentinel = null;
  }

  if (!enabled) {
    return false;
  }

  try {
    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: 'screen') => Promise<{
          release: () => Promise<void>;
          addEventListener?: (type: string, listener: () => void) => void;
        }>;
      };
    };
    const isVisible =
      typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (nav.wakeLock && isVisible) {
      const sentinel = await nav.wakeLock.request('screen');
      browserWakeLockSentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (browserWakeLockSentinel === sentinel) {
          browserWakeLockSentinel = null;
        }
      });
    }
  } catch {
    // Browser Wake Lock requires HTTPS/user gesture; track desired boolean silently
  }

  return browserWakeLockActive;
}

export async function setWakeLock(enabled: boolean): Promise<boolean> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.SET_WAKE_LOCK, { enabled });
  }
  const next = browserWakeLockQueue.then(
    () => applyBrowserWakeLock(enabled),
    () => applyBrowserWakeLock(enabled),
  );
  browserWakeLockQueue = next;
  return next;
}

// ---------------------------------------------------------------------------
// Dialog & Backup Helpers
// ---------------------------------------------------------------------------

export async function saveTextFileWithDialog(
  defaultName: string,
  content: string,
): Promise<boolean> {
  const safeName = ensureFilenameExtension(
    sanitizeExportFilename(defaultName, 'notl-sare-backup.json'),
    '.json',
  );

  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.EXPORT_BACKUP_WITH_DIALOG, {
      defaultFilename: safeName,
      jsonContent: content,
    });
  }

  triggerBrowserDownload(
    safeName,
    new TextEncoder().encode(content),
    'application/json;charset=utf-8',
  );
  return true;
}

export async function openTextFileWithDialog(): Promise<string | null> {
  if (isTauriEnv()) {
    return tauriInvoke(IPC_COMMANDS.IMPORT_BACKUP_WITH_DIALOG, {});
  }

  const files = await pickFilesViaBrowserInput('application/json,.json', false);
  if (files.length === 0) return null;
  return files[0].text();
}

export async function exportBackupJson(): Promise<string> {
  const [settings, scores, setlists] = await Promise.all([
    getSettings(),
    listScores(),
    listSetlists(),
  ]);

  const scoreById = new Map(scores.map((s) => [s.id, s]));

  const scoreEntries: NotlSareBackupScoreV1[] = await Promise.all(
    scores.map(async (score) => {
      const [bookmarks, annotations] = await Promise.all([
        listBookmarks(score.id),
        getScoreAnnotations(score.id),
      ]);
      return {
        sha256: score.sha256,
        filename: score.filename,
        title: score.title,
        pageCount: score.pageCount,
        lastPage: score.lastPage,
        lastOpenedAt: score.lastOpenedAt,
        favorite: score.favorite,
        tags: score.tags,
        crop: score.crop,
        savedBpm: score.savedBpm,
        savedTimeSignature: score.savedTimeSignature,
        savedPitch: score.savedPitch,
        bookmarks: bookmarks.map((b) => ({
          pageNum: b.pageNum,
          label: b.label,
          createdAt: b.createdAt,
        })),
        annotations,
      };
    }),
  );

  const setlistEntries: NotlSareBackupSetlistV1[] = setlists.map((sl) => ({
    id: sl.id,
    name: sl.name,
    createdAt: sl.createdAt,
    items: sl.items
      .map((item) => {
        const score = scoreById.get(item.scoreId);
        if (!score) return null;
        return {
          sha256: score.sha256,
          filename: score.filename,
          position: item.position,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  }));

  const payload: NotlSareBackupV1 = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    scores: scoreEntries,
    setlists: setlistEntries,
  };

  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Strict Backup JSON Schema Validator
// ---------------------------------------------------------------------------

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function assertBoundedString(val: unknown, label: string, maxLen: number): string {
  if (typeof val !== 'string') {
    throw new Error(`Invalid ${label}: expected string`);
  }
  if (val.length > maxLen) {
    throw new Error(`Invalid ${label}: exceeds maximum length`);
  }
  return val;
}

function assertFiniteNumber(val: unknown, label: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`Invalid ${label}: expected finite number`);
  }
  return val;
}

function assertUnitNumber(val: unknown, label: string): number {
  const num = assertFiniteNumber(val, label);
  return Math.max(0, Math.min(1, num));
}

function assertValidColor(val: unknown, label: string): string {
  const str = assertBoundedString(val, label, 64).trim();
  if (!STRICT_COLOR_RE.test(str)) {
    throw new Error(`Invalid ${label}: unsupported color format`);
  }
  return str;
}

function validateNormalizedPoint(val: unknown, label: string): NormalizedPoint {
  if (!isPlainObject(val)) {
    throw new Error(`Invalid ${label}: expected point object`);
  }
  return {
    x: assertUnitNumber(val.x, `${label}.x`),
    y: assertUnitNumber(val.y, `${label}.y`),
  };
}

function validateNormalizedRect(val: unknown, label: string): NormalizedRect {
  if (!isPlainObject(val)) {
    throw new Error(`Invalid ${label}: expected rect object`);
  }
  const x = assertUnitNumber(val.x, `${label}.x`);
  const y = assertUnitNumber(val.y, `${label}.y`);
  const width = assertUnitNumber(val.width, `${label}.width`);
  const height = assertUnitNumber(val.height, `${label}.height`);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid ${label}: rect dimensions must be positive`);
  }
  return { x, y, width, height };
}

function validateCropSettings(val: unknown): CropSettings | null {
  if (val === null || val === undefined) return null;
  if (!isPlainObject(val)) {
    throw new Error('Invalid crop settings');
  }
  if (typeof val.mode !== 'string' || !VALID_CROP_MODES.has(val.mode as CropMode)) {
    throw new Error('Invalid crop mode');
  }
  const out: CropSettings = { mode: val.mode as CropMode };
  if (val.manualBox !== undefined) {
    out.manualBox = validateNormalizedRect(val.manualBox, 'crop.manualBox');
  }
  if (val.autoCache !== undefined) {
    if (!isPlainObject(val.autoCache)) {
      throw new Error('Invalid crop.autoCache');
    }
    const entries = Object.entries(val.autoCache);
    if (entries.length > MAX_PAGES_PER_SCORE) {
      throw new Error('crop.autoCache exceeds maximum page limit');
    }
    const cleanCache: Record<number, NormalizedRect> = {};
    for (const [k, rect] of entries) {
      const pageNum = Number(k);
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > MAX_PAGES_PER_SCORE) {
        throw new Error('Invalid page key in crop.autoCache');
      }
      cleanCache[pageNum] = validateNormalizedRect(rect, `crop.autoCache[${k}]`);
    }
    out.autoCache = cleanCache;
  }
  return out;
}

function validateSavedPitch(val: unknown): SavedPitch | null {
  if (val === null || val === undefined) return null;
  if (!isPlainObject(val)) {
    throw new Error('Invalid savedPitch');
  }
  if (!Array.isArray(val.midiNotes) || val.midiNotes.length > 24) {
    throw new Error('Invalid savedPitch.midiNotes');
  }
  const midiNotes = val.midiNotes.map((n, i) => {
    const num = assertFiniteNumber(n, `savedPitch.midiNotes[${i}]`);
    if (!Number.isInteger(num) || num < 0 || num > 127) {
      throw new Error('Invalid MIDI note in savedPitch');
    }
    return num;
  });
  const pitch: SavedPitch = { midiNotes };
  if (val.label !== undefined) {
    pitch.label = assertBoundedString(val.label, 'savedPitch.label', MAX_STRING_SHORT);
  }
  if (val.octaveOffset !== undefined) {
    pitch.octaveOffset = assertFiniteNumber(val.octaveOffset, 'savedPitch.octaveOffset');
  }
  return pitch;
}

function validateSettings(val: unknown): AppSettings {
  if (!isPlainObject(val)) {
    throw new Error('Invalid settings object in backup');
  }
  const next: AppSettings = { ...DEFAULT_APP_SETTINGS };
  if (val.language !== undefined) {
    if (typeof val.language !== 'string' || !VALID_LANGUAGES.has(val.language as AppLanguage)) {
      throw new Error('Invalid settings.language');
    }
    next.language = val.language as AppLanguage;
  }
  if (val.noteNaming !== undefined) {
    if (
      typeof val.noteNaming !== 'string' ||
      !VALID_NOTE_NAMINGS.has(val.noteNaming as NoteNaming)
    ) {
      throw new Error('Invalid settings.noteNaming');
    }
    next.noteNaming = val.noteNaming as NoteNaming;
  }
  if (val.theme !== undefined) {
    if (typeof val.theme !== 'string' || !VALID_THEMES.has(val.theme as AppTheme)) {
      throw new Error('Invalid settings.theme');
    }
    next.theme = val.theme as AppTheme;
  }
  if (val.paperTint !== undefined) {
    if (
      typeof val.paperTint !== 'string' ||
      !VALID_PAPER_TINTS.has(val.paperTint as PaperTint)
    ) {
      throw new Error('Invalid settings.paperTint');
    }
    next.paperTint = val.paperTint as PaperTint;
  }
  if (val.referencePitchHz !== undefined) {
    const hz = assertFiniteNumber(val.referencePitchHz, 'settings.referencePitchHz');
    next.referencePitchHz = Math.min(444, Math.max(438, hz));
  }
  const boolKeys = [
    'swipeEnabled',
    'tapZonesEnabled',
    'halfPageModeDefault',
    'autoCropDefault',
    'wakeLockEnabled',
  ] as const;
  for (const key of boolKeys) {
    if (val[key] !== undefined) {
      if (typeof val[key] !== 'boolean') {
        throw new Error(`Invalid settings.${key}`);
      }
      next[key] = val[key] as boolean;
    }
  }
  if (val.defaultVoiceProfile !== undefined) {
    if (val.defaultVoiceProfile !== 'bass') {
      throw new Error('Invalid settings.defaultVoiceProfile');
    }
    next.defaultVoiceProfile = 'bass';
  }
  return next;
}

function validateAnnotationItem(val: unknown, idx: number): AnnotationItem {
  if (!isPlainObject(val)) {
    throw new Error(`Invalid annotation item [${idx}]`);
  }
  const id = assertBoundedString(val.id, `item[${idx}].id`, MAX_STRING_SHORT);
  const layerId = assertBoundedString(val.layerId, `item[${idx}].layerId`, MAX_STRING_SHORT);
  const kind = val.kind;

  if (kind === 'stroke') {
    if (val.tool !== 'pen' && val.tool !== 'highlighter') {
      throw new Error(`Invalid stroke tool at [${idx}]`);
    }
    if (!Array.isArray(val.points) || val.points.length > MAX_POINTS_PER_STROKE) {
      throw new Error(`Invalid stroke points at [${idx}]`);
    }
    const points = val.points.map((pt, pIdx) => {
      if (!isPlainObject(pt)) {
        throw new Error(`Invalid stroke point [${idx}][${pIdx}]`);
      }
      const x = assertUnitNumber(pt.x, 'point.x');
      const y = assertUnitNumber(pt.y, 'point.y');
      if (pt.p !== undefined) {
        const p = assertUnitNumber(pt.p, 'point.p');
        return { x, y, p };
      }
      return { x, y };
    });
    const width = assertFiniteNumber(val.width, `stroke[${idx}].width`);
    if (width <= 0 || width > 1) {
      throw new Error(`Invalid stroke width at [${idx}]`);
    }
    const opacity = assertUnitNumber(val.opacity, `stroke[${idx}].opacity`);
    const color = assertValidColor(val.color, `stroke[${idx}].color`);
    const multiply =
      val.multiply !== undefined
        ? typeof val.multiply === 'boolean'
          ? val.multiply
          : (() => {
              throw new Error(`Invalid stroke multiply at [${idx}]`);
            })()
        : undefined;
    return {
      kind: 'stroke',
      id,
      layerId,
      tool: val.tool,
      points,
      color,
      width,
      opacity,
      ...(multiply !== undefined ? { multiply } : {}),
    };
  }

  if (kind === 'shape') {
    if (typeof val.shapeType !== 'string' || !VALID_SHAPE_TYPES.has(val.shapeType as ShapeType)) {
      throw new Error(`Invalid shapeType at [${idx}]`);
    }
    const width = assertFiniteNumber(val.width, `shape[${idx}].width`);
    if (width <= 0 || width > 1) {
      throw new Error(`Invalid shape width at [${idx}]`);
    }
    return {
      kind: 'shape',
      id,
      layerId,
      shapeType: val.shapeType as ShapeType,
      start: validateNormalizedPoint(val.start, `shape[${idx}].start`),
      end: validateNormalizedPoint(val.end, `shape[${idx}].end`),
      ...(val.control !== undefined
        ? { control: validateNormalizedPoint(val.control, `shape[${idx}].control`) }
        : {}),
      color: assertValidColor(val.color, `shape[${idx}].color`),
      width,
    };
  }

  if (kind === 'stamp') {
    const stampType = assertBoundedString(val.stampType, `stamp[${idx}].stampType`, 64);
    const scale = assertFiniteNumber(val.scale, `stamp[${idx}].scale`);
    if (scale <= 0 || scale > 20) {
      throw new Error(`Invalid stamp scale at [${idx}]`);
    }
    const rotation =
      val.rotation !== undefined
        ? assertFiniteNumber(val.rotation, `stamp[${idx}].rotation`)
        : undefined;
    return {
      kind: 'stamp',
      id,
      layerId,
      stampType: stampType as AnnotationItem extends { kind: 'stamp'; stampType: infer S } ? S : never,
      position: validateNormalizedPoint(val.position, `stamp[${idx}].position`),
      scale,
      ...(rotation !== undefined ? { rotation } : {}),
      color: assertValidColor(val.color, `stamp[${idx}].color`),
    };
  }

  if (kind === 'text') {
    const text = assertBoundedString(val.text, `text[${idx}].text`, MAX_STRING_TEXT);
    const fontSize = assertFiniteNumber(val.fontSize, `text[${idx}].fontSize`);
    if (fontSize <= 0 || fontSize > 1) {
      throw new Error(`Invalid text fontSize at [${idx}]`);
    }
    const bgColor =
      val.bgColor !== undefined
        ? assertValidColor(val.bgColor, `text[${idx}].bgColor`)
        : undefined;
    return {
      kind: 'text',
      id,
      layerId,
      position: validateNormalizedPoint(val.position, `text[${idx}].position`),
      text,
      fontSize,
      color: assertValidColor(val.color, `text[${idx}].color`),
      ...(bgColor !== undefined ? { bgColor } : {}),
    };
  }

  throw new Error(`Unsupported annotation item kind at [${idx}]`);
}

function validatePageAnnotations(val: unknown): Omit<PageAnnotations, 'scoreId'> {
  if (!isPlainObject(val)) {
    throw new Error('Invalid page annotation entry');
  }
  const pageNum = assertFiniteNumber(val.pageNum, 'pageAnnotation.pageNum');
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > MAX_PAGES_PER_SCORE) {
    throw new Error('Invalid pageAnnotation.pageNum');
  }
  if (!Array.isArray(val.layers) || val.layers.length > MAX_LAYERS_PER_PAGE) {
    throw new Error('Invalid pageAnnotation.layers');
  }
  const layers: AnnotationLayer[] = val.layers.map((layer, idx) => {
    if (!isPlainObject(layer)) {
      throw new Error(`Invalid layer at [${idx}]`);
    }
    if (typeof layer.visible !== 'boolean') {
      throw new Error(`Invalid layer.visible at [${idx}]`);
    }
    if (layer.locked !== undefined && typeof layer.locked !== 'boolean') {
      throw new Error(`Invalid layer.locked at [${idx}]`);
    }
    return {
      id: assertBoundedString(layer.id, `layer[${idx}].id`, MAX_STRING_SHORT),
      name: assertBoundedString(layer.name, `layer[${idx}].name`, MAX_STRING_SHORT),
      visible: layer.visible,
      ...(layer.locked !== undefined ? { locked: layer.locked } : {}),
    };
  });

  if (!Array.isArray(val.items) || val.items.length > MAX_ANNOTATIONS_PER_PAGE) {
    throw new Error('Invalid pageAnnotation.items');
  }
  const items = val.items.map((item, idx) => validateAnnotationItem(item, idx));
  const updatedAt =
    val.updatedAt !== undefined
      ? assertBoundedString(val.updatedAt, 'pageAnnotation.updatedAt', 64)
      : '';

  return {
    pageNum,
    layers,
    items,
    updatedAt,
  };
}

interface ValidatedScoreEntry {
  sha256: string;
  filePath?: string;
  filename: string;
  patch: ScoreMetadataPatch;
  bookmarks: Array<{ pageNum: number; label: string }>;
  annotations: Array<Omit<PageAnnotations, 'scoreId'>>;
}

interface ValidatedSetlistEntry {
  name: string;
  items: Array<{
    sha256: string;
    filePath?: string;
    filename?: string;
    position: number;
  }>;
}

interface ValidatedBackupPayload {
  settings: AppSettings | null;
  scores: ValidatedScoreEntry[];
  setlists: ValidatedSetlistEntry[];
}

function parseAndValidateBackupJson(jsonText: string): ValidatedBackupPayload {
  if (typeof jsonText !== 'string') {
    throw new Error('Invalid backup JSON');
  }
  if (jsonText.length > MAX_BACKUP_BYTES) {
    throw new Error('Backup JSON exceeds maximum allowed size (25 MB)');
  }
  const byteLen = new TextEncoder().encode(jsonText).byteLength;
  if (byteLen > MAX_BACKUP_BYTES) {
    throw new Error('Backup JSON exceeds maximum allowed size (25 MB)');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`Forbidden key "${key}" in backup JSON`);
      }
      return value;
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Forbidden key')) {
      throw err;
    }
    throw new Error('Invalid backup JSON');
  }

  if (!isPlainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.scores)) {
    throw new Error('Unsupported backup format');
  }
  if (parsed.scores.length > MAX_SCORES_PER_BACKUP) {
    throw new Error('Backup exceeds maximum score count');
  }

  const settings = parsed.settings !== undefined ? validateSettings(parsed.settings) : null;

  const scores: ValidatedScoreEntry[] = parsed.scores.map((rawEntry, idx) => {
    if (!isPlainObject(rawEntry)) {
      throw new Error(`Invalid score entry [${idx}]`);
    }
    const sha256 =
      rawEntry.sha256 !== undefined
        ? assertBoundedString(rawEntry.sha256, `scores[${idx}].sha256`, MAX_STRING_SHORT)
        : '';
    const filePath =
      rawEntry.filePath !== undefined
        ? assertBoundedString(rawEntry.filePath, `scores[${idx}].filePath`, MAX_STRING_TEXT)
        : undefined;
    const filename =
      rawEntry.filename !== undefined
        ? assertBoundedString(rawEntry.filename, `scores[${idx}].filename`, MAX_STRING_MED)
        : '';

    const patch: ScoreMetadataPatch = {};
    if (rawEntry.title !== undefined) {
      patch.title = assertBoundedString(rawEntry.title, `scores[${idx}].title`, MAX_STRING_MED);
    }
    if (rawEntry.pageCount !== undefined) {
      const pc = assertFiniteNumber(rawEntry.pageCount, `scores[${idx}].pageCount`);
      if (!Number.isInteger(pc) || pc < 0 || pc > MAX_PAGES_PER_SCORE) {
        throw new Error(`Invalid pageCount in scores[${idx}]`);
      }
      patch.pageCount = pc;
    }
    if (rawEntry.lastPage !== undefined) {
      const lp = assertFiniteNumber(rawEntry.lastPage, `scores[${idx}].lastPage`);
      if (!Number.isInteger(lp) || lp < 1 || lp > MAX_PAGES_PER_SCORE) {
        throw new Error(`Invalid lastPage in scores[${idx}]`);
      }
      patch.lastPage = lp;
    }
    if (rawEntry.lastOpenedAt !== undefined) {
      patch.lastOpenedAt =
        rawEntry.lastOpenedAt === null
          ? null
          : assertBoundedString(rawEntry.lastOpenedAt, `scores[${idx}].lastOpenedAt`, 64);
    }
    if (rawEntry.favorite !== undefined) {
      if (typeof rawEntry.favorite !== 'boolean') {
        throw new Error(`Invalid favorite in scores[${idx}]`);
      }
      patch.favorite = rawEntry.favorite;
    }
    if (rawEntry.tags !== undefined) {
      if (!Array.isArray(rawEntry.tags) || rawEntry.tags.length > MAX_TAGS_PER_SCORE) {
        throw new Error(`Invalid tags in scores[${idx}]`);
      }
      patch.tags = rawEntry.tags.map((t, tIdx) =>
        assertBoundedString(t, `scores[${idx}].tags[${tIdx}]`, MAX_STRING_SHORT),
      );
    }
    if (rawEntry.crop !== undefined) {
      patch.crop = validateCropSettings(rawEntry.crop);
    }
    if (rawEntry.savedBpm !== undefined) {
      if (rawEntry.savedBpm === null) {
        patch.savedBpm = null;
      } else {
        const bpm = assertFiniteNumber(rawEntry.savedBpm, `scores[${idx}].savedBpm`);
        patch.savedBpm = Math.min(240, Math.max(30, Math.round(bpm)));
      }
    }
    if (rawEntry.savedTimeSignature !== undefined) {
      if (rawEntry.savedTimeSignature === null) {
        patch.savedTimeSignature = null;
      } else if (
        typeof rawEntry.savedTimeSignature === 'string' &&
        VALID_TIME_SIGNATURES.has(rawEntry.savedTimeSignature as TimeSignature)
      ) {
        patch.savedTimeSignature = rawEntry.savedTimeSignature as TimeSignature;
      } else {
        throw new Error(`Invalid savedTimeSignature in scores[${idx}]`);
      }
    }
    if (rawEntry.savedPitch !== undefined) {
      patch.savedPitch = validateSavedPitch(rawEntry.savedPitch);
    }

    const bookmarks: Array<{ pageNum: number; label: string }> = [];
    if (rawEntry.bookmarks !== undefined) {
      if (
        !Array.isArray(rawEntry.bookmarks) ||
        rawEntry.bookmarks.length > MAX_BOOKMARKS_PER_SCORE
      ) {
        throw new Error(`Invalid bookmarks in scores[${idx}]`);
      }
      for (let bIdx = 0; bIdx < rawEntry.bookmarks.length; bIdx++) {
        const bm = rawEntry.bookmarks[bIdx];
        if (!isPlainObject(bm)) {
          throw new Error(`Invalid bookmark [${idx}][${bIdx}]`);
        }
        const pageNum = assertFiniteNumber(bm.pageNum, `bookmark.pageNum`);
        if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > MAX_PAGES_PER_SCORE) {
          throw new Error(`Invalid bookmark pageNum [${idx}][${bIdx}]`);
        }
        const label = assertBoundedString(bm.label, 'bookmark.label', MAX_STRING_MED);
        bookmarks.push({ pageNum, label });
      }
    }

    const annotations: Array<Omit<PageAnnotations, 'scoreId'>> = [];
    if (rawEntry.annotations !== undefined) {
      if (
        !Array.isArray(rawEntry.annotations) ||
        rawEntry.annotations.length > MAX_PAGES_PER_SCORE
      ) {
        throw new Error(`Invalid annotations in scores[${idx}]`);
      }
      for (const pageAnn of rawEntry.annotations) {
        annotations.push(validatePageAnnotations(pageAnn));
      }
    }

    return {
      sha256,
      filePath,
      filename,
      patch,
      bookmarks,
      annotations,
    };
  });

  const setlists: ValidatedSetlistEntry[] = [];
  if (parsed.setlists !== undefined) {
    if (!Array.isArray(parsed.setlists) || parsed.setlists.length > MAX_SETLISTS_PER_BACKUP) {
      throw new Error('Invalid setlists in backup');
    }
    for (let sIdx = 0; sIdx < parsed.setlists.length; sIdx++) {
      const sl = parsed.setlists[sIdx];
      if (!isPlainObject(sl)) {
        throw new Error(`Invalid setlist entry [${sIdx}]`);
      }
      const name = assertBoundedString(sl.name, `setlists[${sIdx}].name`, MAX_STRING_MED).trim();
      if (!name) continue;
      if (sl.items !== undefined && (!Array.isArray(sl.items) || sl.items.length > MAX_ITEMS_PER_SETLIST)) {
        throw new Error(`Invalid setlist items [${sIdx}]`);
      }
      const items = (sl.items ?? []).map((item, iIdx) => {
        if (!isPlainObject(item)) {
          throw new Error(`Invalid setlist item [${sIdx}][${iIdx}]`);
        }
        const sha256 =
          item.sha256 !== undefined
            ? assertBoundedString(item.sha256, 'setlistItem.sha256', MAX_STRING_SHORT)
            : '';
        const filePath =
          item.filePath !== undefined
            ? assertBoundedString(item.filePath, 'setlistItem.filePath', MAX_STRING_TEXT)
            : undefined;
        const filename =
          item.filename !== undefined
            ? assertBoundedString(item.filename, 'setlistItem.filename', MAX_STRING_MED)
            : undefined;
        const position = assertFiniteNumber(item.position, 'setlistItem.position');
        if (!Number.isInteger(position) || position < 0 || position > MAX_ITEMS_PER_SETLIST) {
          throw new Error(`Invalid setlist item position [${sIdx}][${iIdx}]`);
        }
        return { sha256, filePath, filename, position };
      });
      setlists.push({ name, items });
    }
  }

  return { settings, scores, setlists };
}

export async function importBackupJson(
  jsonText: string,
): Promise<ImportBackupResult> {
  // Validate and sanitize the entire backup payload BEFORE mutating any persisted state
  const validated = parseAndValidateBackupJson(jsonText);

  if (validated.settings) {
    await saveSettings(validated.settings);
  }

  const localScores = await listScores();
  const findLocalMatch = (
    sha256?: string,
    filePath?: string,
    filename?: string,
  ): ScoreRecord | undefined => {
    if (sha256 && filePath) {
      const exactLegacy = localScores.find(
        (s) => s.sha256 === sha256 && s.filePath === filePath,
      );
      if (exactLegacy) return exactLegacy;
    }
    if (sha256 && filename) {
      const byHashAndName = localScores.find(
        (s) => s.sha256 === sha256 && s.filename === filename,
      );
      if (byHashAndName) return byHashAndName;
    }
    if (sha256) {
      const byHash = localScores.find((s) => s.sha256 === sha256);
      if (byHash) return byHash;
    }
    if (filePath) {
      const byPath = localScores.find((s) => s.filePath === filePath);
      if (byPath) return byPath;
    }
    if (filename) {
      return localScores.find((s) => s.filename === filename);
    }
    return undefined;
  };

  let scoresUpdated = 0;
  let annotationsRestored = 0;

  for (const entry of validated.scores) {
    const target = findLocalMatch(entry.sha256, entry.filePath, entry.filename);
    if (!target) continue;

    await updateScoreMetadata(target.id, entry.patch);
    scoresUpdated += 1;

    if (entry.bookmarks.length > 0) {
      const existingBookmarks = await listBookmarks(target.id);
      for (const bm of entry.bookmarks) {
        const duplicate = existingBookmarks.some(
          (e) => e.pageNum === bm.pageNum && e.label === bm.label,
        );
        if (!duplicate) {
          await upsertBookmark({
            scoreId: target.id,
            pageNum: bm.pageNum,
            label: bm.label,
          });
        }
      }
    }

    for (const pageAnn of entry.annotations) {
      await savePageAnnotations({
        scoreId: target.id,
        pageNum: pageAnn.pageNum,
        layers: pageAnn.layers,
        items: pageAnn.items,
        updatedAt: pageAnn.updatedAt,
      });
      annotationsRestored += 1;
    }
  }

  if (validated.setlists.length > 0) {
    const existingSetlists = await listSetlists();
    for (const slEntry of validated.setlists) {
      const mappedItems: SetlistItem[] = [];
      for (const item of slEntry.items) {
        const match = findLocalMatch(item.sha256, item.filePath, item.filename);
        if (match) {
          mappedItems.push({ scoreId: match.id, position: item.position });
        }
      }
      if (mappedItems.length === 0) continue;

      const existing = existingSetlists.find(
        (s) => s.name.toLowerCase() === slEntry.name.toLowerCase(),
      );
      const targetSl = existing ?? (await createSetlist(slEntry.name));
      await setSetlistItems(targetSl.id, mappedItems);
    }
  }

  return { scoresUpdated, annotationsRestored };
}

export async function registerMockPdf(
  filename: string,
  bytes: Uint8Array,
  meta?: Partial<ScoreRecord>,
): Promise<ScoreRecord> {
  const sha256 = meta?.sha256 || (await sha256Hex(bytes));
  const filePath = meta?.filePath || `idb://pdf/${sha256.slice(0, 16)}/${filename}`;
  await putBrowserPdfBytes(filePath, bytes);

  const scores = readStorageJson<ScoreRecord[]>(LS_KEYS.scores, []);
  const existingIdx = scores.findIndex(
    (s) => (meta?.id && s.id === meta.id) || s.filePath === filePath,
  );

  const record: ScoreRecord = {
    id: meta?.id || (existingIdx !== -1 ? scores[existingIdx].id : makeBrowserId()),
    filePath,
    sha256,
    title: meta?.title || deriveTitleFromFilename(filename),
    filename,
    pageCount: meta?.pageCount ?? 0,
    lastPage: meta?.lastPage ?? 1,
    lastOpenedAt: meta?.lastOpenedAt ?? null,
    favorite: meta?.favorite ?? false,
    tags: meta?.tags ?? [],
    crop: meta?.crop ?? null,
    savedBpm: meta?.savedBpm ?? null,
    savedTimeSignature: meta?.savedTimeSignature ?? null,
    savedPitch: meta?.savedPitch ?? null,
  };

  if (existingIdx !== -1) {
    scores[existingIdx] = record;
  } else {
    scores.push(record);
  }
  writeStorageJson(LS_KEYS.scores, scores);
  return record;
}

async function resetBrowserStore(): Promise<void> {
  for (const key of Object.values(LS_KEYS)) {
    memoryStorageFallback.delete(key);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage access errors
    }
  }
  browserWakeLockActive = false;
  if (browserWakeLockSentinel?.release) {
    try {
      await browserWakeLockSentinel.release();
    } catch {
      // Ignore release errors
    }
    browserWakeLockSentinel = null;
  }
  await clearBrowserPdfStore();
}

if (typeof window !== 'undefined' && !isTauriEnv() && import.meta.env.MODE === 'test') {
  window.__NOTL_SARE_TEST_API__ = {
    registerMockPdf,
    listScores,
    getScoreAnnotations,
    exportBackupJson,
    importBackupJson,
    resetBrowserStore,
  };
}
