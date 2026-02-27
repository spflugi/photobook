# PhotoBook — Implementation Plan

## Tech Stack Decision

### Chosen: Tauri v2 (Rust backend) + React 18 + TypeScript

**Why Tauri v2:**

| Criterion | Tauri v2 | WPF/.NET 8 | Electron |
|---|---|---|---|
| Thumbnail throughput | Excellent (Rust + Rayon) | Good | Moderate |
| UI design freedom | Excellent (full CSS) | Moderate (XAML) | Excellent |
| Memory footprint | ~60-100 MB | ~120-200 MB | ~400-600 MB |
| Virtual grid (10k+ images) | Excellent (TanStack Virtual) | Moderate | Excellent |
| Windows production readiness | Very High | Very High | High |
| Installer size | ~5-10 MB | ~60-150 MB | ~100-150 MB |

**Key insight:** Tauri separates concerns perfectly — Rust owns all performance-critical work (I/O, decoding, thumbnail generation, SQLite), React owns all rendering. The frontend never touches raw image bytes; it only receives paths to pre-generated thumbnails.

**Eliminated options:**
- **Electron** — ~400-600 MB memory for an image app is unacceptable.
- **WPF** — Achieving a truly modern, minimalist design is fighting the framework; also in maintenance mode.
- **Qt (C++)** — Highest dev complexity, weakest ecosystem for rapid UI iteration.
- **Flutter** — Windows desktop maturity insufficient for production use in 2026.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend (WebView2)                                      │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  YearSidebar │  │  PhotoGrid     │  │  SelectionBar     │  │
│  │  (nav by yr) │  │  (TanStack     │  │  (count, export)  │  │
│  └──────────────┘  │   Virtual)     │  └───────────────────┘  │
│                    └────────────────┘                          │
│  Zustand store ◄──────────────────────────────────────────     │
│  Tauri invoke() / event listeners                              │
└────────────────────────┬────────────────────────────────────────┘
                         │ Typed IPC (JSON)
┌────────────────────────▼────────────────────────────────────────┐
│  Rust Backend (Tauri commands + async Tokio)                    │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  scan.rs     │  │  thumbnails.rs │  │  database.rs      │  │
│  │  walkdir     │  │  rayon +       │  │  rusqlite         │  │
│  │  recursive   │  │  image crate   │  │  SQLite index     │  │
│  │  scan        │  │  SIMD resize   │  │  + selections     │  │
│  └──────────────┘  └────────────────┘  └───────────────────┘  │
│  ┌──────────────┐                                              │
│  │  export.rs   │                                              │
│  │  parallel    │                                              │
│  │  fs::copy    │                                              │
│  └──────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  Filesystem                                                     │
│  %APPDATA%\PhotoBook\db.sqlite    — index + selections          │
│  %APPDATA%\PhotoBook\thumbnails\  — cached 240×240 JPEG files   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
photobook/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs                 # Tauri setup, command registration
│       ├── lib.rs                  # App state, shared types
│       ├── db.rs                   # SQLite schema + all queries
│       ├── scan.rs                 # Recursive folder scan + indexing
│       ├── thumbnails.rs           # Parallel thumbnail generation
│       └── export.rs               # Parallel file copy to destination
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                   # Tailwind base + monochromatic theme vars
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── YearSidebar.tsx         # Year list, image count per year
│   │   ├── PhotoGrid.tsx           # Virtual grid — core performance component
│   │   ├── PhotoCell.tsx           # Single thumbnail cell + selection overlay
│   │   ├── ScanProgress.tsx        # Progress bar during initial scan
│   │   ├── SelectionBar.tsx        # Bottom bar: count + export button
│   │   └── FolderPicker.tsx        # Welcome/settings screen
│   ├── hooks/
│   │   ├── useScanner.ts           # Tauri scan command + progress events
│   │   ├── usePhotos.ts            # Load photos by year from backend
│   │   └── useExport.ts            # Export command + progress
│   ├── store/
│   │   └── appStore.ts             # Zustand: current year, photos, selections
│   └── lib/
│       └── tauri.ts                # Typed wrappers for all Tauri invoke() calls
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Database Schema (SQLite)

```sql
-- Stores every discovered image
CREATE TABLE photos (
    id          INTEGER PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,       -- absolute original path
    filename    TEXT NOT NULL,
    year        INTEGER NOT NULL,
    date_taken  TEXT,                       -- ISO-8601 from EXIF or mtime
    size_bytes  INTEGER,
    width       INTEGER,
    height      INTEGER,
    thumb_path  TEXT,                       -- absolute path to cached thumbnail
    thumb_ready INTEGER NOT NULL DEFAULT 0, -- 0=pending, 1=done
    indexed_at  TEXT NOT NULL               -- ISO-8601 scan timestamp
);

-- Stores user's selections per session/album
CREATE TABLE selections (
    photo_id    INTEGER NOT NULL REFERENCES photos(id),
    PRIMARY KEY (photo_id)
);

-- App settings (source folder, last used year, etc.)
CREATE TABLE settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Indices for fast year-filtered queries
CREATE INDEX idx_photos_year ON photos(year);
CREATE INDEX idx_photos_thumb_ready ON photos(thumb_ready);
```

---

## Rust Backend — Module Design

### `db.rs`
- `Database` struct wrapping a `rusqlite::Connection` (with WAL mode enabled)
- Functions: `init_schema()`, `upsert_photo()`, `get_years()`, `get_photos_by_year()`, `get_selected_ids()`, `set_selection()`, `get_setting()`, `set_setting()`
- WAL journal mode for concurrent reads during thumbnail generation

### `scan.rs`
- Tauri command: `scan_folder(path: String)` — async, emits `scan-progress` events
- Uses `walkdir` for recursive traversal, filters by extension (`.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`, case-insensitive)
- Reads EXIF `DateTimeOriginal` via the `kamadak-exif` crate; falls back to file modified time
- Batches DB upserts (1000 rows per transaction) for performance
- After scan completes, triggers background thumbnail generation
- Emits Tauri event `scan-progress { scanned, total, phase }` to frontend

### `thumbnails.rs`
- Tauri command: `generate_thumbnails(year: Option<i32>)` — queues work
- Background task: `Rayon` thread pool processes photos with `thumb_ready = 0`
- Per image: decode with `image` crate → resize to 240×240 (fit, not fill) with `fast_image_resize` crate (SIMD) → encode as JPEG quality 75 → write to cache dir
- Cache dir: `%APPDATA%\PhotoBook\thumbnails\{first2_of_hash}\{sha256_of_path}.jpg`
- On completion, emits `thumbnail-ready { photo_id, thumb_path }` event
- Emits batch progress events every 50 thumbnails: `thumbnails-progress { done, total }`

### `scan.rs` + `thumbnails.rs` flow
```
1. scan_folder() → walkdir → upsert all paths to DB (fast, metadata only)
2. Emit scan-complete event → frontend shows photos immediately (placeholders for missing thumbs)
3. generate_thumbnails() starts in background
4. Emit thumbnail-ready events as each completes → frontend swaps placeholder → real thumbnail
```

### `export.rs`
- Tauri command: `export_selected(destination: String)`
- Reads all selected photo IDs from DB → fetches original paths
- Parallel copy with `rayon::par_iter()`: `std::fs::copy(src, dest/{filename})`
- Handles filename conflicts by appending `_{n}` suffix
- Emits `export-progress { copied, total }` events
- Returns `ExportResult { copied, skipped, errors }`

---

## Frontend — Component Design

### PhotoGrid (critical performance component)
- Uses `@tanstack/react-virtual` `useVirtualizer` in grid mode
- Renders only the ~60-100 cells currently visible in the viewport
- Cell size: 200×200px (thumbnail 240px, padding, selection border)
- Column count adapts to window width (responsive grid)
- Each cell renders: `<img src="asset:///{thumb_path}">` (Tauri asset protocol — zero overhead local file serving)
- Click toggles selection; Shift+Click for range selection
- Selected cells show: monochromatic overlay + checkmark icon

### YearSidebar
- Lists all years with photo count from DB, newest year first
- Sticky highlighting of active year
- Shows selection count per year alongside total count
- Width: 120px, collapsible

### ScanProgress
- Shown during initial scan: animated progress bar, phase label ("Scanning files…" → "Building index…" → "Generating previews…")
- Dismisses automatically when all thumbnails ready (or user can proceed early)

### SelectionBar (bottom bar)
- Always visible when any photos are selected
- Shows: "N photos selected across Y years"
- "Export selection" button → opens native folder picker → triggers export command
- Shows export progress inline

### FolderPicker (welcome screen)
- Shown on first launch or when no folder is configured
- "Open Folder" button → `dialog.open()` from `@tauri-apps/plugin-dialog`
- Remembers last folder in DB settings

---

## IPC Contract (Tauri Commands + Events)

### Commands (frontend → Rust)
```typescript
invoke('scan_folder', { path: string }) → Promise<void>
invoke('get_years') → Promise<{ year: number; total: number; selected: number }[]>
invoke('get_photos_by_year', { year: number }) → Promise<Photo[]>
invoke('toggle_selection', { photoId: number; selected: boolean }) → Promise<void>
invoke('get_selected_ids') → Promise<number[]>
invoke('export_selected', { destination: string }) → Promise<ExportResult>
invoke('get_setting', { key: string }) → Promise<string | null>
invoke('set_setting', { key: string; value: string }) → Promise<void>
invoke('cancel_scan') → Promise<void>
```

### Events (Rust → frontend)
```typescript
listen('scan-progress', (e: { scanned: number; total: number; phase: string }) => …)
listen('thumbnails-progress', (e: { done: number; total: number }) => …)
listen('thumbnail-ready', (e: { photoId: number; thumbPath: string }) => …)
listen('export-progress', (e: { copied: number; total: number }) => …)
```

### TypeScript types
```typescript
interface Photo {
  id: number;
  path: string;
  filename: string;
  year: number;
  dateTaken: string | null;
  thumbPath: string | null;
  thumbReady: boolean;
  selected: boolean;
}

interface ExportResult {
  copied: number;
  skipped: number;
  errors: string[];
}
```

---

## Design System

**Palette:** Pure monochromatic — single neutral base (zinc/slate family).

```
Background:       #0f0f0f (near-black)
Surface:          #1a1a1a (card/panel backgrounds)
Border:           #2a2a2a (subtle dividers)
Text primary:     #f0f0f0
Text secondary:   #888888
Accent:           #ffffff (selection checkmarks, active states)
Selected overlay: rgba(255,255,255,0.15) with white border
```

**Typography:** System UI stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)

**Spacing:** 4px base unit, 8/12/16/24/32px multiples

**Thumbnail grid:**
- 200×200px cells
- 8px gap
- Rounded corners: 4px
- Hover: slight brightness lift (`brightness(1.08)`)
- Selected: white 2px border + top-right checkmark badge

**Window:** Frameless with custom title bar, 1200×800 default, min 900×600. Tauri's `decorations: false` + custom drag region.

---

## Rust Dependencies (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.32", features = ["bundled"] }
walkdir = "2"
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "tiff"] }
fast_image_resize = "4"
rayon = "1"
kamadak-exif = "0.5"
sha2 = "0.10"
hex = "0.4"
anyhow = "1"
chrono = { version = "0.4", features = ["serde"] }

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
```

---

## Frontend Dependencies (`package.json`)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tanstack/react-virtual": "^3",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^5"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^4",
    "tailwindcss": "^3",
    "autoprefixer": "^10",
    "postcss": "^10",
    "typescript": "^5",
    "vite": "^6"
  }
}
```

---

## Performance Strategy

### Problem: 10,000+ images per year
1. **Database-first rendering:** Frontend never reads the filesystem directly. All photo metadata comes from SQLite queries (< 10ms for 50k rows with indices).
2. **Thumbnail pre-generation:** Thumbnails generated once, cached forever. Re-scan skips existing cache entries (path hash lookup).
3. **Virtual grid:** TanStack Virtual renders only ~60-100 DOM nodes regardless of total count. Scroll through 50,000 images at 60fps.
4. **Progressive loading:** Scan completes fast (metadata only). Thumbnails fill in asynchronously — users can start selecting while thumbnails are still generating.
5. **Rayon parallelism:** Thumbnail generation uses all CPU cores. 10,000 thumbnails on a modern 8-core CPU: ~15-30 seconds first run.
6. **SQLite WAL mode:** Background thumbnail writes don't block UI reads.
7. **Asset protocol:** Tauri's `asset://` protocol serves local thumbnail files directly through WebView2 — no base64 encoding, no IPC overhead.

---

## Implementation Phases

### Phase 1 — Scaffold & Foundation
- [ ] `cargo create-tauri-app` with React + TypeScript + Vite template
- [ ] Configure `tauri.conf.json`: window settings, asset protocol, file system permissions
- [ ] Set up Tailwind with monochromatic theme config
- [ ] Implement `db.rs`: schema, init, basic CRUD
- [ ] Wire up basic Tauri command → frontend invoke test
- [ ] Custom frameless window with drag region

### Phase 2 — Scan & Index
- [ ] Implement `scan.rs`: walkdir scan, EXIF date extraction, DB upsert
- [ ] Progress events → `ScanProgress` component
- [ ] `get_years` command → `YearSidebar` with counts
- [ ] `get_photos_by_year` command returns photo list (thumbs not yet generated)

### Phase 3 — Thumbnail Pipeline
- [ ] Implement `thumbnails.rs`: Rayon parallel generation, cache-on-disk, `thumbnail-ready` events
- [ ] Frontend: placeholder → real thumbnail swap when `thumbnail-ready` fires
- [ ] Background thumbnail generation starts automatically after scan

### Phase 4 — Photo Grid & Selection
- [ ] `PhotoGrid` with TanStack Virtual grid layout
- [ ] `PhotoCell`: thumbnail display, selection overlay, checkmark
- [ ] Click to select, Shift+Click range select
- [ ] `toggle_selection` command → DB write
- [ ] `SelectionBar`: count display, persistent across year navigation
- [ ] Selection state loaded from DB on startup

### Phase 5 — Export
- [ ] `export.rs`: parallel copy with conflict resolution
- [ ] Export progress UI in `SelectionBar`
- [ ] Native folder picker via `@tauri-apps/plugin-dialog`
- [ ] Success/error summary toast

### Phase 6 — Polish & Production
- [ ] Keyboard shortcuts: Space (select), Arrow keys (navigate), Ctrl+A (select all), Escape (deselect all)
- [ ] Right-click context menu: "Open in Explorer", "Deselect"
- [ ] Settings: thumbnail size option (160/200/240px), re-scan button
- [ ] Error handling: missing files, corrupt images, permission errors
- [ ] App icon design (monochromatic)
- [ ] NSIS installer via `tauri build`
- [ ] Code signing configuration

---

## Key Technical Decisions & Trade-offs

| Decision | Choice | Rationale |
|---|---|---|
| Thumbnail format | JPEG quality 75 | 3-5× smaller than PNG, imperceptible quality loss at 240px |
| Thumbnail size | 240×240px | Sharp at 200px display, 2× for high-DPI, good memory/quality balance |
| Thumbnail naming | SHA-256 of absolute path | Stable across renames, easy cache invalidation |
| DB location | `%APPDATA%\PhotoBook\` | Survives app reinstall, no UAC issues |
| EXIF library | `kamadak-exif` | Pure Rust, no C deps, handles malformed EXIF gracefully |
| State management | Zustand (not Redux) | Minimal boilerplate, sufficient for this app's complexity |
| Virtual grid | TanStack Virtual | Battle-tested, grid mode support, TypeScript-first |
| Selection storage | SQLite table | Persists across restarts, trivial to query counts per year |
| Window style | Frameless | Enables fully custom chrome matching monochromatic design |

---

## What is NOT in Scope (v1)

- Image editing or rotation
- Face detection or AI tagging
- Cloud sync
- Multiple albums/projects simultaneously
- HEIC/HEIF support (can be added later via a Windows codec dependency)
- RAW format support
- Video files
- macOS/Linux builds
