[Svenska](README.sv.md) | **English**

# Notläsare

**Notläsare** is a local-only, portrait-first choir and vocal PDF sheet music reader and annotator built for rehearsals and concerts. Built with **Tauri v2**, **React**, **TypeScript**, **PDF.js**, and **SQLite**.

> [!NOTE]
> **Windows Alpha Test Release (`v0.1.0-alpha.1`)**
> Notläsare is currently in early public testing on **Windows 10/11 (x64)**. Please report bugs or rehearsal feedback using the GitHub issue forms.

---

## Features

- **Library Management & Smart File Reconciliation**: Link local sheet music folders, import individual PDFs, filter by voice/tags/favorites, and automatically reconcile moved or renamed PDFs via **SHA-256** content hashing.
- **Choir & Vocal Annotations**:
  - Freehand **pen** and **highlighter**
  - **39 choir-specific stamps** (dynamics, breath marks, repeats, fermatas, cues, articulations, and more)
  - **Shapes** (lines, arrows, rectangles, ellipses) and **text notes**
  - Multiple **annotation layers** with visibility toggles and **undo/redo** history
- **Reader & Stage Ergonomics**:
  - **Auto-crop** whitespace detection and **manual crop** editor
  - **Half-page split mode** for seamless page turns during performance
  - Pinch/wheel zoom, pan, tap/swipe/keyboard page turns, and **wake lock** (keeps screen awake on Windows while reading)
- **Setlists & Bookmarks**: Organize concert/rehearsal setlists with drag-and-drop ordering and jump quickly to rehearsal marks/bookmarks.
- **Rehearsal Tools**:
  - **Concert-safe metronome** (starts visual-only by default, with optional audible click and tap tempo)
  - **Reference pitch piano** (adjustable `438–444 Hz` concert pitch, Swedish `H`/`B` or English `B`/`Bb` note naming)
- **Export & Backup**:
  - Export annotated scores directly to **PDF**
  - **JSON backup and restore** for library metadata, annotations, bookmarks, setlists, and settings
- **Bilingual UI**: Full **Swedish** and **English** interface.

---

## Windows Alpha Download & SmartScreen Notice

Pre-built Windows installers for `v0.1.0-alpha.1` are provided on the GitHub Releases page:
- `Notlasare_v0.1.0-alpha.1_x64-setup.exe` (NSIS installer)
- `Notlasare_v0.1.0-alpha.1_x64.msi` (MSI installer)
- `SHA256SUMS.txt` (SHA-256 checksums)

### Windows SmartScreen Warning (Unsigned Alpha Builds)

Alpha test builds are **not code-signed** with a commercial EV/OV certificate yet. When running the installer for the first time, Windows Defender SmartScreen may display *"Windows protected your PC"*:

1. Verify the downloaded installer's SHA-256 checksum against `SHA256SUMS.txt` (see below).
2. In the SmartScreen prompt, click **More info** and then **Run anyway**.

### Verifying `SHA256SUMS.txt` (PowerShell)

Download the installer and `SHA256SUMS.txt` into the same folder and run:

```powershell
Get-FileHash .\Notlasare_v0.1.0-alpha.1_x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Confirm that the resulting hash matches the corresponding entry in `SHA256SUMS.txt` (case-insensitive).

---

## Privacy & Security Model

Notläsare is designed to stay strictly local and private during rehearsals and performances:

- **100% Offline & Local**: Zero telemetry, zero analytics, zero external fonts/CDNs, and zero outbound network requests.
- **Hardened Rust Dialog IPC**:
  - No unrestricted Tauri `assetProtocol` (`**`) and no broad WebView filesystem scope.
  - Native OS file/folder dialogs are invoked directly from Rust IPC commands, and PDF reads/exports are bound to validated `.pdf` files with `%PDF-` header checks, UNC/device-path rejection, and strict size caps.
  - All annotations, setlists, bookmarks, and settings are stored locally in SQLite (`%LOCALAPPDATA%\Notlasare\notlasare.db`).

See [SECURITY.md](SECURITY.md) for more architectural details and vulnerability reporting instructions.

---

## Building from Source (Windows)

### Prerequisites

- **Node.js 22+** and `npm`
- **Rust** (stable toolchain with `clippy`)
- **Tauri v2 Windows prerequisites**: Microsoft Visual Studio C++ Build Tools (MSVC) and WebView2 Runtime (pre-installed on Windows 11 and most Windows 10 systems)

> [!TIP]
> **Windows Non-ASCII Path Workaround (`Notläsare`)**
> If your local clone directory path contains non-ASCII characters (such as `ä` in `Notläsare`), Windows MSVC/WiX/NSIS build scripts can fail when Cargo writes into `src-tauri/target`. Set `CARGO_TARGET_DIR` to an ASCII-only directory before running `cargo` or `tauri` commands:
> ```powershell
> $env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\Notlasare-cargo-target"
> ```
> (Or e.g. `C:\temp\notlasare-target`.)

### Commands

```powershell
# Install frontend dependencies
npm ci

# Run checks
npm run typecheck
npm test
npm run build

# Run Rust tests & linter (in src-tauri)
pushd src-tauri
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
popd

# Launch in development mode or build Windows installers
npx tauri dev
npx tauri build
```

---

## License

Licensed under the [MIT License](LICENSE).
