use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn new_id(salt: &str) -> String {
    let seq = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();

    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hasher.update(seq.to_le_bytes());
    hasher.update(salt.as_bytes());
    let digest = hasher.finalize();
    let hex_str = hex::encode(&digest[..16]);

    format!(
        "{}-{}-{}-{}-{}",
        &hex_str[0..8],
        &hex_str[8..12],
        &hex_str[12..16],
        &hex_str[16..20],
        &hex_str[20..32]
    )
}

pub fn normalize_path_str(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let path = Path::new(trimmed);
    let resolved = if path.exists() {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };

    let mut s = resolved.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            s = format!(r"\\{}", rest);
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            s = rest.to_string();
        }
        s = s.replace('/', "\\");
        while s.len() > 3 && s.ends_with('\\') {
            s.pop();
        }
        // Handle bare UNC root or trailing slash on non-drive paths cleanly
        if s.len() > 1 && !s.ends_with(":\\") && s.ends_with('\\') {
            s.pop();
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        while s.len() > 1 && s.ends_with('/') {
            s.pop();
        }
    }

    s
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrokePoint {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CropMode {
    Auto,
    Manual,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CropSettings {
    pub mode: CropMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_box: Option<NormalizedRect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_cache: Option<BTreeMap<u32, NormalizedRect>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TimeSignature {
    #[serde(rename = "2/4")]
    TwoFour,
    #[serde(rename = "3/4")]
    ThreeFour,
    #[serde(rename = "4/4")]
    FourFour,
    #[serde(rename = "6/8")]
    SixEight,
    #[serde(rename = "3/8")]
    ThreeEight,
    #[serde(rename = "5/4")]
    FiveFour,
}

impl TimeSignature {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TwoFour => "2/4",
            Self::ThreeFour => "3/4",
            Self::FourFour => "4/4",
            Self::SixEight => "6/8",
            Self::ThreeEight => "3/8",
            Self::FiveFour => "5/4",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "2/4" => Some(Self::TwoFour),
            "3/4" => Some(Self::ThreeFour),
            "4/4" => Some(Self::FourFour),
            "6/8" => Some(Self::SixEight),
            "3/8" => Some(Self::ThreeEight),
            "5/4" => Some(Self::FiveFour),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedPitch {
    pub midi_notes: Vec<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub octave_offset: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreRecord {
    pub id: String,
    pub file_path: String,
    pub sha256: String,
    pub title: String,
    pub filename: String,
    pub page_count: u32,
    pub last_page: u32,
    pub last_opened_at: Option<String>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub crop: Option<CropSettings>,
    pub saved_bpm: Option<u32>,
    pub saved_time_signature: Option<TimeSignature>,
    pub saved_pitch: Option<SavedPitch>,
}

fn deserialize_some<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreMetadataPatch {
    pub title: Option<String>,
    pub page_count: Option<u32>,
    pub last_page: Option<u32>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub last_opened_at: Option<Option<String>>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub crop: Option<Option<CropSettings>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub saved_bpm: Option<Option<u32>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub saved_time_signature: Option<Option<TimeSignature>>,
    #[serde(default, deserialize_with = "deserialize_some")]
    pub saved_pitch: Option<Option<SavedPitch>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: String,
    pub path: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanResult {
    pub added: usize,
    pub updated: usize,
    pub missing: usize,
    pub scores: Vec<ScoreRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub score_id: String,
    pub page_num: u32,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBookmarkInput {
    pub id: Option<String>,
    pub score_id: String,
    pub page_num: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetlistItem {
    pub score_id: String,
    pub position: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Setlist {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub items: Vec<SetlistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StampType {
    Breath,
    NoBreath,
    Caesura,
    Fermata,
    Cutoff,
    PitchUp,
    PitchDown,
    Sharp,
    Flat,
    Natural,
    HalfStep,
    WholeStep,
    Ppp,
    Pp,
    P,
    Mp,
    Mf,
    F,
    Ff,
    Fff,
    Sfz,
    Fp,
    CrescText,
    DimText,
    CrescHairpin,
    DimHairpin,
    Accent,
    Staccato,
    Tenuto,
    Marcato,
    Segno,
    Coda,
    Dc,
    Ds,
    Fine,
    RepeatStart,
    RepeatEnd,
    TurnPage,
    WatchConductor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StrokeTool {
    Pen,
    Highlighter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShapeType {
    Line,
    Bracket,
    Circle,
    Oval,
    Slur,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrokeAnnotation {
    pub id: String,
    pub layer_id: String,
    pub tool: StrokeTool,
    pub points: Vec<StrokePoint>,
    pub color: String,
    pub width: f64,
    pub opacity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiply: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShapeAnnotation {
    pub id: String,
    pub layer_id: String,
    pub shape_type: ShapeType,
    pub start: NormalizedPoint,
    pub end: NormalizedPoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<NormalizedPoint>,
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StampAnnotation {
    pub id: String,
    pub layer_id: String,
    pub stamp_type: StampType,
    pub position: NormalizedPoint,
    pub scale: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextAnnotation {
    pub id: String,
    pub layer_id: String,
    pub position: NormalizedPoint,
    pub text: String,
    pub font_size: f64,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AnnotationItem {
    Stroke(StrokeAnnotation),
    Shape(ShapeAnnotation),
    Stamp(StampAnnotation),
    Text(TextAnnotation),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageAnnotations {
    pub score_id: String,
    pub page_num: u32,
    pub layers: Vec<AnnotationLayer>,
    pub items: Vec<AnnotationItem>,
    pub updated_at: String,
}

impl PageAnnotations {
    pub fn empty_default(score_id: &str, page_num: u32) -> Self {
        Self {
            score_id: score_id.to_string(),
            page_num,
            layers: vec![AnnotationLayer {
                id: "default".to_string(),
                name: "Anteckningar".to_string(),
                visible: true,
                locked: None,
            }],
            items: Vec::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredPageAnnotationPayload {
    #[serde(default)]
    layers: Vec<AnnotationLayer>,
    #[serde(default)]
    items: Vec<AnnotationItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLanguage {
    Sv,
    En,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoteNaming {
    Auto,
    Sv,
    En,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppTheme {
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PaperTint {
    None,
    Warm,
    Night,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VoiceProfile {
    Bass,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub language: AppLanguage,
    pub note_naming: NoteNaming,
    pub theme: AppTheme,
    pub paper_tint: PaperTint,
    pub reference_pitch_hz: f64,
    pub swipe_enabled: bool,
    pub tap_zones_enabled: bool,
    pub half_page_mode_default: bool,
    pub auto_crop_default: bool,
    pub default_voice_profile: VoiceProfile,
    pub wake_lock_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: AppLanguage::Sv,
            note_naming: NoteNaming::Auto,
            theme: AppTheme::Dark,
            paper_tint: PaperTint::None,
            reference_pitch_hz: 440.0,
            swipe_enabled: true,
            tap_zones_enabled: true,
            half_page_mode_default: false,
            auto_crop_default: true,
            default_voice_profile: VoiceProfile::Bass,
            wake_lock_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreFilter {
    pub query: Option<String>,
    pub favorite_only: Option<bool>,
    pub tag: Option<String>,
    pub setlist_id: Option<String>,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn default_db_path() -> Result<PathBuf, String> {
        let dir = dirs::data_local_dir()
            .ok_or_else(|| "Unable to determine local application data directory".to_string())?;
        Ok(dir.join("Notlasare").join("notlasare.db"))
    }

    pub fn open_default() -> Result<Self, String> {
        let path = Self::default_db_path()?;
        Self::open_at(path)
    }

    pub fn open_at(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create DB directory: {e}"))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
                }
            }
        }
        let conn = Connection::open(path).map_err(|e| format!("Failed to open SQLite DB: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory SQLite DB: {e}"))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                PRAGMA journal_mode = WAL;
                PRAGMA secure_delete = ON;
                PRAGMA busy_timeout = 5000;

                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    path TEXT UNIQUE NOT NULL,
                    added_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS scores (
                    id TEXT PRIMARY KEY,
                    file_path TEXT UNIQUE NOT NULL,
                    sha256 TEXT NOT NULL,
                    title TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    page_count INTEGER NOT NULL DEFAULT 0,
                    last_page INTEGER NOT NULL DEFAULT 1,
                    last_opened_at TEXT,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    crop_json TEXT,
                    saved_bpm INTEGER,
                    saved_time_signature TEXT,
                    saved_pitch_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_scores_sha256 ON scores(sha256);

                CREATE TABLE IF NOT EXISTS annotations (
                    score_id TEXT NOT NULL,
                    page_num INTEGER NOT NULL,
                    data_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (score_id, page_num),
                    FOREIGN KEY(score_id) REFERENCES scores(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS bookmarks (
                    id TEXT PRIMARY KEY,
                    score_id TEXT NOT NULL,
                    page_num INTEGER NOT NULL,
                    label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(score_id) REFERENCES scores(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_bookmarks_score ON bookmarks(score_id, page_num);

                CREATE TABLE IF NOT EXISTS setlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS setlist_items (
                    setlist_id TEXT NOT NULL,
                    score_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (setlist_id, position),
                    FOREIGN KEY(setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
                    FOREIGN KEY(score_id) REFERENCES scores(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                ",
            )
            .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;

        Ok(())
    }

    pub fn add_folder(&self, path: &str) -> Result<LibraryFolder, String> {
        let norm = normalize_path_str(path);
        if norm.is_empty() {
            return Err("Folder path cannot be empty".to_string());
        }

        // Check existing folder (case-insensitive on Windows to avoid duplicate casing entries)
        let folders = self.list_folders()?;
        if let Some(existing) = folders.into_iter().find(|f| {
            #[cfg(target_os = "windows")]
            {
                f.path.eq_ignore_ascii_case(&norm)
            }
            #[cfg(not(target_os = "windows"))]
            {
                f.path == norm
            }
        }) {
            return Ok(existing);
        }

        let folder = LibraryFolder {
            id: new_id(&norm),
            path: norm,
            added_at: now_iso(),
        };

        self.conn
            .execute(
                "INSERT INTO folders (id, path, added_at) VALUES (?1, ?2, ?3)",
                params![folder.id, folder.path, folder.added_at],
            )
            .map_err(|e| format!("Failed to add library folder: {e}"))?;

        Ok(folder)
    }

    pub fn remove_folder(&self, folder_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
            .map_err(|e| format!("Failed to remove library folder: {e}"))?;
        Ok(())
    }

    pub fn list_folders(&self) -> Result<Vec<LibraryFolder>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, added_at FROM folders ORDER BY added_at ASC, id ASC")
            .map_err(|e| format!("Failed to prepare list_folders query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibraryFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    added_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Failed to query folders: {e}"))?;

        let mut folders = Vec::new();
        for item in rows {
            folders.push(item.map_err(|e| format!("Failed to read folder row: {e}"))?);
        }
        Ok(folders)
    }

    pub fn get_folder(&self, folder_id: &str) -> Result<Option<LibraryFolder>, String> {
        self.conn
            .query_row(
                "SELECT id, path, added_at FROM folders WHERE id = ?1",
                params![folder_id],
                |row| {
                    Ok(LibraryFolder {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        added_at: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to get folder: {e}"))
    }

    pub fn insert_score(&self, score: &ScoreRecord) -> Result<(), String> {
        let tags_json = serde_json::to_string(&score.tags)
            .map_err(|e| format!("Failed to serialize tags: {e}"))?;
        let crop_json = score
            .crop
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("Failed to serialize crop: {e}"))?;
        let saved_time_sig = score
            .saved_time_signature
            .as_ref()
            .map(|t| t.as_str().to_string());
        let saved_pitch_json = score
            .saved_pitch
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("Failed to serialize savedPitch: {e}"))?;

        self.conn
            .execute(
                "INSERT INTO scores (
                    id, file_path, sha256, title, filename,
                    page_count, last_page, last_opened_at, favorite,
                    tags_json, crop_json, saved_bpm, saved_time_signature, saved_pitch_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    score.id,
                    score.file_path,
                    score.sha256,
                    score.title,
                    score.filename,
                    score.page_count,
                    score.last_page.max(1),
                    score.last_opened_at,
                    if score.favorite { 1i64 } else { 0i64 },
                    tags_json,
                    crop_json,
                    score.saved_bpm,
                    saved_time_sig,
                    saved_pitch_json,
                ],
            )
            .map_err(|e| format!("Failed to insert score: {e}"))?;

        Ok(())
    }

    pub fn get_score(&self, score_id: &str) -> Result<Option<ScoreRecord>, String> {
        self.conn
            .query_row(
                "SELECT id, file_path, sha256, title, filename, page_count, last_page,
                        last_opened_at, favorite, tags_json, crop_json, saved_bpm,
                        saved_time_signature, saved_pitch_json
                 FROM scores WHERE id = ?1",
                params![score_id],
                row_to_score,
            )
            .optional()
            .map_err(|e| format!("Failed to fetch score: {e}"))
    }

    pub fn get_score_by_path(&self, file_path: &str) -> Result<Option<ScoreRecord>, String> {
        let norm = normalize_path_str(file_path);
        #[cfg(target_os = "windows")]
        {
            // Try exact first, then case-insensitive match on Windows NTFS paths
            if let Some(found) = self
                .conn
                .query_row(
                    "SELECT id, file_path, sha256, title, filename, page_count, last_page,
                            last_opened_at, favorite, tags_json, crop_json, saved_bpm,
                            saved_time_signature, saved_pitch_json
                     FROM scores WHERE file_path = ?1",
                    params![norm],
                    row_to_score,
                )
                .optional()
                .map_err(|e| format!("Failed to fetch score by path: {e}"))?
            {
                return Ok(Some(found));
            }
            let all = self.list_all_scores_raw()?;
            Ok(all
                .into_iter()
                .find(|s| s.file_path.eq_ignore_ascii_case(&norm)))
        }

        #[cfg(not(target_os = "windows"))]
        self.conn
            .query_row(
                "SELECT id, file_path, sha256, title, filename, page_count, last_page,
                        last_opened_at, favorite, tags_json, crop_json, saved_bpm,
                        saved_time_signature, saved_pitch_json
                 FROM scores WHERE file_path = ?1",
                params![norm],
                row_to_score,
            )
            .optional()
            .map_err(|e| format!("Failed to fetch score by path: {e}"))
    }

    pub fn find_scores_by_sha256(&self, sha256: &str) -> Result<Vec<ScoreRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, file_path, sha256, title, filename, page_count, last_page,
                        last_opened_at, favorite, tags_json, crop_json, saved_bpm,
                        saved_time_signature, saved_pitch_json
                 FROM scores WHERE sha256 = ?1 ORDER BY last_opened_at DESC, id ASC",
            )
            .map_err(|e| format!("Failed to prepare sha256 query: {e}"))?;

        let rows = stmt
            .query_map(params![sha256], row_to_score)
            .map_err(|e| format!("Failed to query scores by sha256: {e}"))?;

        let mut scores = Vec::new();
        for item in rows {
            scores.push(item.map_err(|e| format!("Failed to read score row: {e}"))?);
        }
        Ok(scores)
    }

    pub fn update_score_path_and_hash(
        &self,
        score_id: &str,
        new_file_path: &str,
        new_filename: &str,
        sha256: &str,
    ) -> Result<ScoreRecord, String> {
        let norm = normalize_path_str(new_file_path);
        let updated = self
            .conn
            .execute(
                "UPDATE scores SET file_path = ?1, filename = ?2, sha256 = ?3 WHERE id = ?4",
                params![norm, new_filename, sha256, score_id],
            )
            .map_err(|e| format!("Failed to update score path: {e}"))?;
        if updated == 0 {
            return Err(format!("Score not found: {score_id}"));
        }
        self.get_score(score_id)?
            .ok_or_else(|| format!("Score not found after update: {score_id}"))
    }

    pub fn update_score_sha256(&self, score_id: &str, sha256: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE scores SET sha256 = ?1 WHERE id = ?2",
                params![sha256, score_id],
            )
            .map_err(|e| format!("Failed to update score hash: {e}"))?;
        Ok(())
    }

    fn list_all_scores_raw(&self) -> Result<Vec<ScoreRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, file_path, sha256, title, filename, page_count, last_page,
                        last_opened_at, favorite, tags_json, crop_json, saved_bpm,
                        saved_time_signature, saved_pitch_json
                 FROM scores",
            )
            .map_err(|e| format!("Failed to prepare list_scores query: {e}"))?;

        let rows = stmt
            .query_map([], row_to_score)
            .map_err(|e| format!("Failed to query scores: {e}"))?;

        let mut scores = Vec::new();
        for item in rows {
            scores.push(item.map_err(|e| format!("Failed to read score row: {e}"))?);
        }
        Ok(scores)
    }

    pub fn list_scores(&self, filter: Option<&ScoreFilter>) -> Result<Vec<ScoreRecord>, String> {
        let mut scores = if let Some(setlist_id) = filter.and_then(|f| f.setlist_id.as_deref()) {
            if !setlist_id.trim().is_empty() {
                let mut stmt = self
                    .conn
                    .prepare(
                        "SELECT s.id, s.file_path, s.sha256, s.title, s.filename, s.page_count,
                                s.last_page, s.last_opened_at, s.favorite, s.tags_json,
                                s.crop_json, s.saved_bpm, s.saved_time_signature, s.saved_pitch_json
                         FROM scores s
                         INNER JOIN setlist_items si ON si.score_id = s.id
                         WHERE si.setlist_id = ?1
                         ORDER BY si.position ASC",
                    )
                    .map_err(|e| format!("Failed to prepare setlist score query: {e}"))?;

                let rows = stmt
                    .query_map(params![setlist_id], row_to_score)
                    .map_err(|e| format!("Failed to query setlist scores: {e}"))?;

                let mut out = Vec::new();
                for item in rows {
                    out.push(item.map_err(|e| format!("Failed to read score row: {e}"))?);
                }
                out
            } else {
                self.list_all_scores_sorted()?
            }
        } else {
            self.list_all_scores_sorted()?
        };

        if let Some(f) = filter {
            if f.favorite_only == Some(true) {
                scores.retain(|s| s.favorite);
            }
            if let Some(tag) = f.tag.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                let tag_lc = tag.to_lowercase();
                scores.retain(|s| s.tags.iter().any(|t| t.to_lowercase() == tag_lc));
            }
            if let Some(query) = f.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
                let q_lc = query.to_lowercase();
                scores.retain(|s| {
                    s.title.to_lowercase().contains(&q_lc)
                        || s.filename.to_lowercase().contains(&q_lc)
                        || s.tags.iter().any(|t| t.to_lowercase().contains(&q_lc))
                });
            }
        }

        Ok(scores)
    }

    fn list_all_scores_sorted(&self) -> Result<Vec<ScoreRecord>, String> {
        let mut scores = self.list_all_scores_raw()?;
        scores.sort_by(|a, b| match (&b.last_opened_at, &a.last_opened_at) {
            (Some(b_ts), Some(a_ts)) => b_ts
                .cmp(a_ts)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
                .then_with(|| a.id.cmp(&b.id)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a
                .title
                .to_lowercase()
                .cmp(&b.title.to_lowercase())
                .then_with(|| a.id.cmp(&b.id)),
        });
        Ok(scores)
    }

    pub fn update_score_metadata(
        &self,
        score_id: &str,
        patch: ScoreMetadataPatch,
    ) -> Result<ScoreRecord, String> {
        let mut score = self
            .get_score(score_id)?
            .ok_or_else(|| format!("Score not found: {score_id}"))?;

        if let Some(title) = patch.title {
            let trimmed = title.trim().to_string();
            if !trimmed.is_empty() {
                score.title = trimmed;
            }
        }
        if let Some(page_count) = patch.page_count {
            score.page_count = page_count;
        }
        if let Some(last_page) = patch.last_page {
            score.last_page = last_page.max(1);
        }
        if let Some(last_opened_at) = patch.last_opened_at {
            score.last_opened_at = last_opened_at;
        }
        if let Some(favorite) = patch.favorite {
            score.favorite = favorite;
        }
        if let Some(tags) = patch.tags {
            let mut seen = HashSet::new();
            let mut clean_tags = Vec::new();
            for raw in tags {
                let t = raw.trim().to_string();
                if !t.is_empty() && seen.insert(t.to_lowercase()) {
                    clean_tags.push(t);
                }
            }
            score.tags = clean_tags;
        }
        if let Some(crop) = patch.crop {
            score.crop = crop;
        }
        if let Some(saved_bpm) = patch.saved_bpm {
            score.saved_bpm = saved_bpm.map(|bpm| bpm.clamp(30, 240));
        }
        if let Some(saved_time_sig) = patch.saved_time_signature {
            score.saved_time_signature = saved_time_sig;
        }
        if let Some(saved_pitch) = patch.saved_pitch {
            score.saved_pitch = saved_pitch;
        }

        let tags_json = serde_json::to_string(&score.tags)
            .map_err(|e| format!("Failed to serialize tags: {e}"))?;
        let crop_json = score
            .crop
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("Failed to serialize crop: {e}"))?;
        let saved_time_sig = score
            .saved_time_signature
            .as_ref()
            .map(|t| t.as_str().to_string());
        let saved_pitch_json = score
            .saved_pitch
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("Failed to serialize savedPitch: {e}"))?;

        self.conn
            .execute(
                "UPDATE scores SET
                    title = ?1,
                    page_count = ?2,
                    last_page = ?3,
                    last_opened_at = ?4,
                    favorite = ?5,
                    tags_json = ?6,
                    crop_json = ?7,
                    saved_bpm = ?8,
                    saved_time_signature = ?9,
                    saved_pitch_json = ?10
                 WHERE id = ?11",
                params![
                    score.title,
                    score.page_count,
                    score.last_page,
                    score.last_opened_at,
                    if score.favorite { 1i64 } else { 0i64 },
                    tags_json,
                    crop_json,
                    score.saved_bpm,
                    saved_time_sig,
                    saved_pitch_json,
                    score.id,
                ],
            )
            .map_err(|e| format!("Failed to update score metadata: {e}"))?;

        Ok(score)
    }

    pub fn delete_score_record(&self, score_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM scores WHERE id = ?1", params![score_id])
            .map_err(|e| format!("Failed to delete score record: {e}"))?;
        Ok(())
    }

    pub fn list_bookmarks(&self, score_id: &str) -> Result<Vec<Bookmark>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, score_id, page_num, label, created_at
                 FROM bookmarks
                 WHERE score_id = ?1
                 ORDER BY page_num ASC, created_at ASC, id ASC",
            )
            .map_err(|e| format!("Failed to prepare list_bookmarks query: {e}"))?;

        let rows = stmt
            .query_map(params![score_id], |row| {
                Ok(Bookmark {
                    id: row.get(0)?,
                    score_id: row.get(1)?,
                    page_num: row.get(2)?,
                    label: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Failed to query bookmarks: {e}"))?;

        let mut bookmarks = Vec::new();
        for item in rows {
            bookmarks.push(item.map_err(|e| format!("Failed to read bookmark row: {e}"))?);
        }
        Ok(bookmarks)
    }

    pub fn upsert_bookmark(&self, input: UpsertBookmarkInput) -> Result<Bookmark, String> {
        let page_num = input.page_num.max(1);
        let label = input.label.trim().to_string();

        if let Some(existing_id) = input.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let existing: Option<Bookmark> = self
                .conn
                .query_row(
                    "SELECT id, score_id, page_num, label, created_at FROM bookmarks WHERE id = ?1",
                    params![existing_id],
                    |row| {
                        Ok(Bookmark {
                            id: row.get(0)?,
                            score_id: row.get(1)?,
                            page_num: row.get(2)?,
                            label: row.get(3)?,
                            created_at: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| format!("Failed to check bookmark: {e}"))?;

            if let Some(mut bm) = existing {
                if bm.score_id != input.score_id {
                    return Err("Bookmark does not belong to the specified score".to_string());
                }
                let updated = self
                    .conn
                    .execute(
                        "UPDATE bookmarks SET page_num = ?1, label = ?2 WHERE id = ?3 AND score_id = ?4",
                        params![page_num, label, existing_id, input.score_id],
                    )
                    .map_err(|e| format!("Failed to update bookmark: {e}"))?;
                if updated == 0 {
                    return Err("Bookmark not found for score".to_string());
                }
                bm.page_num = page_num;
                bm.label = label;
                return Ok(bm);
            }

            let bm = Bookmark {
                id: existing_id.to_string(),
                score_id: input.score_id,
                page_num,
                label,
                created_at: now_iso(),
            };
            self.conn
                .execute(
                    "INSERT INTO bookmarks (id, score_id, page_num, label, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![bm.id, bm.score_id, bm.page_num, bm.label, bm.created_at],
                )
                .map_err(|e| format!("Failed to insert bookmark: {e}"))?;
            return Ok(bm);
        }

        let bm = Bookmark {
            id: new_id(&format!("{}:{}", input.score_id, page_num)),
            score_id: input.score_id,
            page_num,
            label,
            created_at: now_iso(),
        };
        self.conn
            .execute(
                "INSERT INTO bookmarks (id, score_id, page_num, label, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![bm.id, bm.score_id, bm.page_num, bm.label, bm.created_at],
            )
            .map_err(|e| format!("Failed to insert bookmark: {e}"))?;

        Ok(bm)
    }

    pub fn delete_bookmark(&self, bookmark_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])
            .map_err(|e| format!("Failed to delete bookmark: {e}"))?;
        Ok(())
    }

    pub fn list_setlists(&self) -> Result<Vec<Setlist>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, created_at FROM setlists ORDER BY created_at ASC, id ASC")
            .map_err(|e| format!("Failed to prepare list_setlists query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query setlists: {e}"))?;

        let mut setlists = Vec::new();
        for item in rows {
            let (id, name, created_at) =
                item.map_err(|e| format!("Failed to read setlist row: {e}"))?;
            let items = self.list_setlist_items(&id)?;
            setlists.push(Setlist {
                id,
                name,
                created_at,
                items,
            });
        }
        Ok(setlists)
    }

    fn list_setlist_items(&self, setlist_id: &str) -> Result<Vec<SetlistItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT score_id, position FROM setlist_items
                 WHERE setlist_id = ?1 ORDER BY position ASC",
            )
            .map_err(|e| format!("Failed to prepare setlist_items query: {e}"))?;

        let rows = stmt
            .query_map(params![setlist_id], |row| {
                Ok(SetlistItem {
                    score_id: row.get(0)?,
                    position: row.get(1)?,
                })
            })
            .map_err(|e| format!("Failed to query setlist_items: {e}"))?;

        let mut items = Vec::new();
        for item in rows {
            items.push(item.map_err(|e| format!("Failed to read setlist_item row: {e}"))?);
        }
        Ok(items)
    }

    fn get_setlist(&self, setlist_id: &str) -> Result<Option<Setlist>, String> {
        let row = self
            .conn
            .query_row(
                "SELECT id, name, created_at FROM setlists WHERE id = ?1",
                params![setlist_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to fetch setlist: {e}"))?;

        match row {
            Some((id, name, created_at)) => {
                let items = self.list_setlist_items(&id)?;
                Ok(Some(Setlist {
                    id,
                    name,
                    created_at,
                    items,
                }))
            }
            None => Ok(None),
        }
    }

    pub fn create_setlist(&self, name: &str) -> Result<Setlist, String> {
        let clean = name.trim().to_string();
        if clean.is_empty() {
            return Err("Setlist name cannot be empty".to_string());
        }
        let setlist = Setlist {
            id: new_id(&clean),
            name: clean,
            created_at: now_iso(),
            items: Vec::new(),
        };
        self.conn
            .execute(
                "INSERT INTO setlists (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![setlist.id, setlist.name, setlist.created_at],
            )
            .map_err(|e| format!("Failed to create setlist: {e}"))?;
        Ok(setlist)
    }

    pub fn rename_setlist(&self, setlist_id: &str, name: &str) -> Result<Setlist, String> {
        let clean = name.trim().to_string();
        if clean.is_empty() {
            return Err("Setlist name cannot be empty".to_string());
        }
        let updated = self
            .conn
            .execute(
                "UPDATE setlists SET name = ?1 WHERE id = ?2",
                params![clean, setlist_id],
            )
            .map_err(|e| format!("Failed to rename setlist: {e}"))?;
        if updated == 0 {
            return Err(format!("Setlist not found: {setlist_id}"));
        }
        self.get_setlist(setlist_id)?
            .ok_or_else(|| format!("Setlist not found: {setlist_id}"))
    }

    pub fn delete_setlist(&self, setlist_id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM setlists WHERE id = ?1", params![setlist_id])
            .map_err(|e| format!("Failed to delete setlist: {e}"))?;
        Ok(())
    }

    pub fn set_setlist_items(
        &self,
        setlist_id: &str,
        mut items: Vec<SetlistItem>,
    ) -> Result<Setlist, String> {
        if self.get_setlist(setlist_id)?.is_none() {
            return Err(format!("Setlist not found: {setlist_id}"));
        }

        items.sort_by_key(|i| i.position);

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("Failed to start transaction: {e}"))?;

        tx.execute(
            "DELETE FROM setlist_items WHERE setlist_id = ?1",
            params![setlist_id],
        )
        .map_err(|e| format!("Failed to clear setlist items: {e}"))?;

        let mut used_positions = HashSet::new();
        let mut normalized_items = Vec::with_capacity(items.len());

        for (idx, item) in items.into_iter().enumerate() {
            let pos = if used_positions.insert(item.position) {
                item.position
            } else {
                let mut candidate = idx as i32;
                while !used_positions.insert(candidate) {
                    candidate += 1;
                }
                candidate
            };
            tx.execute(
                "INSERT INTO setlist_items (setlist_id, score_id, position) VALUES (?1, ?2, ?3)",
                params![setlist_id, item.score_id, pos],
            )
            .map_err(|e| format!("Failed to insert setlist item: {e}"))?;
            normalized_items.push(SetlistItem {
                score_id: item.score_id,
                position: pos,
            });
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit setlist items: {e}"))?;

        self.get_setlist(setlist_id)?
            .ok_or_else(|| format!("Setlist not found: {setlist_id}"))
    }

    pub fn get_page_annotations(
        &self,
        score_id: &str,
        page_num: u32,
    ) -> Result<PageAnnotations, String> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT data_json, updated_at FROM annotations WHERE score_id = ?1 AND page_num = ?2",
                params![score_id, page_num],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to get page annotations: {e}"))?;

        match row {
            Some((data_json, updated_at)) => {
                let payload: StoredPageAnnotationPayload = serde_json::from_str(&data_json)
                    .map_err(|e| format!("Failed to parse page annotations JSON: {e}"))?;
                let layers = if payload.layers.is_empty() {
                    PageAnnotations::empty_default(score_id, page_num).layers
                } else {
                    payload.layers
                };
                Ok(PageAnnotations {
                    score_id: score_id.to_string(),
                    page_num,
                    layers,
                    items: payload.items,
                    updated_at,
                })
            }
            None => Ok(PageAnnotations::empty_default(score_id, page_num)),
        }
    }

    pub fn get_score_annotations(&self, score_id: &str) -> Result<Vec<PageAnnotations>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT page_num, data_json, updated_at
                 FROM annotations
                 WHERE score_id = ?1
                 ORDER BY page_num ASC",
            )
            .map_err(|e| format!("Failed to prepare get_score_annotations query: {e}"))?;

        let rows = stmt
            .query_map(params![score_id], |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query score annotations: {e}"))?;

        let mut pages = Vec::new();
        for item in rows {
            let (page_num, data_json, updated_at) =
                item.map_err(|e| format!("Failed to read annotation row: {e}"))?;
            let payload: StoredPageAnnotationPayload = serde_json::from_str(&data_json)
                .map_err(|e| format!("Failed to parse page annotations JSON: {e}"))?;
            let layers = if payload.layers.is_empty() {
                PageAnnotations::empty_default(score_id, page_num).layers
            } else {
                payload.layers
            };
            pages.push(PageAnnotations {
                score_id: score_id.to_string(),
                page_num,
                layers,
                items: payload.items,
                updated_at,
            });
        }

        Ok(pages)
    }

    pub fn save_page_annotations(
        &self,
        annotations: PageAnnotations,
    ) -> Result<PageAnnotations, String> {
        let layers = if annotations.layers.is_empty() {
            PageAnnotations::empty_default(&annotations.score_id, annotations.page_num).layers
        } else {
            annotations.layers
        };
        validate_annotation_payload(&layers, &annotations.items)?;
        let payload = StoredPageAnnotationPayload {
            layers: layers.clone(),
            items: annotations.items.clone(),
        };
        let data_json = serde_json::to_string(&payload)
            .map_err(|e| format!("Failed to serialize page annotations: {e}"))?;
        let updated_at = now_iso();

        self.conn
            .execute(
                "INSERT INTO annotations (score_id, page_num, data_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(score_id, page_num) DO UPDATE SET
                    data_json = excluded.data_json,
                    updated_at = excluded.updated_at",
                params![
                    annotations.score_id,
                    annotations.page_num,
                    data_json,
                    updated_at
                ],
            )
            .map_err(|e| format!("Failed to save page annotations: {e}"))?;

        Ok(PageAnnotations {
            score_id: annotations.score_id,
            page_num: annotations.page_num,
            layers,
            items: annotations.items,
            updated_at,
        })
    }

    pub fn clear_page_annotations(&self, score_id: &str, page_num: u32) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM annotations WHERE score_id = ?1 AND page_num = ?2",
                params![score_id, page_num],
            )
            .map_err(|e| format!("Failed to clear page annotations: {e}"))?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<AppSettings, String> {
        let row: Option<String> = self
            .conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'app_settings'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to read settings: {e}"))?;

        match row {
            Some(json) => {
                let mut settings: AppSettings = serde_json::from_str(&json)
                    .map_err(|e| format!("Failed to parse settings JSON: {e}"))?;
                settings.reference_pitch_hz = clamp_reference_pitch(settings.reference_pitch_hz);
                Ok(settings)
            }
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_settings(&self, mut settings: AppSettings) -> Result<AppSettings, String> {
        settings.reference_pitch_hz = clamp_reference_pitch(settings.reference_pitch_hz);
        let value_json = serde_json::to_string(&settings)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;

        self.conn
            .execute(
                "INSERT INTO settings (key, value_json) VALUES ('app_settings', ?1)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                params![value_json],
            )
            .map_err(|e| format!("Failed to save settings: {e}"))?;

        Ok(settings)
    }
}

const MAX_ANNOTATION_LAYERS: usize = 32;
const MAX_ANNOTATION_ITEMS: usize = 5_000;
const MAX_STROKE_POINTS: usize = 20_000;
const MAX_ANNOTATION_TEXT_CHARS: usize = 4_096;

fn is_valid_css_color(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() || s.len() > 64 {
        return false;
    }
    if let Some(hex) = s.strip_prefix('#') {
        return matches!(hex.len(), 3 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit());
    }
    if let Some(inner) = s.strip_prefix("rgb(").and_then(|v| v.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 3 {
            return false;
        }
        return parts
            .iter()
            .all(|p| p.trim().parse::<u8>().is_ok());
    }
    if let Some(inner) = s.strip_prefix("rgba(").and_then(|v| v.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 4 {
            return false;
        }
        let rgb_ok = parts[..3].iter().all(|p| p.trim().parse::<u8>().is_ok());
        let alpha_ok = parts[3]
            .trim()
            .parse::<f64>()
            .map(|a| a.is_finite() && (0.0..=1.0).contains(&a))
            .unwrap_or(false);
        return rgb_ok && alpha_ok;
    }
    false
}

fn validate_point(pt: &NormalizedPoint) -> Result<(), String> {
    if !pt.x.is_finite() || !pt.y.is_finite() {
        return Err("Annotation coordinates must be finite".to_string());
    }
    Ok(())
}

fn validate_annotation_payload(
    layers: &[AnnotationLayer],
    items: &[AnnotationItem],
) -> Result<(), String> {
    if layers.len() > MAX_ANNOTATION_LAYERS {
        return Err("Too many annotation layers".to_string());
    }
    if items.len() > MAX_ANNOTATION_ITEMS {
        return Err("Too many annotation items on page".to_string());
    }
    for layer in layers {
        if layer.id.trim().is_empty() || layer.id.len() > 128 {
            return Err("Invalid annotation layer id".to_string());
        }
        if layer.name.chars().count() > 256 {
            return Err("Annotation layer name too long".to_string());
        }
    }

    for item in items {
        match item {
            AnnotationItem::Stroke(stroke) => {
                if stroke.id.trim().is_empty() || stroke.id.len() > 128 {
                    return Err("Invalid stroke id".to_string());
                }
                if stroke.points.len() > MAX_STROKE_POINTS {
                    return Err("Stroke exceeds maximum point count".to_string());
                }
                if !is_valid_css_color(&stroke.color) {
                    return Err("Invalid stroke color".to_string());
                }
                if !stroke.width.is_finite()
                    || !(0.0..=1.0).contains(&stroke.width)
                    || !stroke.opacity.is_finite()
                    || !(0.0..=1.0).contains(&stroke.opacity)
                {
                    return Err("Invalid stroke width or opacity".to_string());
                }
                for pt in &stroke.points {
                    if !pt.x.is_finite()
                        || !pt.y.is_finite()
                        || pt.p.map(|p| !p.is_finite()).unwrap_or(false)
                    {
                        return Err("Stroke coordinates must be finite".to_string());
                    }
                }
            }
            AnnotationItem::Shape(shape) => {
                if shape.id.trim().is_empty() || shape.id.len() > 128 {
                    return Err("Invalid shape id".to_string());
                }
                if !is_valid_css_color(&shape.color) {
                    return Err("Invalid shape color".to_string());
                }
                if !shape.width.is_finite() || !(0.0..=1.0).contains(&shape.width) {
                    return Err("Invalid shape width".to_string());
                }
                validate_point(&shape.start)?;
                validate_point(&shape.end)?;
                if let Some(ctrl) = &shape.control {
                    validate_point(ctrl)?;
                }
            }
            AnnotationItem::Stamp(stamp) => {
                if stamp.id.trim().is_empty() || stamp.id.len() > 128 {
                    return Err("Invalid stamp id".to_string());
                }
                if !is_valid_css_color(&stamp.color) {
                    return Err("Invalid stamp color".to_string());
                }
                validate_point(&stamp.position)?;
                if !stamp.scale.is_finite() || stamp.scale <= 0.0 || stamp.scale > 20.0 {
                    return Err("Invalid stamp scale".to_string());
                }
                if stamp.rotation.map(|r| !r.is_finite()).unwrap_or(false) {
                    return Err("Invalid stamp rotation".to_string());
                }
            }
            AnnotationItem::Text(text) => {
                if text.id.trim().is_empty() || text.id.len() > 128 {
                    return Err("Invalid text annotation id".to_string());
                }
                if text.text.chars().count() > MAX_ANNOTATION_TEXT_CHARS {
                    return Err("Text annotation exceeds maximum length".to_string());
                }
                if !is_valid_css_color(&text.color) {
                    return Err("Invalid text color".to_string());
                }
                if let Some(bg) = &text.bg_color {
                    if !is_valid_css_color(bg) {
                        return Err("Invalid text background color".to_string());
                    }
                }
                validate_point(&text.position)?;
                if !text.font_size.is_finite()
                    || text.font_size <= 0.0
                    || text.font_size > 1.0
                {
                    return Err("Invalid text font size".to_string());
                }
            }
        }
    }

    Ok(())
}

fn clamp_reference_pitch(hz: f64) -> f64 {
    if hz.is_finite() {
        hz.clamp(438.0, 444.0)
    } else {
        440.0
    }
}

fn row_to_score(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScoreRecord> {
    let tags_json: String = row.get(9)?;
    let crop_json: Option<String> = row.get(10)?;
    let saved_time_sig: Option<String> = row.get(12)?;
    let saved_pitch_json: Option<String> = row.get(13)?;

    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let crop: Option<CropSettings> = crop_json.and_then(|j| serde_json::from_str(&j).ok());
    let saved_time_signature = saved_time_sig.as_deref().and_then(TimeSignature::from_str_opt);
    let saved_pitch: Option<SavedPitch> =
        saved_pitch_json.and_then(|j| serde_json::from_str(&j).ok());

    Ok(ScoreRecord {
        id: row.get(0)?,
        file_path: row.get(1)?,
        sha256: row.get(2)?,
        title: row.get(3)?,
        filename: row.get(4)?,
        page_count: row.get(5)?,
        last_page: row.get::<_, u32>(6)?.max(1),
        last_opened_at: row.get(7)?,
        favorite: row.get::<_, i64>(8)? != 0,
        tags,
        crop,
        saved_bpm: row.get(11)?,
        saved_time_signature,
        saved_pitch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_score(id: &str, path: &str, sha: &str, title: &str) -> ScoreRecord {
        ScoreRecord {
            id: id.to_string(),
            file_path: normalize_path_str(path),
            sha256: sha.to_string(),
            title: title.to_string(),
            filename: Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("score.pdf")
                .to_string(),
            page_count: 4,
            last_page: 1,
            last_opened_at: None,
            favorite: false,
            tags: vec![],
            crop: None,
            saved_bpm: None,
            saved_time_signature: None,
            saved_pitch: None,
        }
    }

    #[test]
    fn folders_crud_and_idempotency() {
        let db = Db::open_in_memory().unwrap();
        let f1 = db.add_folder("C:/Scores/Kör/").unwrap();
        let f2 = db.add_folder("C:/Scores/Kör").unwrap();
        assert_eq!(f1.id, f2.id);

        let all = db.list_folders().unwrap();
        assert_eq!(all.len(), 1);

        db.remove_folder(&f1.id).unwrap();
        assert!(db.list_folders().unwrap().is_empty());
    }

    #[test]
    fn score_metadata_patch_preserves_omitted_and_clears_explicit_null() {
        let db = Db::open_in_memory().unwrap();
        let s = sample_score("s1", "C:/Music/Notläsare_Bas.pdf", "abc123", "Änglamark");
        db.insert_score(&s).unwrap();

        let patched = db
            .update_score_metadata(
                "s1",
                ScoreMetadataPatch {
                    favorite: Some(true),
                    tags: Some(vec!["Bas".into(), "Kör".into(), "bas".into()]),
                    saved_bpm: Some(Some(88)),
                    saved_time_signature: Some(Some(TimeSignature::ThreeFour)),
                    saved_pitch: Some(Some(SavedPitch {
                        midi_notes: vec![43, 47, 50],
                        label: Some("G2 H2 D3".into()),
                        octave_offset: Some(0),
                    })),
                    ..Default::default()
                },
            )
            .unwrap();

        assert!(patched.favorite);
        assert_eq!(patched.tags, vec!["Bas", "Kör"]);
        assert_eq!(patched.saved_bpm, Some(88));
        assert_eq!(patched.saved_time_signature, Some(TimeSignature::ThreeFour));
        assert_eq!(
            patched.saved_pitch.as_ref().unwrap().midi_notes,
            vec![43, 47, 50]
        );

        // Omitting saved_bpm / saved_pitch keeps them intact; explicit null clears saved_bpm.
        let json_patch = r#"{"lastPage":3,"savedBpm":null}"#;
        let patch2: ScoreMetadataPatch = serde_json::from_str(json_patch).unwrap();
        let patched2 = db.update_score_metadata("s1", patch2).unwrap();
        assert_eq!(patched2.last_page, 3);
        assert_eq!(patched2.saved_bpm, None);
        assert_eq!(patched2.saved_time_signature, Some(TimeSignature::ThreeFour));
        assert!(patched2.saved_pitch.is_some());
    }

    #[test]
    fn score_filters_support_swedish_unicode_and_setlists() {
        let db = Db::open_in_memory().unwrap();
        let mut s1 = sample_score("s1", "C:/Music/anglamark.pdf", "h1", "Änglamark");
        s1.tags = vec!["Kör".into(), "Bas".into()];
        s1.favorite = true;
        s1.last_opened_at = Some("2026-11-22T10:00:00.000Z".into());

        let mut s2 = sample_score("s2", "C:/Music/varsang.pdf", "h2", "Vårsång");
        s2.tags = vec!["Tenor".into()];
        s2.last_opened_at = Some("2026-11-22T11:00:00.000Z".into());

        db.insert_score(&s1).unwrap();
        db.insert_score(&s2).unwrap();

        // Default order: most recently opened first
        let all = db.list_scores(None).unwrap();
        assert_eq!(all.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["s2", "s1"]);

        // Swedish lowercase query matching uppercase Ä
        let q = db
            .list_scores(Some(&ScoreFilter {
                query: Some("ängla".into()),
                ..Default::default()
            }))
            .unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].id, "s1");

        // Tag filter + favorite
        let fav = db
            .list_scores(Some(&ScoreFilter {
                favorite_only: Some(true),
                tag: Some("kör".into()),
                ..Default::default()
            }))
            .unwrap();
        assert_eq!(fav.len(), 1);

        // Setlist order preserved
        let sl = db.create_setlist("Julkonsert").unwrap();
        db.set_setlist_items(
            &sl.id,
            vec![
                SetlistItem {
                    score_id: "s1".into(),
                    position: 0,
                },
                SetlistItem {
                    score_id: "s2".into(),
                    position: 1,
                },
            ],
        )
        .unwrap();
        let by_setlist = db
            .list_scores(Some(&ScoreFilter {
                setlist_id: Some(sl.id),
                ..Default::default()
            }))
            .unwrap();
        assert_eq!(
            by_setlist.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
    }

    #[test]
    fn annotations_default_save_and_json_contract() {
        let db = Db::open_in_memory().unwrap();
        db.insert_score(&sample_score("s1", "C:/a.pdf", "sha1", "A"))
            .unwrap();

        let empty = db.get_page_annotations("s1", 2).unwrap();
        assert_eq!(empty.score_id, "s1");
        assert_eq!(empty.page_num, 2);
        assert_eq!(empty.layers.len(), 1);
        assert_eq!(empty.layers[0].id, "default");
        assert_eq!(empty.layers[0].name, "Anteckningar");
        assert!(empty.layers[0].visible);
        assert!(empty.items.is_empty());

        let page = PageAnnotations {
            score_id: "s1".into(),
            page_num: 2,
            layers: empty.layers,
            items: vec![
                AnnotationItem::Stroke(StrokeAnnotation {
                    id: "st1".into(),
                    layer_id: "default".into(),
                    tool: StrokeTool::Highlighter,
                    points: vec![
                        StrokePoint {
                            x: 0.1,
                            y: 0.2,
                            p: Some(0.5),
                        },
                        StrokePoint {
                            x: 0.3,
                            y: 0.2,
                            p: None,
                        },
                    ],
                    color: "#f7c948".into(),
                    width: 0.02,
                    opacity: 0.45,
                    multiply: Some(true),
                }),
                AnnotationItem::Shape(ShapeAnnotation {
                    id: "sh1".into(),
                    layer_id: "default".into(),
                    shape_type: ShapeType::Slur,
                    start: NormalizedPoint { x: 0.2, y: 0.4 },
                    end: NormalizedPoint { x: 0.5, y: 0.4 },
                    control: Some(NormalizedPoint { x: 0.35, y: 0.32 }),
                    color: "#141416".into(),
                    width: 0.004,
                }),
                AnnotationItem::Stamp(StampAnnotation {
                    id: "sm1".into(),
                    layer_id: "default".into(),
                    stamp_type: StampType::WatchConductor,
                    position: NormalizedPoint { x: 0.5, y: 0.15 },
                    scale: 1.2,
                    rotation: Some(0.0),
                    color: "#d64545".into(),
                }),
                AnnotationItem::Text(TextAnnotation {
                    id: "tx1".into(),
                    layer_id: "default".into(),
                    position: NormalizedPoint { x: 0.6, y: 0.7 },
                    text: "Andas ej!".into(),
                    font_size: 0.025,
                    color: "#d64545".into(),
                    bg_color: Some("#ffffff".into()),
                }),
            ],
            updated_at: String::new(),
        };

        let saved = db.save_page_annotations(page).unwrap();
        assert!(!saved.updated_at.is_empty());

        // Verify exact camelCase JSON serialization matching src/types/index.ts
        let serialized = serde_json::to_value(&saved).unwrap();
        assert_eq!(serialized["scoreId"], "s1");
        assert_eq!(serialized["pageNum"], 2);
        assert_eq!(serialized["items"][0]["kind"], "stroke");
        assert_eq!(serialized["items"][0]["layerId"], "default");
        assert_eq!(serialized["items"][1]["kind"], "shape");
        assert_eq!(serialized["items"][1]["shapeType"], "slur");
        assert_eq!(serialized["items"][2]["kind"], "stamp");
        assert_eq!(serialized["items"][2]["stampType"], "watch_conductor");
        assert_eq!(serialized["items"][3]["kind"], "text");
        assert_eq!(serialized["items"][3]["fontSize"], 0.025);
        assert_eq!(serialized["items"][3]["bgColor"], "#ffffff");

        let score_anns = db.get_score_annotations("s1").unwrap();
        assert_eq!(score_anns.len(), 1);

        db.clear_page_annotations("s1", 2).unwrap();
        assert!(db.get_page_annotations("s1", 2).unwrap().items.is_empty());
    }

    #[test]
    fn bookmarks_setlists_and_cascade_delete() {
        let db = Db::open_in_memory().unwrap();
        db.insert_score(&sample_score("s1", "C:/a.pdf", "sha1", "A"))
            .unwrap();

        let bm = db
            .upsert_bookmark(UpsertBookmarkInput {
                id: None,
                score_id: "s1".into(),
                page_num: 3,
                label: "Takt 42".into(),
            })
            .unwrap();
        let bm_updated = db
            .upsert_bookmark(UpsertBookmarkInput {
                id: Some(bm.id.clone()),
                score_id: "s1".into(),
                page_num: 4,
                label: "Refräng".into(),
            })
            .unwrap();
        assert_eq!(bm_updated.id, bm.id);
        assert_eq!(bm_updated.page_num, 4);
        assert_eq!(db.list_bookmarks("s1").unwrap().len(), 1);

        let sl = db.create_setlist("Konsert").unwrap();
        let sl = db.rename_setlist(&sl.id, "Vårkonsert").unwrap();
        assert_eq!(sl.name, "Vårkonsert");
        let sl = db
            .set_setlist_items(
                &sl.id,
                vec![SetlistItem {
                    score_id: "s1".into(),
                    position: 0,
                }],
            )
            .unwrap();
        assert_eq!(sl.items.len(), 1);

        // Deleting score cascades to bookmarks, annotations, and setlist_items
        db.delete_score_record("s1").unwrap();
        assert!(db.list_bookmarks("s1").unwrap().is_empty());
        assert!(db.list_setlists().unwrap()[0].items.is_empty());
    }

    #[test]
    fn settings_defaults_and_pitch_clamping() {
        let db = Db::open_in_memory().unwrap();
        let defaults = db.get_settings().unwrap();
        assert_eq!(defaults.language, AppLanguage::Sv);
        assert_eq!(defaults.note_naming, NoteNaming::Auto);
        assert_eq!(defaults.reference_pitch_hz, 440.0);
        assert!(defaults.auto_crop_default);
        assert!(defaults.wake_lock_enabled);

        let mut custom = defaults;
        custom.language = AppLanguage::En;
        custom.note_naming = NoteNaming::Sv;
        custom.reference_pitch_hz = 450.0; // clamps to 444.0
        let saved = db.save_settings(custom).unwrap();
        assert_eq!(saved.reference_pitch_hz, 444.0);
        assert_eq!(db.get_settings().unwrap().language, AppLanguage::En);
    }

    #[test]
    fn bookmark_upsert_enforces_cross_score_isolation() {
        let db = Db::open_in_memory().unwrap();
        db.insert_score(&sample_score("s1", "C:/a.pdf", "sha1", "A"))
            .unwrap();
        db.insert_score(&sample_score("s2", "C:/b.pdf", "sha2", "B"))
            .unwrap();

        let bm = db
            .upsert_bookmark(UpsertBookmarkInput {
                id: None,
                score_id: "s1".into(),
                page_num: 2,
                label: "Vers 1".into(),
            })
            .unwrap();

        let err = db
            .upsert_bookmark(UpsertBookmarkInput {
                id: Some(bm.id.clone()),
                score_id: "s2".into(),
                page_num: 9,
                label: "Hijack".into(),
            })
            .unwrap_err();
        assert!(err.contains("different") || err.contains("belong"));

        let s1_bookmarks = db.list_bookmarks("s1").unwrap();
        assert_eq!(s1_bookmarks.len(), 1);
        assert_eq!(s1_bookmarks[0].label, "Vers 1");
        assert_eq!(s1_bookmarks[0].page_num, 2);
        assert!(db.list_bookmarks("s2").unwrap().is_empty());
    }

    #[test]
    fn save_page_annotations_rejects_invalid_color_and_nan_coordinates() {
        let db = Db::open_in_memory().unwrap();
        db.insert_score(&sample_score("s1", "C:/a.pdf", "sha1", "A"))
            .unwrap();

        let base_layers = db.get_page_annotations("s1", 1).unwrap().layers;

        let bad_color = PageAnnotations {
            score_id: "s1".into(),
            page_num: 1,
            layers: base_layers.clone(),
            items: vec![AnnotationItem::Stamp(StampAnnotation {
                id: "sm1".into(),
                layer_id: "default".into(),
                stamp_type: StampType::Breath,
                position: NormalizedPoint { x: 0.5, y: 0.5 },
                scale: 1.0,
                rotation: None,
                color: "url(javascript:alert(1))".into(),
            })],
            updated_at: String::new(),
        };
        assert!(db.save_page_annotations(bad_color).is_err());

        let bad_nan = PageAnnotations {
            score_id: "s1".into(),
            page_num: 1,
            layers: base_layers.clone(),
            items: vec![AnnotationItem::Stroke(StrokeAnnotation {
                id: "st1".into(),
                layer_id: "default".into(),
                tool: StrokeTool::Pen,
                points: vec![StrokePoint {
                    x: f64::NAN,
                    y: 0.2,
                    p: None,
                }],
                color: "rgba(20, 20, 22, 0.8)".into(),
                width: 0.01,
                opacity: 1.0,
                multiply: None,
            })],
            updated_at: String::new(),
        };
        assert!(db.save_page_annotations(bad_nan).is_err());

        // Valid rgb/rgba colors succeed
        let valid = PageAnnotations {
            score_id: "s1".into(),
            page_num: 1,
            layers: base_layers,
            items: vec![AnnotationItem::Text(TextAnnotation {
                id: "tx1".into(),
                layer_id: "default".into(),
                position: NormalizedPoint { x: 0.2, y: 0.3 },
                text: "Forte".into(),
                font_size: 0.03,
                color: "rgb(20, 20, 22)".into(),
                bg_color: Some("rgba(255, 255, 255, 0.9)".into()),
            })],
            updated_at: String::new(),
        };
        assert!(db.save_page_annotations(valid).is_ok());
    }
}
