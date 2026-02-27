import { create } from "zustand";
import { Photo, YearSummary } from "../lib/tauri";

// ── Persistence helpers ───────────────────────────────────────────────────────

const CELL_SIZE_KEY = "photobook:cellSize";

function loadCellSize(): number {
  const stored = parseInt(localStorage.getItem(CELL_SIZE_KEY) ?? "", 10);
  return Number.isFinite(stored) && stored >= 80 && stored <= 280 ? stored : 120;
}

// ── State shape ───────────────────────────────────────────────────────────────

interface ScanState {
  phase: "idle" | "scanning" | "complete";
  /** "full" shows the blocking overlay; "incremental" shows the inline status */
  scanType: "full" | "incremental";
  scanned: number;
  total: number;
  message: string;
}

interface ThumbState {
  done: number;
  total: number;
  running: boolean;
}

interface ExportState {
  running: boolean;
  copied: number;
  total: number;
  result: { copied: number; skipped: number; errors: string[] } | null;
}

interface AppStore {
  // ── Folder & lifecycle ────────────────────────────────────────────────────
  sourceFolder: string | null;
  setSourceFolder: (folder: string) => void;

  // ── Year index ────────────────────────────────────────────────────────────
  years: YearSummary[];
  setYears: (years: YearSummary[]) => void;
  updateYearCounts: (year: number, delta: number) => void;

  activeYear: number | null;
  setActiveYear: (year: number | null) => void;

  // ── Photos for the active year ────────────────────────────────────────────
  photos: Photo[];
  setPhotos: (photos: Photo[]) => void;
  applyThumbUpdates: (updates: { photoId: number; thumbPath: string }[]) => void;

  // ── Selection ─────────────────────────────────────────────────────────────
  selectedIds: Set<number>;
  setSelectedIds: (ids: number[]) => void;
  optimisticToggle: (photoId: number, selected: boolean) => void;
  optimisticBatch: (photoIds: number[], selected: boolean) => void;
  lastClickedIndex: number | null;
  setLastClickedIndex: (i: number | null) => void;
  showSelectedOnly: boolean;
  setShowSelectedOnly: (v: boolean) => void;

  // ── Scan progress ─────────────────────────────────────────────────────────
  scan: ScanState;
  setScan: (s: Partial<ScanState>) => void;

  // ── Thumbnail progress ────────────────────────────────────────────────────
  thumbProgress: ThumbState;
  setThumbProgress: (s: Partial<ThumbState>) => void;

  // ── Export ────────────────────────────────────────────────────────────────
  exportState: ExportState;
  setExportState: (s: Partial<ExportState>) => void;

  // ── Watcher ───────────────────────────────────────────────────────────────
  watcherActive: boolean;
  setWatcherActive: (active: boolean) => void;

  // ── Grid cell size (user zoom) ────────────────────────────────────────────
  cellSize: number;
  setCellSize: (n: number) => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set) => ({
  sourceFolder: null,
  setSourceFolder: (folder) => set({ sourceFolder: folder }),

  years: [],
  setYears: (years) => set({ years }),
  updateYearCounts: (year, delta) =>
    set((s) => ({
      years: s.years.map((y) =>
        y.year === year ? { ...y, selected: y.selected + delta } : y
      ),
    })),

  activeYear: null,
  setActiveYear: (year) =>
    set({ activeYear: year, photos: [], lastClickedIndex: null }),

  photos: [],
  setPhotos: (photos) => set({ photos }),
  applyThumbUpdates: (updates) => {
    if (updates.length === 0) return;
    const map = new Map(updates.map((u) => [u.photoId, u.thumbPath]));
    set((s) => ({
      photos: s.photos.map((p) => {
        const tp = map.get(p.id);
        return tp ? { ...p, thumbPath: tp, thumbReady: true } : p;
      }),
    }));
  },

  selectedIds: new Set(),
  setSelectedIds: (ids) => set({ selectedIds: new Set(ids) }),
  optimisticToggle: (photoId, selected) => {
    set((s) => {
      const next = new Set(s.selectedIds);
      if (selected) next.add(photoId);
      else next.delete(photoId);
      const photosUpdated = s.photos.map((p) =>
        p.id === photoId ? { ...p, selected } : p
      );
      return { selectedIds: next, photos: photosUpdated };
    });
  },
  optimisticBatch: (photoIds, selected) => {
    set((s) => {
      const next = new Set(s.selectedIds);
      photoIds.forEach((id) => {
        if (selected) next.add(id);
        else next.delete(id);
      });
      const idSet = new Set(photoIds);
      const photosUpdated = s.photos.map((p) =>
        idSet.has(p.id) ? { ...p, selected } : p
      );
      return { selectedIds: next, photos: photosUpdated };
    });
  },

  lastClickedIndex: null,
  setLastClickedIndex: (i) => set({ lastClickedIndex: i }),

  showSelectedOnly: false,
  setShowSelectedOnly: (v) => set({ showSelectedOnly: v }),

  scan: { phase: "idle", scanType: "full", scanned: 0, total: 0, message: "" },
  setScan: (s) => set((prev) => ({ scan: { ...prev.scan, ...s } })),

  thumbProgress: { done: 0, total: 0, running: false },
  setThumbProgress: (s) =>
    set((prev) => ({ thumbProgress: { ...prev.thumbProgress, ...s } })),

  exportState: { running: false, copied: 0, total: 0, result: null },
  setExportState: (s) =>
    set((prev) => ({ exportState: { ...prev.exportState, ...s } })),

  watcherActive: false,
  setWatcherActive: (active) => set({ watcherActive: active }),

  cellSize: loadCellSize(),
  setCellSize: (n) => {
    localStorage.setItem(CELL_SIZE_KEY, String(n));
    set({ cellSize: n });
  },
}));
