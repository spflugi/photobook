import { memo, useCallback } from "react";
import { Photo, api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

interface Props {
  photo: Photo;
  index: number;
  size: number; // cell size in px (same width & height)
}

export const PhotoCell = memo(function PhotoCell({ photo, index, size }: Props) {
  const {
    selectedIds,
    lastClickedIndex,
    setLastClickedIndex,
    optimisticToggle,
    optimisticBatch,
    photos,
    setYears,
    years,
  } = useAppStore();

  const isSelected = selectedIds.has(photo.id);
  const thumbSrc = photo.thumbPath ? api.toAssetUrl(photo.thumbPath) : null;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedIndex !== null && lastClickedIndex !== index) {
        // Range selection
        const from = Math.min(lastClickedIndex, index);
        const to = Math.max(lastClickedIndex, index);
        const rangePhotos = photos.slice(from, to + 1);
        const ids = rangePhotos.map((p) => p.id);
        // Use the selection state of the clicked item to decide add vs remove
        const addToSelection = !isSelected;
        optimisticBatch(ids, addToSelection);
        try {
          await api.batchSetSelection(ids, addToSelection);
          const refreshed = await api.getYears();
          useAppStore.getState().setYears(refreshed);
        } catch (err) {
          console.error(err);
        }
      } else {
        // Single toggle
        const nextSelected = !isSelected;
        optimisticToggle(photo.id, nextSelected);
        setLastClickedIndex(index);
        try {
          await api.toggleSelection(photo.id, nextSelected);
          // Update year counts
          const delta = nextSelected ? 1 : -1;
          useAppStore.getState().updateYearCounts(photo.year, delta);
        } catch (err) {
          console.error(err);
        }
      }
    },
    [photo, index, isSelected, lastClickedIndex, photos]
  );

  const imgPad = 4;
  const innerSize = size - imgPad * 2;

  return (
    <div
      onClick={handleClick}
      style={{
        width: "100%",
        height: size,
        padding: imgPad,
        position: "relative",
        cursor: "pointer",
        borderRadius: 4,
        transition: "transform 0.1s",
      }}
      title={photo.filename}
    >
      {/* Thumbnail image */}
      <div
        style={{
          width: "100%",
          height: innerSize,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--bg-3)",
          position: "relative",
          border: isSelected
            ? "2px solid var(--selected-border)"
            : "2px solid transparent",
          transition: "border-color 0.1s",
        }}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              transition: "opacity 0.2s",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          // Placeholder while thumb is generating
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" opacity="0.2">
              <rect
                x="2"
                y="4"
                width="16"
                height="12"
                rx="1.5"
                stroke="#888"
                strokeWidth="1.5"
              />
              <circle cx="10" cy="10" r="3" stroke="#888" strokeWidth="1.5" />
            </svg>
          </div>
        )}

        {/* Selection overlay */}
        {isSelected && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--selected-overlay)",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Selection checkmark badge */}
        {isSelected && (
          <div
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.95)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 5.5L4 7.5L8 3"
                stroke="#111"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        {/* Hover overlay (CSS via parent hover) */}
      </div>

      {/* Filename label (only when selected or on hover — handled via CSS class) */}
    </div>
  );
});
