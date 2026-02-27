import { useEffect, useRef } from "react";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

/**
 * Wires up all background event listeners (scan progress, thumbnail progress,
 * folder watcher) and exposes imperative scan actions.
 *
 * Call once from the root Layout component.
 */
export function useScanner() {
  const { setScan, setYears, setThumbProgress, setWatcherActive } = useAppStore();
  const unlistenRefs = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      // ── Scan progress ────────────────────────────────────────────────────
      let thumbsStarted = false;

      const unScan = await api.onScanProgress((p) => {
        if (cancelled) return;

        const isDone = p.phase === "Complete";
        // setScan merges with existing state, so scanType (set before the scan
        // command was invoked) is automatically preserved through updates.
        setScan({
          phase: isDone ? "complete" : "scanning",
          scanned: p.scanned,
          total: p.total,
          message: p.phase,
        });

        if (isDone) {
          api.getYears().then((years) => {
            if (!cancelled) setYears(years);
          });
          api.generateThumbnails().catch(console.error);

          // Re-arm the watcher flag after any scan finishes.
          const { sourceFolder } = useAppStore.getState();
          if (sourceFolder && !cancelled) {
            api.startWatching(sourceFolder)
              .then(() => { if (!cancelled) setWatcherActive(true); })
              .catch(console.error);
          }
        } else if (!thumbsStarted && p.phase === "Indexing images…") {
          // Kick off thumbnail generation as soon as the first batch is indexed.
          thumbsStarted = true;
          api.generateThumbnails().catch(console.error);
        }

        // Reset thumbsStarted after scan cycle ends so next full scan works.
        if (isDone) thumbsStarted = false;
      });

      // ── Thumbnail batch ready ────────────────────────────────────────────
      const unThumbBatch = await api.onThumbsBatchReady((p) => {
        if (cancelled) return;
        setThumbProgress({ done: p.done, total: p.total, running: true });
        useAppStore.getState().applyThumbUpdates(p.updates);
      });

      // ── Thumbnail progress (includes the final completion event) ─────────
      const unThumbProgress = await api.onThumbsProgress((p) => {
        if (cancelled) return;
        const done = p.done >= p.total;
        setThumbProgress({ done: p.done, total: p.total, running: !done });
      });

      // ── Folder watcher events ────────────────────────────────────────────
      const unFolderChanged = await api.onFolderChanged(() => {
        if (cancelled) return;
        const { scan, sourceFolder } = useAppStore.getState();
        // Don't stack scans — if one is already running, skip.
        if (scan.phase === "scanning" || !sourceFolder) return;

        setScan({
          phase: "scanning",
          scanType: "incremental",
          scanned: 0,
          total: 0,
          message: "Detected folder changes…",
        });
        api.scanFolderIncremental(sourceFolder).catch((e) => {
          console.error("watcher-triggered scan error:", e);
          setScan({ phase: "idle", message: "" });
        });
      });

      unlistenRefs.current = [unScan, unThumbBatch, unThumbProgress, unFolderChanged];

      // ── Startup: resume thumbnail generation if any are pending ──────────
      const pending = await api.getPendingThumbCount();
      if (pending > 0 && !cancelled) {
        api.generateThumbnails().catch(console.error);
      }

      // ── Startup: incremental scan to catch changes since last run ────────
      const { sourceFolder } = useAppStore.getState();
      if (sourceFolder && !cancelled) {
        setScan({
          phase: "scanning",
          scanType: "incremental",
          scanned: 0,
          total: 0,
          message: "Checking for new photos…",
        });
        api.scanFolderIncremental(sourceFolder).catch((e) => {
          console.error("auto incremental scan error:", e);
          setScan({ phase: "idle", message: "" });
        });

        // Start the folder watcher regardless of whether the scan succeeded.
        api.startWatching(sourceFolder)
          .then(() => { if (!cancelled) setWatcherActive(true); })
          .catch(console.error);
      }
    }

    setup().catch(console.error);

    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((fn) => fn());
      api.stopWatching().catch(console.error);
    };
  }, []);

  // ── Imperative actions ──────────────────────────────────────────────────────

  async function startScan(folder: string): Promise<void> {
    // Stop watcher during full scan; it restarts when scan finishes.
    setWatcherActive(false);
    api.stopWatching().catch(console.error);

    useAppStore.getState().setScan({
      phase: "scanning",
      scanType: "full",
      scanned: 0,
      total: 0,
      message: "Starting…",
    });
    try {
      await api.scanFolder(folder);
    } catch (e) {
      console.error("scan error:", e);
      useAppStore.getState().setScan({ phase: "idle", message: "" });
    }
  }

  async function startIncrementalScan(folder: string): Promise<void> {
    useAppStore.getState().setScan({
      phase: "scanning",
      scanType: "incremental",
      scanned: 0,
      total: 0,
      message: "Checking for new photos…",
    });
    try {
      await api.scanFolderIncremental(folder);
    } catch (e) {
      console.error("incremental scan error:", e);
      useAppStore.getState().setScan({ phase: "idle", message: "" });
    }
  }

  return { startScan, startIncrementalScan };
}
