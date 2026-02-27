import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/appStore";
import { PhotoCell } from "./PhotoCell";
import { usePhotos } from "../hooks/usePhotos";
import { api } from "../lib/tauri";

const GAP = 2; // px gap between cells

export function PhotoGrid() {
  const { photos, activeYear, selectedIds, setLastClickedIndex, showSelectedOnly, cellSize } = useAppStore();
  const { reload } = usePhotos();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Track container width for responsive column count
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+A — select all in current view
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        const ids = photos.map((p) => p.id);
        if (ids.length === 0) return;
        useAppStore.getState().optimisticBatch(ids, true);
        api.batchSetSelection(ids, true).then(() => {
          api.getYears().then((ys) => useAppStore.getState().setYears(ys));
        });
      }
      // Escape — deselect all
      if (e.key === "Escape") {
        const ids = [...useAppStore.getState().selectedIds];
        if (ids.length === 0) return;
        useAppStore.getState().optimisticBatch(ids, false);
        useAppStore.getState().setShowSelectedOnly(false);
        api.batchSetSelection(ids, false).then(() => {
          api.getYears().then((ys) => useAppStore.getState().setYears(ys));
        });
        setLastClickedIndex(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos]);

  // Each entry carries original index so shift-click range selection stays correct
  const displayEntries = useMemo(() => {
    const entries = photos.map((p, i) => ({ photo: p, index: i }));
    return showSelectedOnly ? entries.filter(({ photo }) => selectedIds.has(photo.id)) : entries;
  }, [photos, selectedIds, showSelectedOnly]);

  // Compute column count from user's preferred minimum cell size.
  // Row height is what each cell would be if they filled the full row width exactly.
  const colCount = Math.max(1, Math.floor((containerWidth + GAP) / (cellSize + GAP)));
  const rowHeight = Math.max(1, Math.floor((containerWidth - (colCount - 1) * GAP) / colCount));
  const rowCount = Math.ceil(displayEntries.length / colCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight + GAP,
    overscan: 4,
  });

  if (activeYear === null) {
    return (
      <EmptyState message="Select a year from the sidebar to view your photos." />
    );
  }

  if (photos.length === 0) {
    return <EmptyState message={`No photos found for ${activeYear}.`} />;
  }

  if (showSelectedOnly && displayEntries.length === 0) {
    return <EmptyState message={`No selected photos in ${activeYear}.`} />;
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
        padding: `${GAP}px`,
        contain: "strict",
      }}
    >
      {/* Total height spacer */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const startIdx = row.index * colCount;
          const rowEntries = displayEntries.slice(startIdx, startIdx + colCount);

          return (
            <div
              key={row.key}
              style={{
                position: "absolute",
                top: row.start,
                left: 0,
                width: "100%",
                height: rowHeight,
                display: "grid",
                gridTemplateColumns: `repeat(${colCount}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowEntries.map(({ photo, index }) => (
                <PhotoCell
                  key={photo.id}
                  photo={photo}
                  index={index}
                  size={rowHeight}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
