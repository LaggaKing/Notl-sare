use crate::db::{new_id, normalize_path_str, Db, LibraryFolder, LibraryScanResult, ScoreRecord};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Component, Path, Prefix};
use walkdir::WalkDir;

const HASH_BUF_SIZE: usize = 64 * 1024;
pub const MAX_PDF_BYTES: usize = 200 * 1024 * 1024;
pub const MAX_SCAN_DEPTH: usize = 16;
pub const MAX_SCAN_FILES: usize = 5_000;

#[derive(Debug, Clone)]
pub struct DiscoveredPdf {
    pub file_path: String,
    pub filename: String,
    pub title: String,
    pub sha256: String,
}

pub(crate) fn format_path_error(msg: &str, path: &Path, err: &dyn std::fmt::Display) -> String {
    #[cfg(debug_assertions)]
    {
        format!("{msg} '{}': {err}", path.display())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = path;
        format!("{msg}: {err}")
    }
}

pub fn is_windows_reserved_name(name: &str) -> bool {
    let trimmed = name.trim_end_matches(['.', ' ']);
    let stem = trimmed.split('.').next().unwrap_or("");
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn is_verbatim_disk_prefix(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    raw.starts_with(r"\\?\")
        && bytes.len() >= 6
        && bytes[4].is_ascii_alphabetic()
        && bytes[5] == b':'
        && (bytes.len() == 6 || bytes[6] == b'\\' || bytes[6] == b'/')
}

pub fn is_unc_or_device_path(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    let trimmed = raw.trim();
    let upper = trimmed.to_ascii_uppercase();
    if upper.starts_with(r"\\?\UNC\") || upper.starts_with("//?/UNC/") {
        return true;
    }
    if trimmed.starts_with(r"\\.\") || trimmed.starts_with("//./") {
        return true;
    }
    if (trimmed.starts_with(r"\\") || trimmed.starts_with("//"))
        && !is_verbatim_disk_prefix(trimmed)
    {
        return true;
    }

    for comp in path.components() {
        match comp {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _) | Prefix::DeviceNS(_) => return true,
                Prefix::Verbatim(_) => return true,
                Prefix::Disk(_) | Prefix::VerbatimDisk(_) => {}
            },
            Component::Normal(seg) => {
                if let Some(s) = seg.to_str() {
                    if is_windows_reserved_name(s) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }

    false
}

pub fn validate_local_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    if is_unc_or_device_path(path) {
        return Err("Network UNC and Windows device paths are not allowed".to_string());
    }
    Ok(())
}

/// Validate `.pdf` extension, `%PDF-` magic header, non-UNC/device path, and 200 MB size cap,
/// then compute lowercase hex SHA-256 in a single streaming pass.
pub fn validate_and_hash_pdf(path: &Path) -> Result<String, String> {
    validate_local_path(path)?;
    if !is_pdf_path(path) {
        return Err("Not a PDF file".to_string());
    }
    if !path.is_file() {
        return Err("PDF file does not exist".to_string());
    }

    let file = File::open(path).map_err(|e| format_path_error("Failed to open PDF", path, &e))?;
    if let Ok(meta) = file.metadata() {
        if meta.len() > MAX_PDF_BYTES as u64 {
            return Err("PDF file exceeds maximum allowed size (200 MB)".to_string());
        }
    }

    let mut reader = BufReader::with_capacity(HASH_BUF_SIZE, file.take((MAX_PDF_BYTES as u64) + 1));
    let mut header = [0u8; 5];
    let mut header_read = 0usize;
    while header_read < 5 {
        let n = reader
            .read(&mut header[header_read..])
            .map_err(|e| format_path_error("Failed to read PDF", path, &e))?;
        if n == 0 {
            break;
        }
        header_read += n;
    }

    if header_read < 5 || &header != b"%PDF-" {
        return Err("Invalid PDF file header".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(header);
    let mut total_read = header_read;
    let mut buf = [0u8; HASH_BUF_SIZE];

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format_path_error("Failed to read PDF", path, &e))?;
        if n == 0 {
            break;
        }
        total_read += n;
        if total_read > MAX_PDF_BYTES {
            return Err("PDF file exceeds maximum allowed size (200 MB)".to_string());
        }
        hasher.update(&buf[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Compute lowercase hex SHA-256 of a file using a streaming buffer.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format_path_error("Failed to open file", path, &e))?;
    let mut reader = BufReader::with_capacity(HASH_BUF_SIZE, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; HASH_BUF_SIZE];

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format_path_error("Failed to read file", path, &e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Derive a clean initial display title from a PDF filename stem.
pub fn derive_title_from_stem(path: &Path) -> String {
    let raw_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Namnlös not")
        .trim();

    if raw_stem.is_empty() {
        return "Namnlös not".to_string();
    }

    let had_spaces = raw_stem.contains(' ');
    let mut replaced = raw_stem.replace('_', " ");
    if !had_spaces {
        replaced = replaced.replace('-', " ");
    }

    let collapsed: String = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        raw_stem.to_string()
    } else {
        collapsed
    }
}

pub fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

/// Walk the given library folders on disk and hash all discovered `.pdf` files.
/// Intended to be called without holding any DB mutex lock.
pub fn discover_pdfs_in_folders(folders: &[LibraryFolder]) -> Vec<DiscoveredPdf> {
    let mut seen_paths = HashSet::new();
    let mut discovered = Vec::new();
    let mut files_seen = 0usize;

    for folder in folders {
        let root = Path::new(&folder.path);
        if validate_local_path(root).is_err() || !root.is_dir() {
            continue;
        }

        for entry in WalkDir::new(root)
            .follow_links(false)
            .max_depth(MAX_SCAN_DEPTH)
            .into_iter()
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            files_seen += 1;
            if files_seen > MAX_SCAN_FILES {
                break;
            }

            let path = entry.path();
            if !is_pdf_path(path) {
                continue;
            }

            let raw_str = path.to_string_lossy();
            let norm_path = normalize_path_str(&raw_str);
            if norm_path.is_empty() {
                continue;
            }

            #[cfg(target_os = "windows")]
            let dedup_key = norm_path.to_lowercase();
            #[cfg(not(target_os = "windows"))]
            let dedup_key = norm_path.clone();

            if !seen_paths.insert(dedup_key) {
                continue;
            }

            let sha256 = match validate_and_hash_pdf(path) {
                Ok(hash) => hash,
                Err(_) => continue,
            };

            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("score.pdf")
                .to_string();
            let title = derive_title_from_stem(path);

            discovered.push(DiscoveredPdf {
                file_path: norm_path,
                filename,
                title,
                sha256,
            });
        }

        if files_seen > MAX_SCAN_FILES {
            break;
        }
    }

    discovered
}

/// Reconcile pre-discovered PDFs against SQLite (insert new, update changed hashes,
/// and relink moved/renamed files by SHA-256 when old `file_path` no longer exists).
pub fn reconcile_discovered_pdfs(
    db: &Db,
    discovered: Vec<DiscoveredPdf>,
    scoped_folder_paths: Option<&[String]>,
) -> Result<LibraryScanResult, String> {
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut reconciled_ids = HashSet::new();

    for pdf in discovered {
        if let Some(existing) = db.get_score_by_path(&pdf.file_path)? {
            if existing.sha256 != pdf.sha256 {
                db.update_score_sha256(&existing.id, &pdf.sha256)?;
                updated += 1;
            }
            reconciled_ids.insert(existing.id);
            continue;
        }

        // Attempt SHA-256 content-hash reconciliation for moved or renamed files
        let candidates = db.find_scores_by_sha256(&pdf.sha256)?;
        let moved_match = candidates.into_iter().find(|cand| {
            !reconciled_ids.contains(&cand.id) && !Path::new(&cand.file_path).exists()
        });

        if let Some(matched) = moved_match {
            db.update_score_path_and_hash(
                &matched.id,
                &pdf.file_path,
                &pdf.filename,
                &pdf.sha256,
            )?;
            reconciled_ids.insert(matched.id);
            updated += 1;
        } else {
            let new_score = ScoreRecord {
                id: new_id(&pdf.file_path),
                file_path: pdf.file_path,
                sha256: pdf.sha256,
                title: pdf.title,
                filename: pdf.filename,
                page_count: 0,
                last_page: 1,
                last_opened_at: None,
                favorite: false,
                tags: Vec::new(),
                crop: None,
                saved_bpm: None,
                saved_time_signature: None,
                saved_pitch: None,
            };
            db.insert_score(&new_score)?;
            reconciled_ids.insert(new_score.id);
            added += 1;
        }
    }

    let scores = db.list_scores(None)?;
    let missing = scores
        .iter()
        .filter(|s| {
            let within_scope = match scoped_folder_paths {
                Some(roots) => roots.iter().any(|root| path_is_inside(&s.file_path, root)),
                None => true,
            };
            within_scope && !Path::new(&s.file_path).exists()
        })
        .count();

    Ok(LibraryScanResult {
        added,
        updated,
        missing,
        scores,
    })
}

fn normalize_for_prefix_check(raw: &str) -> String {
    let mut s = normalize_path_str(raw);
    #[cfg(target_os = "windows")]
    {
        s = s.to_lowercase();
    }
    s
}

fn path_is_inside(candidate: &str, folder_root: &str) -> bool {
    let c = normalize_for_prefix_check(candidate);
    let r = normalize_for_prefix_check(folder_root);
    if c.is_empty() || r.is_empty() {
        return false;
    }
    Path::new(&c).starts_with(Path::new(&r))
}

/// Scan linked library folders (or a single folder by id) and reconcile all PDFs.
pub fn scan_folders(db: &Db, folder_id: Option<&str>) -> Result<LibraryScanResult, String> {
    let folders = match folder_id {
        Some(id) => {
            let folder = db
                .get_folder(id)?
                .ok_or_else(|| format!("Library folder not found: {id}"))?;
            vec![folder]
        }
        None => db.list_folders()?,
    };

    let scoped_roots: Option<Vec<String>> =
        folder_id.map(|_| folders.iter().map(|f| f.path.clone()).collect());
    let discovered = discover_pdfs_in_folders(&folders);
    reconcile_discovered_pdfs(db, discovered, scoped_roots.as_deref())
}

/// Hash and prepare individual PDF paths on disk without holding a DB lock.
pub fn read_import_candidates(file_paths: &[String]) -> Result<Vec<DiscoveredPdf>, String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for raw in file_paths {
        let raw_path = Path::new(raw.trim());
        validate_local_path(raw_path)?;

        let norm = normalize_path_str(raw);
        if norm.is_empty() {
            continue;
        }

        let path = Path::new(&norm);
        validate_local_path(path)?;

        #[cfg(target_os = "windows")]
        let key = norm.to_lowercase();
        #[cfg(not(target_os = "windows"))]
        let key = norm.clone();

        if !seen.insert(key) {
            continue;
        }

        let sha256 = validate_and_hash_pdf(path)?;
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("score.pdf")
            .to_string();
        let title = derive_title_from_stem(path);

        out.push(DiscoveredPdf {
            file_path: norm,
            filename,
            title,
            sha256,
        });
    }

    Ok(out)
}

/// Reconcile pre-hashed single PDF imports against SQLite and return their ScoreRecords.
pub fn apply_import_candidates(
    db: &Db,
    candidates: Vec<DiscoveredPdf>,
) -> Result<Vec<ScoreRecord>, String> {
    let mut result = Vec::with_capacity(candidates.len());
    let mut used_ids = HashSet::new();

    for pdf in candidates {
        if let Some(existing) = db.get_score_by_path(&pdf.file_path)? {
            if existing.sha256 != pdf.sha256 {
                db.update_score_sha256(&existing.id, &pdf.sha256)?;
            }
            let fresh = db
                .get_score(&existing.id)?
                .ok_or_else(|| format!("Score missing after lookup: {}", existing.id))?;
            used_ids.insert(fresh.id.clone());
            result.push(fresh);
            continue;
        }

        let sha_matches = db.find_scores_by_sha256(&pdf.sha256)?;
        let moved_match = sha_matches
            .into_iter()
            .find(|c| !used_ids.contains(&c.id) && !Path::new(&c.file_path).exists());

        if let Some(matched) = moved_match {
            let updated = db.update_score_path_and_hash(
                &matched.id,
                &pdf.file_path,
                &pdf.filename,
                &pdf.sha256,
            )?;
            used_ids.insert(updated.id.clone());
            result.push(updated);
        } else {
            let new_score = ScoreRecord {
                id: new_id(&pdf.file_path),
                file_path: pdf.file_path,
                sha256: pdf.sha256,
                title: pdf.title,
                filename: pdf.filename,
                page_count: 0,
                last_page: 1,
                last_opened_at: None,
                favorite: false,
                tags: Vec::new(),
                crop: None,
                saved_bpm: None,
                saved_time_signature: None,
                saved_pitch: None,
            };
            db.insert_score(&new_score)?;
            used_ids.insert(new_score.id.clone());
            result.push(new_score);
        }
    }

    Ok(result)
}

/// Import one or more standalone PDF files into SQLite without linking their parent folder.
pub fn import_pdf_files(db: &Db, file_paths: &[String]) -> Result<Vec<ScoreRecord>, String> {
    let candidates = read_import_candidates(file_paths)?;
    apply_import_candidates(db, candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        AnnotationItem, CropMode, CropSettings, NormalizedPoint, ScoreMetadataPatch,
        StampAnnotation, StampType, UpsertBookmarkInput,
    };
    use std::fs;
    use std::path::PathBuf;

    struct TempTestDir {
        path: PathBuf,
    }

    impl TempTestDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("notl_sare_test_{}_{}", name, new_id(name)));
            fs::create_dir_all(&dir).unwrap();
            Self { path: dir }
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn title_derivation_handles_underscores_and_hyphens() {
        assert_eq!(
            derive_title_from_stem(Path::new("O_helga_natt-Bas.pdf")),
            "O helga natt Bas"
        );
        assert_eq!(
            derive_title_from_stem(Path::new("Vårsång - TTBB.PDF")),
            "Vårsång - TTBB"
        );
        assert_eq!(
            derive_title_from_stem(Path::new("psalm_23_a-dur.pdf")),
            "psalm 23 a dur"
        );
    }

    #[test]
    fn scan_folders_and_sha256_reconciliation_preserve_annotations_and_metadata() {
        let tmp = TempTestDir::new("reconcile");
        let folder_a = tmp.path.join("MappA");
        let sub_a = folder_a.join("Jul");
        let folder_b = tmp.path.join("MappB");
        fs::create_dir_all(&sub_a).unwrap();
        fs::create_dir_all(&folder_b).unwrap();

        let original_pdf = sub_a.join("stilla_natt.PDF");
        let pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
        fs::write(&original_pdf, pdf_bytes).unwrap();
        fs::write(sub_a.join("notes.txt"), b"ignore me").unwrap();

        let db = Db::open_in_memory().unwrap();
        let f_a = db.add_folder(&folder_a.to_string_lossy()).unwrap();

        let scan1 = scan_folders(&db, Some(&f_a.id)).unwrap();
        assert_eq!(scan1.added, 1);
        assert_eq!(scan1.updated, 0);
        assert_eq!(scan1.missing, 0);
        assert_eq!(scan1.scores[0].title, "stilla natt");

        let score_id = scan1.scores[0].id.clone();

        // Add metadata, bookmark, and annotation to the score
        db.update_score_metadata(
            &score_id,
            ScoreMetadataPatch {
                favorite: Some(true),
                saved_bpm: Some(Some(72)),
                crop: Some(Some(CropSettings {
                    mode: CropMode::Auto,
                    manual_box: None,
                    auto_cache: None,
                })),
                ..Default::default()
            },
        )
        .unwrap();

        db.upsert_bookmark(UpsertBookmarkInput {
            id: None,
            score_id: score_id.clone(),
            page_num: 2,
            label: "Vers 2".into(),
        })
        .unwrap();

        let mut page = db.get_page_annotations(&score_id, 1).unwrap();
        page.items.push(AnnotationItem::Stamp(StampAnnotation {
            id: "st1".into(),
            layer_id: "default".into(),
            stamp_type: StampType::Breath,
            position: NormalizedPoint { x: 0.4, y: 0.25 },
            scale: 1.0,
            rotation: None,
            color: "#d64545".into(),
        }));
        db.save_page_annotations(page).unwrap();

        // Move and rename the PDF into another linked folder
        let moved_pdf = folder_b.join("Stilla_natt_Bas_ny.pdf");
        fs::rename(&original_pdf, &moved_pdf).unwrap();

        db.add_folder(&folder_b.to_string_lossy()).unwrap();
        let scan2 = scan_folders(&db, None).unwrap();

        // Should have reconciled by SHA-256 instead of adding a duplicate!
        assert_eq!(scan2.added, 0);
        assert_eq!(scan2.updated, 1);
        assert_eq!(scan2.missing, 0);
        assert_eq!(scan2.scores.len(), 1);
        assert_eq!(scan2.scores[0].id, score_id);
        assert_eq!(scan2.scores[0].filename, "Stilla_natt_Bas_ny.pdf");
        assert!(scan2.scores[0].favorite);
        assert_eq!(scan2.scores[0].saved_bpm, Some(72));
        assert_eq!(db.list_bookmarks(&score_id).unwrap().len(), 1);
        assert_eq!(db.get_page_annotations(&score_id, 1).unwrap().items.len(), 1);

        // Removing the file reports missing = 1 without deleting user data
        fs::remove_file(&moved_pdf).unwrap();
        let scan3 = scan_folders(&db, None).unwrap();
        assert_eq!(scan3.missing, 1);
        assert_eq!(scan3.scores.len(), 1);
    }

    #[test]
    fn import_pdf_files_adds_standalone_and_is_idempotent() {
        let tmp = TempTestDir::new("import");
        let pdf_path = tmp.path.join("Ave-Maria.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").unwrap();

        let db = Db::open_in_memory().unwrap();
        let paths = vec![pdf_path.to_string_lossy().to_string()];

        let imported1 = import_pdf_files(&db, &paths).unwrap();
        assert_eq!(imported1.len(), 1);
        assert_eq!(imported1[0].title, "Ave Maria");

        let imported2 = import_pdf_files(&db, &paths).unwrap();
        assert_eq!(imported2.len(), 1);
        assert_eq!(imported2[0].id, imported1[0].id);
        assert_eq!(db.list_scores(None).unwrap().len(), 1);
    }

    #[test]
    fn rejects_fake_pdf_without_magic_header() {
        let tmp = TempTestDir::new("fake_pdf");
        let fake_pdf = tmp.path.join("not_a_pdf.pdf");
        fs::write(&fake_pdf, b"<html><script>alert(1)</script></html>").unwrap();

        let db = Db::open_in_memory().unwrap();
        let folder = db.add_folder(&tmp.path.to_string_lossy()).unwrap();
        let scan = scan_folders(&db, Some(&folder.id)).unwrap();
        assert_eq!(scan.added, 0);
        assert!(scan.scores.is_empty());

        let import_err = read_import_candidates(&[fake_pdf.to_string_lossy().to_string()]).unwrap_err();
        assert!(import_err.contains("Invalid PDF"));
    }

    #[test]
    fn rejects_unc_and_device_paths() {
        assert!(validate_local_path(Path::new(r"\\server\share\score.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"\\?\UNC\server\share\score.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"\\.\NUL")).is_err());
        assert!(validate_local_path(Path::new(r"C:\Music\CON.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"C:\Music\LPT1.pdf")).is_err());
        assert!(validate_local_path(Path::new(r"C:\Music\AveMaria.pdf")).is_ok());
    }

    #[test]
    fn path_is_inside_handles_drive_roots_and_prefix_boundaries() {
        assert!(path_is_inside(r"C:\Scores\Choir\ave.pdf", r"C:\"));
        assert!(path_is_inside(r"C:\Scores\Choir\ave.pdf", r"C:\Scores"));
        assert!(!path_is_inside(r"C:\ScoresExtra\ave.pdf", r"C:\Scores"));
    }
}
