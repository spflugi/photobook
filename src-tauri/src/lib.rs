use std::sync::{
    atomic::{AtomicBool, AtomicUsize},
    Arc, Mutex,
};
use tauri::Manager;

mod db;
mod export;
mod scan;
mod thumbnails;
mod watcher;

pub use db::Database;

/// Shared cancel flag for the background scan operation.
pub struct ScanCancelFlag(pub Arc<AtomicBool>);

/// Shared state for thumbnail generation.
pub struct ThumbState {
    pub cancel: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
    pub done: Arc<AtomicUsize>,
    pub total: Arc<AtomicUsize>,
    pub thumb_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let thumb_dir = app_data_dir.join("thumbnails");
            std::fs::create_dir_all(&thumb_dir)?;

            let db_path = app_data_dir.join("db.sqlite");
            let db = Arc::new(
                db::Database::new(&db_path).expect("failed to open database"),
            );
            app.manage(db);

            app.manage(ScanCancelFlag(Arc::new(AtomicBool::new(false))));
            app.manage(ThumbState {
                cancel: Arc::new(AtomicBool::new(false)),
                running: Arc::new(AtomicBool::new(false)),
                done: Arc::new(AtomicUsize::new(0)),
                total: Arc::new(AtomicUsize::new(0)),
                thumb_dir,
            });
            app.manage(watcher::WatcherState {
                handle: Mutex::new(None),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan::scan_folder,
            scan::scan_folder_incremental,
            scan::get_years,
            scan::get_photos_by_year,
            scan::cancel_scan,
            thumbnails::generate_thumbnails,
            thumbnails::cancel_thumbnails,
            thumbnails::get_thumb_progress,
            db::toggle_selection,
            db::batch_set_selection,
            db::get_selected_ids,
            db::get_pending_thumb_count,
            db::get_setting,
            db::set_setting,
            export::export_selected,
            watcher::start_watching,
            watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
