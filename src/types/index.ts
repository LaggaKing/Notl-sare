export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface StrokePoint {
  x: number;
  y: number;
  p?: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropMode = 'auto' | 'manual' | 'none';

export interface CropSettings {
  mode: CropMode;
  manualBox?: NormalizedRect;
  autoCache?: Record<number, NormalizedRect>;
}

export type TimeSignature = '2/4' | '3/4' | '4/4' | '6/8' | '3/8' | '5/4';

export interface SavedPitch {
  midiNotes: number[];
  label?: string;
  octaveOffset?: number;
}

export interface ScoreRecord {
  id: string;
  filePath: string;
  sha256: string;
  title: string;
  filename: string;
  pageCount: number;
  lastPage: number;
  lastOpenedAt: string | null;
  favorite: boolean;
  tags: string[];
  crop: CropSettings | null;
  savedBpm: number | null;
  savedTimeSignature: TimeSignature | null;
  savedPitch: SavedPitch | null;
}

export interface ScoreMetadataPatch {
  title?: string;
  pageCount?: number;
  lastPage?: number;
  lastOpenedAt?: string | null;
  favorite?: boolean;
  tags?: string[];
  crop?: CropSettings | null;
  savedBpm?: number | null;
  savedTimeSignature?: TimeSignature | null;
  savedPitch?: SavedPitch | null;
}

export interface LibraryFolder {
  id: string;
  path: string;
  addedAt: string;
}

export interface LibraryScanResult {
  added: number;
  updated: number;
  missing: number;
  scores: ScoreRecord[];
}

export interface Bookmark {
  id: string;
  scoreId: string;
  pageNum: number;
  label: string;
  createdAt: string;
}

export interface SetlistItem {
  scoreId: string;
  position: number;
}

export interface Setlist {
  id: string;
  name: string;
  createdAt: string;
  items: SetlistItem[];
}

export interface AnnotationLayer {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
}

export type StampType =
  | 'breath'
  | 'no_breath'
  | 'caesura'
  | 'fermata'
  | 'cutoff'
  | 'pitch_up'
  | 'pitch_down'
  | 'sharp'
  | 'flat'
  | 'natural'
  | 'half_step'
  | 'whole_step'
  | 'ppp'
  | 'pp'
  | 'p'
  | 'mp'
  | 'mf'
  | 'f'
  | 'ff'
  | 'fff'
  | 'sfz'
  | 'fp'
  | 'cresc_text'
  | 'dim_text'
  | 'cresc_hairpin'
  | 'dim_hairpin'
  | 'accent'
  | 'staccato'
  | 'tenuto'
  | 'marcato'
  | 'segno'
  | 'coda'
  | 'dc'
  | 'ds'
  | 'fine'
  | 'repeat_start'
  | 'repeat_end'
  | 'turn_page'
  | 'watch_conductor';

export interface StrokeAnnotation {
  kind: 'stroke';
  id: string;
  layerId: string;
  tool: 'pen' | 'highlighter';
  points: StrokePoint[];
  color: string;
  /** Width normalized to full page width (0..1). */
  width: number;
  opacity: number;
  multiply?: boolean;
}

export type ShapeType = 'line' | 'bracket' | 'circle' | 'oval' | 'slur';

export interface ShapeAnnotation {
  kind: 'shape';
  id: string;
  layerId: string;
  shapeType: ShapeType;
  start: NormalizedPoint;
  end: NormalizedPoint;
  control?: NormalizedPoint;
  color: string;
  /** Stroke width normalized to full page width (0..1). */
  width: number;
}

export interface StampAnnotation {
  kind: 'stamp';
  id: string;
  layerId: string;
  stampType: StampType;
  position: NormalizedPoint;
  scale: number;
  rotation?: number;
  color: string;
}

export interface TextAnnotation {
  kind: 'text';
  id: string;
  layerId: string;
  position: NormalizedPoint;
  text: string;
  /** Font size normalized to full page width (0..1). */
  fontSize: number;
  color: string;
  bgColor?: string;
}

export type AnnotationItem =
  | StrokeAnnotation
  | ShapeAnnotation
  | StampAnnotation
  | TextAnnotation;

export interface PageAnnotations {
  scoreId: string;
  pageNum: number;
  layers: AnnotationLayer[];
  items: AnnotationItem[];
  updatedAt: string;
}

export type AppLanguage = 'sv' | 'en';
export type NoteNaming = 'auto' | 'sv' | 'en';
export type AppTheme = 'dark' | 'light';
export type PaperTint = 'none' | 'warm' | 'night';
export type VoiceProfile = 'bass';

export interface AppSettings {
  language: AppLanguage;
  noteNaming: NoteNaming;
  theme: AppTheme;
  paperTint: PaperTint;
  /** Reference A4 pitch in Hz (438-444, default 440). */
  referencePitchHz: number;
  swipeEnabled: boolean;
  tapZonesEnabled: boolean;
  halfPageModeDefault: boolean;
  autoCropDefault: boolean;
  defaultVoiceProfile: VoiceProfile;
  wakeLockEnabled: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'sv',
  noteNaming: 'auto',
  theme: 'dark',
  paperTint: 'none',
  referencePitchHz: 440,
  swipeEnabled: true,
  tapZonesEnabled: true,
  halfPageModeDefault: false,
  autoCropDefault: true,
  defaultVoiceProfile: 'bass',
  wakeLockEnabled: true,
};

export interface ScoreFilter {
  query?: string;
  favoriteOnly?: boolean;
  tag?: string;
  setlistId?: string;
}

export interface UpsertBookmarkInput {
  id?: string;
  scoreId: string;
  pageNum: number;
  label: string;
}

/**
 * Exact Tauri v2 #[tauri::command] names exposed by the Rust backend.
 *
 * Rust commands MUST use `#[tauri::command(rename_all = "camelCase")]`
 * and all serialized structs MUST use `#[serde(rename_all = "camelCase")]`
 * so every IPC payload matches the TypeScript contracts below 1:1.
 */
export const IPC_COMMANDS = {
  PICK_AND_ADD_LIBRARY_FOLDER: 'pick_and_add_library_folder',
  REMOVE_LIBRARY_FOLDER: 'remove_library_folder',
  LIST_LIBRARY_FOLDERS: 'list_library_folders',
  SCAN_LIBRARY: 'scan_library',
  PICK_AND_IMPORT_PDF_FILES: 'pick_and_import_pdf_files',
  LIST_SCORES: 'list_scores',
  GET_SCORE: 'get_score',
  UPDATE_SCORE_METADATA: 'update_score_metadata',
  DELETE_SCORE_RECORD: 'delete_score_record',
  READ_PDF_BYTES: 'read_pdf_bytes',
  EXPORT_PDF_WITH_DIALOG: 'export_pdf_with_dialog',
  EXPORT_BACKUP_WITH_DIALOG: 'export_backup_with_dialog',
  IMPORT_BACKUP_WITH_DIALOG: 'import_backup_with_dialog',
  LIST_BOOKMARKS: 'list_bookmarks',
  UPSERT_BOOKMARK: 'upsert_bookmark',
  DELETE_BOOKMARK: 'delete_bookmark',
  LIST_SETLISTS: 'list_setlists',
  CREATE_SETLIST: 'create_setlist',
  RENAME_SETLIST: 'rename_setlist',
  DELETE_SETLIST: 'delete_setlist',
  SET_SETLIST_ITEMS: 'set_setlist_items',
  GET_PAGE_ANNOTATIONS: 'get_page_annotations',
  GET_SCORE_ANNOTATIONS: 'get_score_annotations',
  SAVE_PAGE_ANNOTATIONS: 'save_page_annotations',
  GET_SETTINGS: 'get_settings',
  SAVE_SETTINGS: 'save_settings',
  SET_WAKE_LOCK: 'set_wake_lock',
} as const;

export type IpcCommandName = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];

/**
 * Typed argument & return contract for every Tauri command.
 * Keys inside `args` match the exact Rust command parameter names (camelCase).
 */
export interface IpcContractMap {
  [IPC_COMMANDS.PICK_AND_ADD_LIBRARY_FOLDER]: {
    args: Record<string, never>;
    result: LibraryFolder | null;
  };
  [IPC_COMMANDS.REMOVE_LIBRARY_FOLDER]: {
    args: { folderId: string };
    result: void;
  };
  [IPC_COMMANDS.LIST_LIBRARY_FOLDERS]: {
    args: Record<string, never>;
    result: LibraryFolder[];
  };
  [IPC_COMMANDS.SCAN_LIBRARY]: {
    args: { folderId?: string };
    result: LibraryScanResult;
  };
  [IPC_COMMANDS.PICK_AND_IMPORT_PDF_FILES]: {
    args: Record<string, never>;
    result: ScoreRecord[];
  };
  [IPC_COMMANDS.LIST_SCORES]: {
    args: { filter?: ScoreFilter };
    result: ScoreRecord[];
  };
  [IPC_COMMANDS.GET_SCORE]: {
    args: { scoreId: string };
    result: ScoreRecord | null;
  };
  [IPC_COMMANDS.UPDATE_SCORE_METADATA]: {
    args: { scoreId: string; patch: ScoreMetadataPatch };
    result: ScoreRecord;
  };
  [IPC_COMMANDS.DELETE_SCORE_RECORD]: {
    args: { scoreId: string };
    result: void;
  };
  [IPC_COMMANDS.READ_PDF_BYTES]: {
    /** Returns raw PDF bytes (tauri::ipc::Response -> ArrayBuffer in JS invoke). */
    args: { scoreId: string };
    result: ArrayBuffer;
  };
  [IPC_COMMANDS.EXPORT_PDF_WITH_DIALOG]: {
    /** Raw binary invoke body (Uint8Array) with header x-default-filename. */
    args: Uint8Array;
    result: boolean;
  };
  [IPC_COMMANDS.EXPORT_BACKUP_WITH_DIALOG]: {
    args: { defaultFilename: string; jsonContent: string };
    result: boolean;
  };
  [IPC_COMMANDS.IMPORT_BACKUP_WITH_DIALOG]: {
    args: Record<string, never>;
    result: string | null;
  };
  [IPC_COMMANDS.LIST_BOOKMARKS]: {
    args: { scoreId: string };
    result: Bookmark[];
  };
  [IPC_COMMANDS.UPSERT_BOOKMARK]: {
    args: { bookmark: UpsertBookmarkInput };
    result: Bookmark;
  };
  [IPC_COMMANDS.DELETE_BOOKMARK]: {
    args: { bookmarkId: string };
    result: void;
  };
  [IPC_COMMANDS.LIST_SETLISTS]: {
    args: Record<string, never>;
    result: Setlist[];
  };
  [IPC_COMMANDS.CREATE_SETLIST]: {
    args: { name: string };
    result: Setlist;
  };
  [IPC_COMMANDS.RENAME_SETLIST]: {
    args: { setlistId: string; name: string };
    result: Setlist;
  };
  [IPC_COMMANDS.DELETE_SETLIST]: {
    args: { setlistId: string };
    result: void;
  };
  [IPC_COMMANDS.SET_SETLIST_ITEMS]: {
    args: { setlistId: string; items: SetlistItem[] };
    result: Setlist;
  };
  [IPC_COMMANDS.GET_PAGE_ANNOTATIONS]: {
    args: { scoreId: string; pageNum: number };
    result: PageAnnotations;
  };
  [IPC_COMMANDS.GET_SCORE_ANNOTATIONS]: {
    args: { scoreId: string };
    result: PageAnnotations[];
  };
  [IPC_COMMANDS.SAVE_PAGE_ANNOTATIONS]: {
    args: { annotations: PageAnnotations };
    result: PageAnnotations;
  };
  [IPC_COMMANDS.GET_SETTINGS]: {
    args: Record<string, never>;
    result: AppSettings;
  };
  [IPC_COMMANDS.SAVE_SETTINGS]: {
    args: { settings: AppSettings };
    result: AppSettings;
  };
  [IPC_COMMANDS.SET_WAKE_LOCK]: {
    args: { enabled: boolean };
    result: boolean;
  };
}
