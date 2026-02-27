import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Photo {
  id: number;
  path: string;
  filename: string;
  year: number;
  dateTaken: string | null;
  sizeBytes: number | null;
  thumbPath: string | null;
  thumbReady: boolean;
  selected: boolean;
}

export interface YearSummary {
  year: number;
  total: number;
  selected: number;
}

export interface ExportResult {
  copied: number;
  skipped: number;
  errors: string[];
}

export interface ScanProgressPayload {
  scanned: number;
  total: number;
  phase: string;
}

export interface ThumbsBatchPayload {
  updates: { photoId: number; thumbPath: string }[];
  done: number;
  total: number;
}

export interface ThumbsProgressPayload {
  done: number;
  total: number;
}

export interface ExportProgressPayload {
  copied: number;
  total: number;
  currentFile: string;
}

export interface ThumbProgressSnapshot {
  done: number;
  total: number;
  running: boolean;
}

// ── API wrapper ───────────────────────────────────────────────────────────────

export const api = {
  scanFolder: (path: string) => invoke<void>("scan_folder", { path }),

  getYears: () => invoke<YearSummary[]>("get_years"),

  getPhotosByYear: (year: number) =>
    invoke<Photo[]>("get_photos_by_year", { year }),

  cancelScan: () => invoke<void>("cancel_scan"),

  scanFolderIncremental: (path: string) =>
    invoke<void>("scan_folder_incremental", { path }),

  getPendingThumbCount: () => invoke<number>("get_pending_thumb_count"),

  generateThumbnails: () => invoke<void>("generate_thumbnails"),

  getThumbProgress: () => invoke<ThumbProgressSnapshot>("get_thumb_progress"),

  toggleSelection: (photoId: number, selected: boolean) =>
    invoke<void>("toggle_selection", { photoId, selected }),

  batchSetSelection: (photoIds: number[], selected: boolean) =>
    invoke<void>("batch_set_selection", { photoIds, selected }),

  getSelectedIds: () => invoke<number[]>("get_selected_ids"),

  exportSelected: (destination: string, year: number) =>
    invoke<ExportResult>("export_selected", { destination, year }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),

  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  startWatching: (path: string) => invoke<void>("start_watching", { path }),

  stopWatching: () => invoke<void>("stop_watching"),

  cancelThumbnails: () => invoke<void>("cancel_thumbnails"),

  // ── Events ───────────────────────────────────────────────────────────────

  onScanProgress: (cb: (p: ScanProgressPayload) => void): Promise<UnlistenFn> =>
    listen<ScanProgressPayload>("scan-progress", (e) => cb(e.payload)),

  onThumbsBatchReady: (cb: (p: ThumbsBatchPayload) => void): Promise<UnlistenFn> =>
    listen<ThumbsBatchPayload>("thumbnails-batch-ready", (e) => cb(e.payload)),

  onThumbsProgress: (cb: (p: ThumbsProgressPayload) => void): Promise<UnlistenFn> =>
    listen<ThumbsProgressPayload>("thumbnails-progress", (e) => cb(e.payload)),

  onExportProgress: (
    cb: (p: ExportProgressPayload) => void
  ): Promise<UnlistenFn> =>
    listen<ExportProgressPayload>("export-progress", (e) => cb(e.payload)),

  onFolderChanged: (cb: () => void): Promise<UnlistenFn> =>
    listen("folder-changed", () => cb()),

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** Convert a native filesystem path to a Tauri asset:// URL for <img src>. */
  toAssetUrl: (path: string): string => convertFileSrc(path),

  /** Open a native folder picker; returns chosen path or null. */
  pickFolder: async (): Promise<string | null> => {
    const result = await dialogOpen({ directory: true, multiple: false });
    if (!result) return null;
    return typeof result === "string" ? result : null;
  },

  /** Open a native folder picker for export destination. */
  pickExportFolder: async (): Promise<string | null> => {
    const result = await dialogOpen({
      directory: true,
      multiple: false,
      title: "Choose export destination",
    });
    if (!result) return null;
    return typeof result === "string" ? result : null;
  },
};
