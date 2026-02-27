use crate::{Database, ScanCancelFlag};
use crate::db::PhotoRecord;
use chrono::Datelike;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{atomic::Ordering, Arc};
use tauri::Emitter;
use walkdir::WalkDir;

pub const SUPPORTED_EXT: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff"];

/// Number of files given to rayon per parallel EXIF-extraction pass.
const BATCH_SIZE: usize = 1000;
/// Number of records per DB upsert transaction and progress event.
const PROGRESS_BATCH: usize = 50;

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
fn extract_date(path: &std::path::Path) -> (Option<String>, i32, Option<i64>) {
    // Read mtime first (cheap) — used regardless of EXIF result.
    let mtime_ms = std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    // Try EXIF DateTimeOriginal / DateTime
    if let Ok(file) = std::fs::File::open(path) {
        let mut reader = std::io::BufReader::new(file);
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
        let all_paths: Vec<PathBuf> = WalkDir::new(&path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && is_image(e.path()))
            .map(|e| e.into_path())
            .collect();

        let total = all_paths.len();

        let mut scanned = 0usize;
        for chunk in all_paths.chunks(BATCH_SIZE) {
            if cancel_flag.load(Ordering::SeqCst) {
                break;
            }

            let records: Vec<PhotoRecord> = chunk
                .par_iter()
                .map(|p| {
                    let path_str = p.to_string_lossy().to_string();
                    let filename = p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let size_bytes = std::fs::metadata(p).ok().map(|m| m.len() as i64);
                    let (date_taken, year, last_modified_ms) = extract_date(p);
                    PhotoRecord {
                        path: path_str,
                        filename,
                        year,
                        date_taken,
                        size_bytes,
                        last_modified_ms,
                    }
                })
                .collect();

            for sub in records.chunks(PROGRESS_BATCH) {
                db.upsert_photo_batch(sub).map_err(|e| e.to_string())?;
                scanned = (scanned + sub.len()).min(total);
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        scanned,
                        total,
                        phase: "Indexing images…".into(),
                    },
                );
            }
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
        let known: HashMap<String, i64> = db.get_all_paths_with_mtime().map_err(|e| e.to_string())?;

        // Walk the folder, collecting (path_str → mtime_ms).
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
        let new_paths: Vec<PathBuf> = current
            .keys()
            .filter(|p| !known.contains_key(*p))
            .map(|p| PathBuf::from(p))
            .collect();

        // Modified: in both, but mtime changed (only when we have real mtime data).
        let modified_paths: Vec<PathBuf> = current
            .iter()
            .filter_map(|(p, &cur_mtime)| {
                let known_mtime = known.get(p)?;
                if cur_mtime > 0 && *known_mtime > 0 && cur_mtime != *known_mtime {
                    Some(PathBuf::from(p))
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
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        db.reset_thumb_for_paths(&modified_strs).map_err(|e| e.to_string())?;

        // Process new + modified together.
        let to_process: Vec<PathBuf> = new_paths
            .into_iter()
            .chain(modified_paths)
            .collect();
        let total = to_process.len();

        if total > 0 {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    scanned: 0,
                    total,
                    phase: format!("Indexing {} photo(s)…", total),
                },
            );

            let mut scanned = 0usize;
            for chunk in to_process.chunks(BATCH_SIZE) {
                if cancel_flag.load(Ordering::SeqCst) {
                    break;
                }

                let records: Vec<PhotoRecord> = chunk
                    .par_iter()
                    .map(|p| {
                        let path_str = p.to_string_lossy().to_string();
                        let filename = p
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let size_bytes = std::fs::metadata(p).ok().map(|m| m.len() as i64);
                        let (date_taken, year, last_modified_ms) = extract_date(p);
                        PhotoRecord {
                            path: path_str,
                            filename,
                            year,
                            date_taken,
                            size_bytes,
                            last_modified_ms,
                        }
                    })
                    .collect();

                for sub in records.chunks(PROGRESS_BATCH) {
                    db.upsert_photo_batch(sub).map_err(|e| e.to_string())?;
                    scanned = (scanned + sub.len()).min(total);
                    let _ = app.emit(
                        "scan-progress",
                        ScanProgress {
                            scanned,
                            total,
                            phase: format!("Indexing {} photo(s)…", total),
                        },
                    );
                }
            }
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

