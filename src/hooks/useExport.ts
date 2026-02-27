import { useEffect, useRef } from "react";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

export function useExport() {
  const { setExportState } = useAppStore();
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .onExportProgress((p) => {
        if (!cancelled) {
          setExportState({ running: true, copied: p.copied, total: p.total });
        }
      })
      .then((fn) => {
        unlistenRef.current = fn;
      });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  async function runExport(): Promise<void> {
    const { activeYear } = useAppStore.getState();
    if (!activeYear) return;

    const dest = await api.pickExportFolder();
    if (!dest) return;

    setExportState({ running: true, copied: 0, total: 0, result: null });
    try {
      const result = await api.exportSelected(dest, activeYear);
      setExportState({ running: false, result });
      // Refresh year counts (selection unchanged, just informational)
    } catch (e) {
      console.error("export error", e);
      setExportState({
        running: false,
        result: { copied: 0, skipped: 0, errors: [String(e)] },
      });
    }
  }

  return { runExport };
}
