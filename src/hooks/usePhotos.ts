import { useCallback, useEffect } from "react";
import { api } from "../lib/tauri";
import { useAppStore } from "../store/appStore";

/**
 * Loads photos for the active year from the DB whenever `activeYear` changes.
 */
export function usePhotos() {
  const { activeYear, setPhotos, selectedIds } = useAppStore();

  const load = useCallback(async (year: number) => {
    try {
      const photos = await api.getPhotosByYear(year);
      // Merge persisted selection state (selectedIds is the source of truth)
      const merged = photos.map((p) => ({
        ...p,
        selected: selectedIds.has(p.id),
      }));
      useAppStore.getState().setPhotos(merged);
    } catch (e) {
      console.error("getPhotosByYear error", e);
    }
  }, [selectedIds]);

  useEffect(() => {
    if (activeYear !== null) {
      load(activeYear);
    }
  }, [activeYear]);

  return { reload: () => activeYear !== null && load(activeYear) };
}
