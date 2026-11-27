# Security Policy

## Supported Versions

During the alpha testing phase, security fixes apply to the latest `0.1.x` release:

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Local-Only Security Architecture

Notl-sare is an offline-first desktop application designed with minimal host exposure:

- **No network telemetry or remote calls**: The application makes no outbound HTTP, WebSocket, or analytics requests.
- **Minimal Tauri capability scope**: The WebView capability (`src-tauri/capabilities/default.json`) is restricted to `core:default`, with `assetProtocol` disabled and `tauri-plugin-fs` removed.
- **Dialog-gated Rust IPC**: Folder selection, PDF import, PDF export, and JSON backup import/export open native OS file dialogs inside Rust commands rather than trusting arbitrary filesystem paths from the frontend.
- **Input & file validation**:
  - PDF reads and exports enforce `.pdf` extension checks, `%PDF-` magic-byte verification, Windows UNC/device-path rejection, symlink-safe traversal limits, and size caps (`200 MB` for PDFs, `25 MB` for JSON backups).
  - JSON backup imports validate schema fields, color allowlists, numeric finiteness, and array/string bounds while rejecting prototype-pollution keys.
  - Local SQLite storage enables `PRAGMA secure_delete = ON` and parameterized queries throughout.
- **Strict CSP**: Content Security Policy disables `object-src`, `base-uri`, `frame-src`, `frame-ancestors`, and `form-action`, and keeps PDF.js eval disabled (`isEvalSupported: false`).

## Reporting a Vulnerability

Please **do not** report security vulnerabilities in public GitHub issues.

Instead, report vulnerabilities privately using one of the following methods:

1. **GitHub Security Advisories** *(preferred)*: Open a private draft advisory via the repository's **Security → Advisories → Report a vulnerability** page on GitHub.
2. **Direct Maintainer Contact**: If private advisories are not available on your fork/mirror, open a minimal issue asking the repository maintainer for a private contact channel without sharing exploit details publicly.

Please include:
- A clear description of the issue and affected component/file
- Reproduction steps or a minimal proof of concept
- Any potential impact (for example, malformed PDF handling, backup JSON parsing, or IPC path handling)

We aim to acknowledge reports within 72 hours and coordinate fixes prior to public disclosure.
