# PhotoBook — CLAUDE.md

Desktop Windows app for selecting photos by year and exporting them for a photo book.

## Tech Stack

- **Tauri v2** — Rust backend + WebView2 frontend bridge
- **React 18** + **TypeScript** + **Vite 6**
- **Tailwind CSS v3** — monochromatic dark theme (zinc/slate palette)
- **TanStack Virtual v3** — virtual grid for 10,000+ images
- **Zustand v5** — frontend state management
- **rusqlite** (bundled) — SQLite for image index + selections
- **walkdir** — recursive folder scan
- **image** crate + **rayon** — parallel thumbnail generation
- **kamadak-exif** — EXIF date extraction

## Commands

### Development & builds (local)

Always use `build.ps1` — it finds Visual Studio automatically via `vswhere.exe`
and sets up the MSVC environment so the correct `link.exe` is in PATH (not Git's):

```powershell
.\build.ps1              # Tauri dev server with hot-reload (default)
.\build.ps1 -Mode debug  # Debug app + installer
.\build.ps1 -Mode release  # Optimised release app + NSIS installer
```

Direct `npm` commands only work if you are already inside an
**x64 Native Tools Command Prompt for VS** (or have run `vcvarsall.bat x64`):

```bash
npm run dev          # Vite dev server only (no Tauri)
npm run tauri dev    # Full app with hot-reload
npm run tauri build -- --debug
npm run tauri build
```

### Type checking (no MSVC needed)
```bash
npx tsc --noEmit                                       # TypeScript check
cargo check --manifest-path src-tauri/Cargo.toml       # Rust check
```

> **Important:** `dist/` must exist before `cargo check` runs (Tauri's
> `generate_context!` macro reads it). Run `npm run build` first, or create
> an empty `dist/` directory.

## Project Structure

```
src/                        # React frontend
  components/
    Layout.tsx              # Root layout: toolbar, sidebar, grid, bottom bar
    YearSidebar.tsx         # Year list with photo/selection counts
    PhotoGrid.tsx           # Virtual grid (TanStack Virtual) — perf-critical
    PhotoCell.tsx           # Single thumbnail: click-to-select, shift-click range
    SelectionBar.tsx        # Bottom bar: count, filter toggle, export
    ScanProgress.tsx        # Overlay during scan/thumbnail generation
    FolderPicker.tsx        # First-launch / folder selection screen
    TitleBar.tsx            # Custom frameless title bar
  hooks/
    useScanner.ts           # scan_folder command + progress events
    usePhotos.ts            # get_photos_by_year + thumbnail-ready events
    useExport.ts            # export_selected command + progress
  store/
    appStore.ts             # Zustand store (all app state)
  lib/
    tauri.ts                # Typed wrappers for all Tauri invoke() calls

src-tauri/src/              # Rust backend
  main.rs                   # Entry point
  lib.rs                    # Tauri setup, command registration, shared state
  db.rs                     # SQLite schema + all queries
  scan.rs                   # Recursive scan, EXIF extraction, DB upsert
  thumbnails.rs             # Parallel thumbnail generation (rayon)
  export.rs                 # Parallel file copy to destination
```

## Architecture

Rust backend owns all I/O, image processing, and SQLite. React owns rendering only — it never touches raw image bytes.

- **Thumbnails:** 240×240 JPEG q75, cached to `%APPDATA%\PhotoBook\thumbnails\`
- **Cache key:** SHA-256 of the absolute original path
- **DB:** `%APPDATA%\PhotoBook\db.sqlite`, WAL mode
- **Asset serving:** `asset://` protocol serves thumbnails to WebView2 with zero IPC overhead
- **Window:** Frameless (`decorations: false`) with custom drag region

## Key Tauri Commands

```typescript
invoke('scan_folder', { path })           // scan + index a folder
invoke('get_years')                        // year list with counts
invoke('get_photos_by_year', { year })     // photo list for a year
invoke('toggle_selection', { photoId, selected })
invoke('batch_set_selection', { ids, selected })
invoke('get_selected_ids')
invoke('generate_thumbnails')
invoke('get_thumb_progress')
invoke('export_selected', { destination })
invoke('get_setting', { key }) / invoke('set_setting', { key, value })
invoke('cancel_scan')
```

## Design System

Palette: monochromatic dark — zinc/slate family.

```
--bg-0 … --bg-4   near-black to dark-grey surfaces
--text-bright      #f0f0f0
--text-primary     #d0d0d0
--text-secondary   #888888
--text-muted       #555555
--border           #333333
--border-subtle    #222222
--selected-border  rgba(255,255,255,0.8)
--selected-overlay rgba(255,255,255,0.12)
```

CSS variables are defined in `src/index.css`. Use them — do not hardcode colours.

## Windows-Only Build Notes

- **MSVC linker conflict:** Git ships its own `link.exe` that can shadow the
  MSVC one in PATH, causing linker errors. `build.ps1` avoids this by running
  `vcvarsall.bat x64` first, which places the MSVC `link.exe` ahead of Git's.
  In CI, `ilammy/msvc-dev-cmd` does the same thing.
  `src-tauri/.cargo/config.toml` intentionally has **no hardcoded linker path**
  so the project is portable across machines and VS versions.
- **Rust toolchain:** 1.93.1+ required (edition2024 dependencies).
- **Platform:** Windows only — no cross-platform work needed.
