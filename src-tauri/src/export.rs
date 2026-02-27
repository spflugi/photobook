use crate::Database;
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    copied: usize,
    total: usize,
    current_file: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub copied: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// Resolves a non-conflicting destination path.
/// If `dir/filename` exists, tries `dir/stem_1.ext`, `dir/stem_2.ext`, …
fn resolve_dest(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();

    for i in 1u32..=9999 {
        let name = format!("{stem}_{i}{ext}");
        let candidate = dir.join(&name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Last resort: append timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    dir.join(format!("{stem}_{ts}{ext}"))
}

#[tauri::command]
pub async fn export_selected(
    destination: String,
    year: i32,
    db: tauri::State<'_, Arc<Database>>,
    app: tauri::AppHandle,
) -> Result<ExportResult, String> {
    let dest_dir = PathBuf::from(&destination);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let selected = db.get_selected_photos_by_year(year).map_err(|e| e.to_string())?;
    let total = selected.len();

    if total == 0 {
        return Ok(ExportResult {
            copied: 0,
            skipped: 0,
            errors: vec![],
        });
    }

    let copied = Arc::new(AtomicUsize::new(0));
    let skipped = Arc::new(AtomicUsize::new(0));
    let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    // Clone Arcs so originals are still accessible after the closure consumes its copies
    let copied_c = copied.clone();
    let skipped_c = skipped.clone();
    let errors_c = errors.clone();
    let app_clone = app.clone();
    let dest_dir_clone = dest_dir.clone();

    tokio::task::spawn_blocking(move || {
        selected
            .par_iter()
            .for_each(|(src_path, filename)| {
                let src = Path::new(src_path);

                if !src.exists() {
                    skipped_c.fetch_add(1, Ordering::SeqCst);
                    return;
                }

                let dest = resolve_dest(&dest_dir_clone, filename);

                match std::fs::copy(src, &dest) {
                    Ok(_) => {
                        let n = copied_c.fetch_add(1, Ordering::SeqCst) + 1;
                        if n % 10 == 0 || n == total {
                            let _ = app_clone.emit(
                                "export-progress",
                                ExportProgress {
                                    copied: n,
                                    total,
                                    current_file: filename.clone(),
                                },
                            );
                        }
                    }
                    Err(e) => {
                        errors_c
                            .lock()
                            .unwrap()
                            .push(format!("{filename}: {e}"));
                        skipped_c.fetch_add(1, Ordering::SeqCst);
                    }
                }
            });
    })
    .await
    .map_err(|e| e.to_string())?;

    let copied_n = copied.load(Ordering::SeqCst);
    let skipped_n = skipped.load(Ordering::SeqCst);
    let errors_vec = errors.lock().unwrap().clone();

    Ok(ExportResult {
        copied: copied_n,
        skipped: skipped_n,
        errors: errors_vec,
    })
}
