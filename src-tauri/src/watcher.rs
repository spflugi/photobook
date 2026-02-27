use crate::scan::is_image;
use notify_debouncer_mini::{
    new_debouncer,
    notify::RecursiveMode,
    DebounceEventResult,
    Debouncer,
};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

type AnyDebouncer = Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

/// Keeps the active debouncer alive. Replacing the `Option` drops the old watcher.
pub struct WatcherState {
    pub handle: Mutex<Option<AnyDebouncer>>,
}

/// Start watching `path` recursively. Events are debounced by `DEBOUNCE_SECS`
/// of inactivity before a `"folder-changed"` event is emitted to the frontend.
/// Calling this again replaces any existing watcher.
#[tauri::command]
pub async fn start_watching(
    path: String,
    state: tauri::State<'_, WatcherState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 60 s quiet-time — lets large file copies finish before we trigger a scan.
    const DEBOUNCE_SECS: u64 = 60;

    let mut guard = state.handle.lock().unwrap();

    // Drop the old watcher (stops its background thread).
    *guard = None;

    let app_clone = app.clone();
    let mut debouncer: AnyDebouncer =
        new_debouncer(Duration::from_secs(DEBOUNCE_SECS), move |res: DebounceEventResult| {
            if let Ok(events) = res {
                // Only fire when at least one image file changed.
                let has_image_event = events.iter().any(|e| is_image(&e.path));
                if has_image_event {
                    let _ = app_clone.emit("folder-changed", ());
                }
            }
        })
        .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(debouncer);
    Ok(())
}

/// Stop the active watcher (no-op if none is running).
#[tauri::command]
pub async fn stop_watching(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.handle.lock().unwrap();
    *guard = None;
    Ok(())
}
