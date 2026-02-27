use crate::{Database, ThumbState};
use image::ImageEncoder;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tauri::Emitter;

/// RAII guard: clears the `running` flag when dropped so the next call can proceed.
struct RunningGuard(Arc<AtomicBool>);
impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

const THUMB_SIZE: u32 = 240;
/// Smaller batches → more frequent UI updates for large libraries.
const PROGRESS_BATCH: usize = 25;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThumbProgress {
    done: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
pub struct ThumbUpdate {
    #[serde(rename = "photoId")]
    pub photo_id: i64,
    #[serde(rename = "thumbPath")]
    pub thumb_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThumbBatchReady {
    updates: Vec<ThumbUpdate>,
    done: usize,
    total: usize,
}

fn thumb_path(thumb_dir: &std::path::Path, source_path: &str) -> std::path::PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(source_path.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let sub = &hash[..2];
    thumb_dir.join(sub).join(format!("{}.jpg", hash))
}

fn generate_one(source: &std::path::Path, dest: &std::path::Path) -> anyhow::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let img = image::open(source)?;
    let thumbnail = img.thumbnail(THUMB_SIZE, THUMB_SIZE);
    let rgb = thumbnail.into_rgb8();
    let file = std::fs::File::create(dest)?;
    let mut writer = std::io::BufWriter::new(file);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 75);
    encoder.write_image(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )?;
    Ok(())
}

#[tauri::command]
pub async fn generate_thumbnails(
    db: tauri::State<'_, Arc<Database>>,
    state: tauri::State<'_, ThumbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Prevent concurrent runs.
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let cancel = state.cancel.clone();
    cancel.store(false, Ordering::SeqCst);

    let db = db.inner().clone();
    let thumb_dir = state.thumb_dir.clone();
    let done_counter = state.done.clone();
    let total_counter = state.total.clone();
    let running = state.running.clone();

    tokio::task::spawn_blocking(move || {
        let _guard = RunningGuard(running);

        let pending = match db.get_pending_thumbs() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("get_pending_thumbs error: {e}");
                return;
            }
        };

        let total = pending.len();
        total_counter.store(total, Ordering::SeqCst);
        done_counter.store(0, Ordering::SeqCst);

        // Always emit an initial state so the UI knows a run started.
        let _ = app.emit("thumbnails-progress", ThumbProgress { done: 0, total });

        if total == 0 {
            return;
        }

        let shared_done = Arc::new(AtomicUsize::new(0));

        for chunk in pending.chunks(PROGRESS_BATCH) {
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let batch_results: Vec<(i64, String)> = chunk
                .par_iter()
                .filter_map(|(photo_id, photo_path)| {
                    if cancel.load(Ordering::SeqCst) {
                        return None;
                    }
                    let source = std::path::Path::new(photo_path);
                    let dest = thumb_path(&thumb_dir, photo_path);

                    let result = if dest.exists() {
                        Ok(())
                    } else {
                        generate_one(source, &dest)
                    };

                    match result {
                        Ok(()) => Some((*photo_id, dest.to_string_lossy().to_string())),
                        Err(e) => {
                            eprintln!("Thumbnail error {photo_path}: {e}");
                            None
                        }
                    }
                })
                .collect();

            if let Err(e) = db.update_thumb_batch(&batch_results) {
                eprintln!("DB update_thumb_batch error: {e}");
            }

            let batch_updates: Vec<ThumbUpdate> = batch_results
                .into_iter()
                .map(|(photo_id, thumb_path)| ThumbUpdate { photo_id, thumb_path })
                .collect();

            let done = shared_done.fetch_add(chunk.len(), Ordering::SeqCst) + chunk.len();
            done_counter.store(done, Ordering::SeqCst);

            if !batch_updates.is_empty() {
                let _ = app.emit(
                    "thumbnails-batch-ready",
                    ThumbBatchReady {
                        updates: batch_updates,
                        done,
                        total,
                    },
                );
            } else {
                let _ = app.emit("thumbnails-progress", ThumbProgress { done, total });
            }
        }

        // Always emit a final progress event so the frontend can clear the
        // "running" indicator even when the last batch had updates.
        let final_done = done_counter.load(Ordering::SeqCst);
        let _ = app.emit("thumbnails-progress", ThumbProgress { done: final_done, total });
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_thumbnails(state: tauri::State<'_, ThumbState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbProgressSnapshot {
    pub done: usize,
    pub total: usize,
    pub running: bool,
}

#[tauri::command]
pub fn get_thumb_progress(
    state: tauri::State<'_, ThumbState>,
) -> Result<ThumbProgressSnapshot, String> {
    Ok(ThumbProgressSnapshot {
        done: state.done.load(Ordering::SeqCst),
        total: state.total.load(Ordering::SeqCst),
        running: state.running.load(Ordering::SeqCst),
    })
}
