# Changelog

All notable changes to Notläsare will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - 2026-11-27

Initial public Windows alpha test release (`v0.1.0-alpha.1`).

### Added
- **Library & Folder Scanning**: Link local sheet music folders, import PDFs, filter by voice/tags/favorites, and reconcile moved/renamed files automatically via SHA-256 hashing.
- **Annotation System**: Pen, highlighter, 39 choir stamps, shapes (lines, arrows, rectangles, ellipses), text notes, multiple layers, and undo/redo history with keyboard shortcuts (`Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`, `Delete`).
- **Portrait Reader**: Auto-crop whitespace removal, manual crop editor, half-page split mode, zoom/pan gestures, bookmarks, setlists, and Windows wake lock support.
- **Rehearsal Tools**: Concert-safe visual-first metronome (`tap tempo`, optional audio click) and reference pitch piano (`438–444 Hz`, Swedish & English note naming).
- **Export & Backup**: Annotated PDF export (supporting rotated PDF pages) and JSON backup/restore.
- **Localization**: Full Swedish (`sv`) and English (`en`) UI translations.
- **Repository & CI**: MIT license, bilingual READMEs, security policy, GitHub issue forms, Dependabot, Windows CI workflow, and tag-triggered draft Windows prerelease workflow with `SHA256SUMS.txt`.

### Security
- Removed unrestricted `assetProtocol` (`**`) and `tauri-plugin-fs`; restricted Tauri capabilities to `core:default`.
- Replaced path-accepting IPC commands with Rust-driven native file/folder dialogs (`pick_and_add_library_folder`, `pick_and_import_pdf_files`, `export_pdf_with_dialog`, `export_backup_with_dialog`, `import_backup_with_dialog`) and `scoreId`-scoped `read_pdf_bytes`.
- Added Windows UNC/device-path rejection, `%PDF-` magic-byte checks, symlink-safe library scanning, atomic temp-file creation (`create_new(true)`), strict JSON backup schema/color validation, and privacy-preserving backups that omit absolute local `filePath` values by default.
- Enabled SQLite `PRAGMA secure_delete = ON` and removed CWD database fallback.
- Tightened CSP (`object-src 'none'`, `base-uri 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`).

### Fixed
- Prevented UI crashes on evicted PDF canvases (`RenderedCanvasMirror` `0×0` guard) and added localized React `ErrorBoundary` recovery.
- Fixed silent annotation overwrite race conditions on unloaded pages, swallowed save/export errors, and stale undo/bookmark/setlist state after backup restore.
- Fixed manual crop overlay positioning while zoomed and corner-handle clipping at page edges.
- Fixed annotation coordinate transforms on rotated PDF pages (`90°`/`180°`/`270°`) and explicit rejection of encrypted PDFs on export.
- Fixed pointer capture leaks, `StampPalette` `Escape` propagation, metronome sleep catch-up bursts, Web Audio node/timer leaks, and half-page split alignment across differing page crops.
