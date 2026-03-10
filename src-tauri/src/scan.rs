use crate::{Database, ScanCancelFlag};
use crate::db::PhotoRecord;
use chrono::Datelike;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{atomic::Ordering, Arc, OnceLock};
use tauri::Emitter;
use walkdir::WalkDir;

pub const SUPPORTED_EXT: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp"];

/// Records per SQLite transaction during bulk import.
const DB_BATCH: usize = 500;
/// Emit a progress event at least every N records.
const PROGRESS_EVERY: usize = 50;
/// Max bytes to read from a file when searching for EXIF data.
/// JPEG APP1/EXIF is always within the first few KB; this cap prevents reading
/// entire multi-MB photos when EXIF is absent or unusually placed.
const EXIF_READ_CAP: u64 = 512 * 1024;

// ── I/O-tuned rayon thread pool ───────────────────────────────────────────────
// EXIF extraction is I/O-bound: using more threads than CPU cores keeps the
// drive's command queue saturated on SSDs/NVMe and overlaps I/O wait time.
static SCAN_POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

fn scan_pool() -> &'static rayon::ThreadPool {
    SCAN_POOL.get_or_init(|| {
        let ncpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        rayon::ThreadPoolBuilder::new()
            .num_threads((ncpus * 4).min(32))
            .build()
            .unwrap()
    })
}

// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    scanned: usize,
    total: usize,
    phase: String,
}

pub fn is_image(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Returns (ISO date string, year, last_modified_ms).
///
/// `known_mtime_ms`: mtime already obtained from WalkDir metadata; pass 0 to
/// read it fresh.  Reusing the already-known value avoids a redundant stat().
fn extract_date(path: &Path, known_mtime_ms: i64) -> (Option<String>, i32, Option<i64>) {
    let mtime_ms: Option<i64> = if known_mtime_ms > 0 {
        Some(known_mtime_ms)
    } else {
        std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
    };

    // Only attempt EXIF for formats that reliably carry it.
    // PNG and WebP rarely contain EXIF; skipping them avoids pointless I/O.
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase());
    let try_exif = matches!(ext.as_deref(), Some("jpg") | Some("jpeg") | Some("tif") | Some("tiff"));

    if try_exif {
        if let Ok(file) = std::fs::File::open(path) {
            // Cap the read: EXIF lives in the first few KB for JPEG/TIFF.
            // This prevents loading entire multi-MB photos just for metadata.
            let capped = file.take(EXIF_READ_CAP);
            let mut reader = std::io::BufReader::new(capped);
            let exif_reader = exif::Reader::new();
            if let Ok(exif) = exif_reader.read_from_container(&mut reader) {
                for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
                    if let Some(field) = exif.get_field(tag, exif::In::PRIMARY) {
                        let raw = field.display_value().to_string();
                        // EXIF stores "YYYY:MM:DD HH:MM:SS" — replace the first two colons.
                        let normalized = {
                            let mut s = raw.clone();
                            let mut replacements = 0;
                            let bytes = unsafe { s.as_bytes_mut() };
                            for b in bytes.iter_mut() {
                                if *b == b':' && replacements < 2 {
                                    *b = b'-';
                                    replacements += 1;
                                }
                            }
                            s
                        };
                        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(
                            &normalized,
                            "%Y-%m-%d %H:%M:%S",
                        ) {
                            return (
                                Some(dt.format("%Y-%m-%dT%H:%M:%S").to_string()),
                                dt.year(),
                                mtime_ms,
                            );
                        }
                    }
                }
            }
        }
    }

    // Fall back to file mtime for the date string too.
    if let Some(ms) = mtime_ms {
        let secs = ms / 1000;
        if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
            let local = dt.with_timezone(&chrono::Local).naive_local();
            return (
                Some(local.format("%Y-%m-%dT%H:%M:%S").to_string()),
                local.year(),
                Some(ms),
            );
        }
    }

    (None, 1970, mtime_ms)
}

/// Build a `PhotoRecord` for one file. `mtime_ms` should come from WalkDir
/// metadata where available so `extract_date` can skip a redundant stat().
fn build_record(p: &Path, mtime_ms: i64) -> PhotoRecord {
    let path_str = p.to_string_lossy().to_string();
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    let size_bytes = std::fs::metadata(p).ok().map(|m| m.len() as i64);
    let (date_taken, year, last_modified_ms) = extract_date(p, mtime_ms);
    PhotoRecord {
        path: path_str,
        filename,
        year,
        date_taken,
        size_bytes,
        last_modified_ms,
    }
}

/// Producer-consumer pipeline for maximum throughput.
///
/// The producer spawns rayon workers (in the I/O-tuned pool) that call
/// `build_record` in parallel and stream results through an mpsc channel.
/// The consumer (this thread) batches records, writes to SQLite in large
/// transactions, and emits progress events — all while the producer keeps
/// running.  The two sides never block each other.
fn run_pipeline(
    to_process: Vec<(PathBuf, i64)>,
    skip_count: usize,
    total: usize,
    phase: &str,
    db: &Arc<Database>,
    cancel: &Arc<std::sync::atomic::AtomicBool>,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    if to_process.is_empty() {
        return Ok(());
    }

    // Bounded channel: back-pressure prevents the producer from flooding RAM
    // if the DB consumer is temporarily slower.
    let (tx, rx) = std::sync::mpsc::sync_channel::<PhotoRecord>(2000);
    let cancel_clone = cancel.clone();

    // Producer runs in its own OS thread so rayon + consumer run in parallel.
    let producer = std::thread::spawn(move || {
        scan_pool().install(|| {
            to_process.into_par_iter().for_each_with(tx, |tx, (p, mtime)| {
                if cancel_clone.load(Ordering::Relaxed) {
                    return;
                }
                let record = build_record(&p, mtime);
                // SendError means the consumer dropped rx (DB error / cancel);
                // just stop sending — the producer will wind down naturally.
                let _ = tx.send(record);
            });
        });
        // `tx` (and all per-thread clones) dropped here → rx.recv() → Disconnected
    });

    let mut batch = Vec::with_capacity(DB_BATCH);
    let mut scanned = skip_count;
    let mut last_progress = skip_count;
    let mut db_error: Option<String> = None;
    let phase = phase.to_string();

    loop {
        match rx.recv() {
            Ok(record) => {
                batch.push(record);
                scanned += 1;

                if scanned - last_progress >= PROGRESS_EVERY {
                    last_progress = scanned;
                    let _ = app.emit(
                        "scan-progress",
                        ScanProgress { scanned, total, phase: phase.clone() },
                    );
                }

                if batch.len() >= DB_BATCH {
                    if let Err(e) = db.upsert_photo_batch(&batch) {
                        db_error = Some(e.to_string());
                        break;
                    }
                    batch.clear();
                }
            }
            Err(_) => break, // producer finished (all senders dropped)
        }
    }

    // Dropping rx makes in-flight sends in the producer return SendError
    // immediately, so the producer thread exits without blocking on a full channel.
    drop(rx);
    producer.join().ok();

    if let Some(e) = db_error {
        return Err(e);
    }

    // Flush the final partial batch.
    if !batch.is_empty() {
        db.upsert_photo_batch(&batch).map_err(|e| e.to_string())?;
        let _ = app.emit(
            "scan-progress",
            ScanProgress { scanned, total, phase },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn scan_folder(
    path: String,
    db: tauri::State<'_, Arc<Database>>,
    cancel: tauri::State<'_, ScanCancelFlag>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let cancel_flag = cancel.0.clone();
    cancel_flag.store(false, Ordering::SeqCst);

    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            scanned: 0,
            total: 0,
            phase: "Discovering files…".into(),
        },
    );

    let db = db.inner().clone();

    let handle = tokio::task::spawn_blocking(move || -> Result<(), String> {
        // Pre-load known paths + mtime so unchanged files can be skipped.
        let known: HashMap<String, i64> =
            db.get_all_paths_with_mtime().map_err(|e| e.to_string())?;

        // Collect image paths + mtime in one pass (mtime is free from WalkDir's
        // dirent cache — no extra stat() per file).
        let all_paths: Vec<(PathBuf, i64)> = WalkDir::new(&path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && is_image(e.path()))
            .filter_map(|e| {
                let mtime = e
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                Some((e.into_path(), mtime))
            })
            .collect();

        let total = all_paths.len();

        // Filter to only new or changed files.
        let to_process: Vec<(PathBuf, i64)> = all_paths
            .into_iter()
            .filter(|(p, mtime)| {
                let path_str = p.to_string_lossy();
                match known.get(path_str.as_ref()) {
                    Some(&km) if *mtime > 0 && km > 0 && *mtime == km => false,
                    _ => true,
                }
            })
            .collect();

        let skip_count = total - to_process.len();

        // Show totals immediately so the UI doesn't appear stuck.
        let _ = app.emit(
            "scan-progress",
            ScanProgress {
                scanned: skip_count,
                total,
                phase: "Indexing images…".into(),
            },
        );

        // synchronous=OFF eliminates WAL fsync overhead during bulk import.
        // Safe here because the index can always be rebuilt by re-scanning.
        db.set_bulk_mode(true).ok();
        let result = run_pipeline(
            to_process,
            skip_count,
            total,
            "Indexing images…",
            &db,
            &cancel_flag,
            &app,
        );
        db.set_bulk_mode(false).ok();
        result?;

        let _ = app.emit(
            "scan-progress",
            ScanProgress {
                scanned: total,
                total,
                phase: "Complete".into(),
            },
        );

        Ok(())
    });

    handle.await.map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
pub async fn scan_folder_incremental(
    path: String,
    db: tauri::State<'_, Arc<Database>>,
    cancel: tauri::State<'_, ScanCancelFlag>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let cancel_flag = cancel.0.clone();
    cancel_flag.store(false, Ordering::SeqCst);

    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            scanned: 0,
            total: 0,
            phase: "Checking for new photos…".into(),
        },
    );

    let db = db.inner().clone();

    let handle = tokio::task::spawn_blocking(move || -> Result<(), String> {
        // Load all known paths + their stored mtime.
        let known: HashMap<String, i64> =
            db.get_all_paths_with_mtime().map_err(|e| e.to_string())?;

        // Walk the folder, collecting path → mtime_ms (mtime free from dirent).
        let current: HashMap<String, i64> = WalkDir::new(&path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && is_image(e.path()))
            .filter_map(|e| {
                let path_str = e.path().to_string_lossy().to_string();
                let mtime_ms = e
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                Some((path_str, mtime_ms))
            })
            .collect();

        // New: in current but not in known.
        let new_paths: Vec<(PathBuf, i64)> = current
            .iter()
            .filter(|(p, _)| !known.contains_key(*p))
            .map(|(p, &mtime)| (PathBuf::from(p), mtime))
            .collect();

        // Modified: in both, but mtime changed.
        let modified_paths: Vec<(PathBuf, i64)> = current
            .iter()
            .filter_map(|(p, &cur_mtime)| {
                let known_mtime = known.get(p)?;
                if cur_mtime > 0 && *known_mtime > 0 && cur_mtime != *known_mtime {
                    Some((PathBuf::from(p), cur_mtime))
                } else {
                    None
                }
            })
            .collect();

        // Deleted: in known but not in current.
        let orphan_paths: Vec<String> = known
            .keys()
            .filter(|p| !current.contains_key(*p))
            .cloned()
            .collect();

        // Reset thumbnails for modified files so they get regenerated.
        let modified_strs: Vec<String> = modified_paths
            .iter()
            .map(|(p, _)| p.to_string_lossy().to_string())
            .collect();
        db.reset_thumb_for_paths(&modified_strs).map_err(|e| e.to_string())?;

        // Process new + modified together.
        let to_process: Vec<(PathBuf, i64)> =
            new_paths.into_iter().chain(modified_paths).collect();
        let total = to_process.len();

        if total > 0 {
            let phase = format!("Indexing {} photo(s)…", total);
            let _ = app.emit(
                "scan-progress",
                ScanProgress { scanned: 0, total, phase: phase.clone() },
            );

            db.set_bulk_mode(true).ok();
            let result =
                run_pipeline(to_process, 0, total, &phase, &db, &cancel_flag, &app);
            db.set_bulk_mode(false).ok();
            result?;
        }

        if !orphan_paths.is_empty() {
            db.remove_photos_by_paths(&orphan_paths)
                .map_err(|e| e.to_string())?;
        }

        let _ = app.emit(
            "scan-progress",
            ScanProgress {
                scanned: total,
                total,
                phase: "Complete".into(),
            },
        );

        Ok(())
    });

    handle.await.map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
pub fn get_years(
    db: tauri::State<'_, Arc<Database>>,
) -> Result<Vec<crate::db::YearSummary>, String> {
    db.get_years().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_photos_by_year(
    year: i32,
    db: tauri::State<'_, Arc<Database>>,
) -> Result<Vec<crate::db::Photo>, String> {
    db.get_photos_by_year(year).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_scan(cancel: tauri::State<'_, ScanCancelFlag>) -> Result<(), String> {
    cancel.0.store(true, Ordering::SeqCst);
    Ok(())
}
