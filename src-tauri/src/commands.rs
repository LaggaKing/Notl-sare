use crate::db::{
    new_id, normalize_path_str, AppSettings, Bookmark, Db, LibraryFolder, LibraryScanResult,
    PageAnnotations, ScoreFilter, ScoreMetadataPatch, ScoreRecord, Setlist, SetlistItem,
    UpsertBookmarkInput,
};
use crate::library::{self, MAX_PDF_BYTES};
use crate::wakelock::WakeLockState;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};
use tauri_plugin_dialog::DialogExt;

pub const MAX_BACKUP_BYTES: usize = 25 * 1024 * 1024;
const MAX_FILENAME_CHARS: usize = 120;

pub struct AppState {
    pub db: Mutex<Db>,
    pub wake_lock: WakeLockState,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db: Mutex::new(db),
            wake_lock: WakeLockState::new(),
        }
    }
}

fn lock_db<'a>(state: &'a State<'_, AppState>) -> Result<std::sync::MutexGuard<'a, Db>, String> {
    state
        .db
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())
}

fn has_extension(path: &Path, expected_ext: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(expected_ext))
        .unwrap_or(false)
}

fn enforce_extension(path: PathBuf, required_ext: &str) -> PathBuf {
    if has_extension(&path, required_ext) {
        return path;
    }
    let mut os = path.into_os_string();
    os.push(".");
    os.push(required_ext);
    PathBuf::from(os)
}

pub fn percent_decode_utf8(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn sanitize_export_filename(raw_name: &str, required_ext: &str, fallback_stem: &str) -> String {
    let leaf = raw_name.trim().rsplit(['/', '\\']).next().unwrap_or("");
    let mut cleaned = String::with_capacity(leaf.len());
    for ch in leaf.chars() {
        if ch.is_control()
            || matches!(
                ch,
                '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            )
        {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }

    let suffix = format!(".{}", required_ext.to_ascii_lowercase());
    let mut stem = if cleaned.to_ascii_lowercase().ends_with(&suffix) {
        let cut = cleaned.len() - suffix.len();
        cleaned[..cut].to_string()
    } else {
        cleaned
    };

    while stem.contains("..") {
        stem = stem.replace("..", ".");
    }

    stem = stem
        .trim_matches(|c: char| c.is_whitespace() || c == '.')
        .to_string();

    if stem.is_empty() {
        stem = fallback_stem.to_string();
    } else if library::is_windows_reserved_name(&stem) {
        stem = format!("_{stem}");
    }

    let max_stem_chars = MAX_FILENAME_CHARS.saturating_sub(required_ext.len() + 1);
    if stem.chars().count() > max_stem_chars {
        stem = stem.chars().take(max_stem_chars).collect();
        stem = stem
            .trim_end_matches(|c: char| c.is_whitespace() || c == '.')
            .to_string();
        if stem.is_empty() {
            stem = fallback_stem.chars().take(max_stem_chars).collect();
        }
    }

    format!("{stem}.{required_ext}")
}

pub fn read_bounded_file(
    path: &Path,
    expected_ext: &str,
    max_bytes: usize,
    require_pdf_magic: bool,
) -> Result<Vec<u8>, String> {
    library::validate_local_path(path)?;

    if !has_extension(path, expected_ext) {
        return Err(format!("Expected a .{expected_ext} file"));
    }
    if !path.is_file() {
        return Err("Selected file does not exist or is not a regular file".to_string());
    }

    let file = File::open(path).map_err(|e| library::format_path_error("Failed to open file", path, &e))?;
    if let Ok(meta) = file.metadata() {
        if meta.len() > max_bytes as u64 {
            return Err("File exceeds maximum allowed size".to_string());
        }
    }

    let mut buf = Vec::new();
    file.take((max_bytes as u64) + 1)
        .read_to_end(&mut buf)
        .map_err(|e| library::format_path_error("Failed to read file", path, &e))?;

    if buf.len() > max_bytes {
        return Err("File exceeds maximum allowed size".to_string());
    }
    if require_pdf_magic && !buf.starts_with(b"%PDF-") {
        return Err("Invalid PDF file header".to_string());
    }

    Ok(buf)
}

fn write_bytes_atomically(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    library::validate_local_path(dest)?;

    if dest.is_dir() {
        return Err("Destination path is a directory".to_string());
    }
    if let Ok(meta) = std::fs::symlink_metadata(dest) {
        if meta.file_type().is_symlink() {
            return Err("Destination path cannot be a symbolic link".to_string());
        }
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("Destination folder does not exist".to_string());
        }
    }

    let tmp_name = format!(
        ".{}.{}.tmp",
        dest.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("export"),
        new_id("write")
    );
    let tmp_path = dest.with_file_name(tmp_name);

    let write_res = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(err) = write_res {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(library::format_path_error(
            "Failed to write temporary export file",
            dest,
            &err,
        ));
    }

    if let Err(err) = std::fs::rename(&tmp_path, dest) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(library::format_path_error(
            "Failed to finalize exported file",
            dest,
            &err,
        ));
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pick_and_add_library_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LibraryFolder>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Folder picker task failed: {e}"))?;

    let Some(folder_path) = picked else {
        return Ok(None);
    };

    let raw_path = folder_path
        .into_path()
        .map_err(|_| "Selected folder is not on a local filesystem".to_string())?;

    let canonical_str = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        library::validate_local_path(&raw_path)?;
        if !raw_path.is_dir() {
            return Err("Selected path is not a folder".to_string());
        }
        let canonical = std::fs::canonicalize(&raw_path)
            .map_err(|e| library::format_path_error("Failed to resolve folder", &raw_path, &e))?;
        library::validate_local_path(&canonical)?;
        if !canonical.is_dir() {
            return Err("Selected path is not a folder".to_string());
        }
        Ok(normalize_path_str(&canonical.to_string_lossy()))
    })
    .await
    .map_err(|e| format!("Folder validation task failed: {e}"))??;

    let db = lock_db(&state)?;
    let folder = db.add_folder(&canonical_str)?;
    Ok(Some(folder))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pick_and_import_pdf_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ScoreRecord>, String> {
    let candidates = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<library::DiscoveredPdf>, String> {
        let Some(selected) = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .blocking_pick_files()
        else {
            return Ok(Vec::new());
        };

        let mut paths = Vec::with_capacity(selected.len());
        for item in selected {
            let path = item
                .into_path()
                .map_err(|_| "Selected file is not on a local filesystem".to_string())?;
            library::validate_local_path(&path)?;
            paths.push(path.to_string_lossy().into_owned());
        }
        library::read_import_candidates(&paths)
    })
    .await
    .map_err(|e| format!("PDF import task failed: {e}"))??;

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let db = lock_db(&state)?;
    library::apply_import_candidates(&db, candidates)
}

#[tauri::command(rename_all = "camelCase")]
pub fn remove_library_folder(state: State<'_, AppState>, folder_id: String) -> Result<(), String> {
    let db = lock_db(&state)?;
    db.remove_folder(&folder_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_library_folders(state: State<'_, AppState>) -> Result<Vec<LibraryFolder>, String> {
    let db = lock_db(&state)?;
    db.list_folders()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_library(
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> Result<LibraryScanResult, String> {
    let (folders, scoped_roots) = {
        let db = lock_db(&state)?;
        match folder_id.as_deref() {
            Some(id) => {
                let folder = db
                    .get_folder(id)?
                    .ok_or_else(|| format!("Library folder not found: {id}"))?;
                let roots = vec![folder.path.clone()];
                (vec![folder], Some(roots))
            }
            None => (db.list_folders()?, None),
        }
    };

    let discovered =
        tauri::async_runtime::spawn_blocking(move || library::discover_pdfs_in_folders(&folders))
            .await
            .map_err(|e| format!("Library scan task failed: {e}"))?;

    let db = lock_db(&state)?;
    library::reconcile_discovered_pdfs(&db, discovered, scoped_roots.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_scores(
    state: State<'_, AppState>,
    filter: Option<ScoreFilter>,
) -> Result<Vec<ScoreRecord>, String> {
    let db = lock_db(&state)?;
    db.list_scores(filter.as_ref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_score(
    state: State<'_, AppState>,
    score_id: String,
) -> Result<Option<ScoreRecord>, String> {
    let db = lock_db(&state)?;
    db.get_score(&score_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_score_metadata(
    state: State<'_, AppState>,
    score_id: String,
    patch: ScoreMetadataPatch,
) -> Result<ScoreRecord, String> {
    let db = lock_db(&state)?;
    db.update_score_metadata(&score_id, patch)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_score_record(state: State<'_, AppState>, score_id: String) -> Result<(), String> {
    let db = lock_db(&state)?;
    db.delete_score_record(&score_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_pdf_bytes(
    state: State<'_, AppState>,
    score_id: String,
) -> Result<Response, String> {
    let file_path = {
        let db = lock_db(&state)?;
        let score = db
            .get_score(&score_id)?
            .ok_or_else(|| "Score not found".to_string())?;
        score.file_path
    };

    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_bounded_file(Path::new(&file_path), "pdf", MAX_PDF_BYTES, true)
    })
    .await
    .map_err(|e| format!("PDF read task failed: {e}"))??;

    Ok(Response::new(bytes))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_pdf_with_dialog(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<bool, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(raw) => raw.clone(),
        _ => return Err("Expected raw binary PDF payload".to_string()),
    };

    if bytes.len() > MAX_PDF_BYTES {
        return Err("PDF payload exceeds maximum allowed size".to_string());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("Invalid PDF payload".to_string());
    }

    let raw_header = request
        .headers()
        .get("x-default-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("score-annotated.pdf");
    let decoded = percent_decode_utf8(raw_header);
    let safe_name = sanitize_export_filename(&decoded, "pdf", "score-annotated");

    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_file_name(&safe_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };

        let dest = picked
            .into_path()
            .map_err(|_| "Selected destination is not on a local filesystem".to_string())?;
        let dest = enforce_extension(dest, "pdf");
        write_bytes_atomically(&dest, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("PDF export task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_backup_with_dialog(
    app: tauri::AppHandle,
    default_filename: String,
    json_content: String,
) -> Result<bool, String> {
    if json_content.len() > MAX_BACKUP_BYTES {
        return Err("Backup payload exceeds maximum allowed size".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&json_content)
        .map_err(|_| "Backup payload is not valid JSON".to_string())?;

    let safe_name = sanitize_export_filename(&default_filename, "json", "notl-sare-backup");

    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(&safe_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };

        let dest = picked
            .into_path()
            .map_err(|_| "Selected destination is not on a local filesystem".to_string())?;
        let dest = enforce_extension(dest, "json");
        write_bytes_atomically(&dest, json_content.as_bytes())?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("Backup export task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_backup_with_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };

        let path = picked
            .into_path()
            .map_err(|_| "Selected file is not on a local filesystem".to_string())?;
        let bytes = read_bounded_file(&path, "json", MAX_BACKUP_BYTES, false)?;
        let text = String::from_utf8(bytes)
            .map_err(|_| "Backup file must be valid UTF-8 text".to_string())?;
        serde_json::from_str::<serde_json::Value>(&text)
            .map_err(|_| "Backup file is not valid JSON".to_string())?;
        Ok(Some(text))
    })
    .await
    .map_err(|e| format!("Backup import task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_bookmarks(
    state: State<'_, AppState>,
    score_id: String,
) -> Result<Vec<Bookmark>, String> {
    let db = lock_db(&state)?;
    db.list_bookmarks(&score_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn upsert_bookmark(
    state: State<'_, AppState>,
    bookmark: UpsertBookmarkInput,
) -> Result<Bookmark, String> {
    let db = lock_db(&state)?;
    db.upsert_bookmark(bookmark)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_bookmark(state: State<'_, AppState>, bookmark_id: String) -> Result<(), String> {
    let db = lock_db(&state)?;
    db.delete_bookmark(&bookmark_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_setlists(state: State<'_, AppState>) -> Result<Vec<Setlist>, String> {
    let db = lock_db(&state)?;
    db.list_setlists()
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_setlist(state: State<'_, AppState>, name: String) -> Result<Setlist, String> {
    let db = lock_db(&state)?;
    db.create_setlist(&name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn rename_setlist(
    state: State<'_, AppState>,
    setlist_id: String,
    name: String,
) -> Result<Setlist, String> {
    let db = lock_db(&state)?;
    db.rename_setlist(&setlist_id, &name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_setlist(state: State<'_, AppState>, setlist_id: String) -> Result<(), String> {
    let db = lock_db(&state)?;
    db.delete_setlist(&setlist_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_setlist_items(
    state: State<'_, AppState>,
    setlist_id: String,
    items: Vec<SetlistItem>,
) -> Result<Setlist, String> {
    let db = lock_db(&state)?;
    db.set_setlist_items(&setlist_id, items)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_page_annotations(
    state: State<'_, AppState>,
    score_id: String,
    page_num: u32,
) -> Result<PageAnnotations, String> {
    let db = lock_db(&state)?;
    db.get_page_annotations(&score_id, page_num)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_score_annotations(
    state: State<'_, AppState>,
    score_id: String,
) -> Result<Vec<PageAnnotations>, String> {
    let db = lock_db(&state)?;
    db.get_score_annotations(&score_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_page_annotations(
    state: State<'_, AppState>,
    annotations: PageAnnotations,
) -> Result<PageAnnotations, String> {
    let db = lock_db(&state)?;
    db.save_page_annotations(annotations)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let db = lock_db(&state)?;
    db.get_settings()
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let db = lock_db(&state)?;
    db.save_settings(settings)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_wake_lock(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    Ok(state.wake_lock.set_enabled(enabled))
}

#[cfg(test)]
mod tests {
    use super::{
        percent_decode_utf8, read_bounded_file, sanitize_export_filename, write_bytes_atomically,
    };
    use crate::db::new_id;
    use crate::library::validate_local_path;
    use std::fs;
    use std::path::Path;

    #[test]
    fn write_bytes_atomically_creates_and_replaces_pdf() {
        let dir = std::env::temp_dir().join(format!("notl_sare_cmd_test_{}", new_id("write")));
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("export.pdf");

        write_bytes_atomically(&dest, b"%PDF-1.7 first").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"%PDF-1.7 first");

        write_bytes_atomically(&dest, b"%PDF-1.7 second").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"%PDF-1.7 second");

        // Non-existent parent directory is rejected rather than created arbitrarily
        let missing_dir_dest = dir.join("nonexistent_sub").join("export.pdf");
        assert!(write_bytes_atomically(&missing_dir_dest, b"%PDF-1.7 nope").is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unc_and_device_paths_in_commands() {
        assert!(validate_local_path(Path::new(r"\\server\share\score.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"\\?\UNC\server\share\score.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"\\.\COM1")).is_err());
        assert!(validate_local_path(Path::new(r"C:\Scores\CON.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"C:\Scores\NUL.json")).is_err());
    }

    #[test]
    fn read_bounded_file_validates_magic_header_and_size_cap() {
        let dir = std::env::temp_dir().join(format!("notl_sare_read_test_{}", new_id("read")));
        fs::create_dir_all(&dir).unwrap();

        let bad_pdf = dir.join("bad.pdf");
        fs::write(&bad_pdf, b"NOT_A_PDF").unwrap();
        assert!(read_bounded_file(&bad_pdf, "pdf", 1024, true).is_err());

        let big_pdf = dir.join("big.pdf");
        fs::write(&big_pdf, b"%PDF-1.7 0123456789ABCDEF").unwrap();
        assert!(read_bounded_file(&big_pdf, "pdf", 10, true).is_err());
        assert_eq!(
            read_bounded_file(&big_pdf, "pdf", 1024, true).unwrap(),
            b"%PDF-1.7 0123456789ABCDEF"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn percent_decode_and_sanitize_export_filename_handle_swedish_and_unsafe_names() {
        let decoded = percent_decode_utf8("V%C3%A5rs%C3%A5ng%20-%20%C3%84nglamark.pdf");
        assert_eq!(decoded, "Vårsång - Änglamark.pdf");
        assert_eq!(
            sanitize_export_filename(&decoded, "pdf", "score"),
            "Vårsång - Änglamark.pdf"
        );

        assert_eq!(
            sanitize_export_filename("../../etc/CON.pdf", "pdf", "score"),
            "_CON.pdf"
        );
        assert_eq!(
            sanitize_export_filename("a<b>c:d\"e|f?g*h..pdf", "pdf", "score"),
            "a_b_c_d_e_f_g_h.pdf"
        );
        assert_eq!(
            sanitize_export_filename("   ...  ", "json", "notl-sare-backup"),
            "notl-sare-backup.json"
        );

        let long_name = format!("{}.pdf", "å".repeat(150));
        let sanitized = sanitize_export_filename(&long_name, "pdf", "score");
        assert!(sanitized.ends_with(".pdf"));
        assert!(sanitized.chars().count() <= 120);
    }
}
