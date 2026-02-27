use chrono::Utc;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub year: i32,
    pub date_taken: Option<String>,
    pub size_bytes: Option<i64>,
    pub thumb_path: Option<String>,
    pub thumb_ready: bool,
    pub selected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct YearSummary {
    pub year: i32,
    pub total: i64,
    pub selected: i64,
}

/// Flat record used when inserting/updating a photo.
pub struct PhotoRecord {
    pub path: String,
    pub filename: String,
    pub year: i32,
    pub date_taken: Option<String>,
    pub size_bytes: Option<i64>,
    pub last_modified_ms: Option<i64>,
}

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn new(path: &Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-32000;
             PRAGMA temp_store=MEMORY;
             PRAGMA mmap_size=268435456;
             PRAGMA foreign_keys=ON;",
        )?;
        let db = Self(Mutex::new(conn));
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqlResult<()> {
        let conn = self.0.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS photos (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                path             TEXT NOT NULL UNIQUE,
                filename         TEXT NOT NULL,
                year             INTEGER NOT NULL,
                date_taken       TEXT,
                size_bytes       INTEGER,
                thumb_path       TEXT,
                thumb_ready      INTEGER NOT NULL DEFAULT 0,
                indexed_at       TEXT NOT NULL,
                last_modified_ms INTEGER
            );
            CREATE TABLE IF NOT EXISTS selections (
                photo_id INTEGER NOT NULL PRIMARY KEY
                    REFERENCES photos(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_photos_year  ON photos(year);
            CREATE INDEX IF NOT EXISTS idx_photos_thumb ON photos(thumb_ready);
            "#,
        )?;

        // Migrate existing databases that are missing the last_modified_ms column.
        // SQLite does not support IF NOT EXISTS on ALTER TABLE, so we swallow
        // the "duplicate column name" error if the column already exists.
        let _ = conn.execute_batch(
            "ALTER TABLE photos ADD COLUMN last_modified_ms INTEGER;",
        );

        Ok(())
    }

    pub fn upsert_photo_batch(&self, records: &[PhotoRecord]) -> SqlResult<()> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        {
            let mut stmt = tx.prepare_cached(
                r#"INSERT INTO photos
                       (path, filename, year, date_taken, size_bytes, indexed_at, last_modified_ms)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                   ON CONFLICT(path) DO UPDATE SET
                       filename         = excluded.filename,
                       year             = excluded.year,
                       date_taken       = excluded.date_taken,
                       size_bytes       = excluded.size_bytes,
                       indexed_at       = excluded.indexed_at,
                       last_modified_ms = excluded.last_modified_ms"#,
            )?;
            for r in records {
                stmt.execute(params![
                    r.path,
                    r.filename,
                    r.year,
                    r.date_taken,
                    r.size_bytes,
                    now,
                    r.last_modified_ms
                ])?;
            }
        }
        tx.commit()
    }

    pub fn update_thumb_batch(&self, updates: &[(i64, String)]) -> SqlResult<()> {
        if updates.is_empty() {
            return Ok(());
        }
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "UPDATE photos SET thumb_path = ?1, thumb_ready = 1 WHERE id = ?2",
            )?;
            for (photo_id, thumb_path) in updates {
                stmt.execute(params![thumb_path, photo_id])?;
            }
        }
        tx.commit()
    }

    /// Reset thumbnail status for specific paths (e.g. when a file is modified).
    pub fn reset_thumb_for_paths(&self, paths: &[String]) -> SqlResult<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "UPDATE photos SET thumb_ready = 0, thumb_path = NULL WHERE path = ?1",
            )?;
            for path in paths {
                stmt.execute(params![path])?;
            }
        }
        tx.commit()
    }

    pub fn get_years(&self) -> SqlResult<Vec<YearSummary>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT p.year,
                      COUNT(*) as total,
                      COUNT(s.photo_id) as selected
               FROM photos p
               LEFT JOIN selections s ON p.id = s.photo_id
               GROUP BY p.year
               ORDER BY p.year DESC"#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(YearSummary {
                year: row.get(0)?,
                total: row.get(1)?,
                selected: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_photos_by_year(&self, year: i32) -> SqlResult<Vec<Photo>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT p.id, p.path, p.filename, p.year, p.date_taken,
                      p.size_bytes, p.thumb_path, p.thumb_ready,
                      CASE WHEN s.photo_id IS NOT NULL THEN 1 ELSE 0 END as selected
               FROM photos p
               LEFT JOIN selections s ON p.id = s.photo_id
               WHERE p.year = ?1
               ORDER BY COALESCE(p.date_taken, p.filename) ASC"#,
        )?;
        let rows = stmt.query_map(params![year], |row| {
            Ok(Photo {
                id: row.get(0)?,
                path: row.get(1)?,
                filename: row.get(2)?,
                year: row.get(3)?,
                date_taken: row.get(4)?,
                size_bytes: row.get(5)?,
                thumb_path: row.get(6)?,
                thumb_ready: row.get::<_, i32>(7)? == 1,
                selected: row.get::<_, i32>(8)? == 1,
            })
        })?;
        rows.collect()
    }

    pub fn get_pending_thumbs(&self) -> SqlResult<Vec<(i64, String)>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path FROM photos WHERE thumb_ready = 0 ORDER BY year DESC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    /// Returns every known path with its stored last_modified_ms (0 if NULL).
    pub fn get_all_paths_with_mtime(&self) -> SqlResult<HashMap<String, i64>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path, COALESCE(last_modified_ms, 0) FROM photos",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        rows.collect()
    }

    pub fn remove_photos_by_paths(&self, paths: &[String]) -> SqlResult<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM photos WHERE path = ?1")?;
            for path in paths {
                stmt.execute(params![path])?;
            }
        }
        tx.commit()
    }

    pub fn toggle_selection(&self, photo_id: i64, selected: bool) -> SqlResult<()> {
        let conn = self.0.lock().unwrap();
        if selected {
            conn.execute(
                "INSERT OR IGNORE INTO selections (photo_id) VALUES (?1)",
                params![photo_id],
            )?;
        } else {
            conn.execute(
                "DELETE FROM selections WHERE photo_id = ?1",
                params![photo_id],
            )?;
        }
        Ok(())
    }

    pub fn batch_set_selection(&self, photo_ids: &[i64], selected: bool) -> SqlResult<()> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn.transaction()?;
        if selected {
            let mut stmt =
                tx.prepare_cached("INSERT OR IGNORE INTO selections (photo_id) VALUES (?1)")?;
            for &id in photo_ids {
                stmt.execute(params![id])?;
            }
        } else {
            let mut stmt =
                tx.prepare_cached("DELETE FROM selections WHERE photo_id = ?1")?;
            for &id in photo_ids {
                stmt.execute(params![id])?;
            }
        }
        tx.commit()
    }

    pub fn get_selected_ids(&self) -> SqlResult<Vec<i64>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT photo_id FROM selections ORDER BY photo_id")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect()
    }

    pub fn get_selected_photos_by_year(&self, year: i32) -> SqlResult<Vec<(String, String)>> {
        let conn = self.0.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT p.path, p.filename
               FROM photos p
               INNER JOIN selections s ON p.id = s.photo_id
               WHERE p.year = ?1
               ORDER BY COALESCE(p.date_taken, p.filename)"#,
        )?;
        let rows = stmt.query_map(params![year], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect()
    }

    pub fn count_photos_total(&self) -> SqlResult<i64> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM photos", [], |row| row.get(0))
    }

    pub fn get_pending_thumb_count(&self) -> SqlResult<i64> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM photos WHERE thumb_ready = 0",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        let conn = self.0.lock().unwrap();
        match conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_pending_thumb_count(
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<i64, String> {
    db.get_pending_thumb_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_selection(
    photo_id: i64,
    selected: bool,
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<(), String> {
    db.toggle_selection(photo_id, selected)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn batch_set_selection(
    photo_ids: Vec<i64>,
    selected: bool,
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<(), String> {
    db.batch_set_selection(&photo_ids, selected)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_selected_ids(
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<Vec<i64>, String> {
    db.get_selected_ids().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(
    key: String,
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: String,
    db: tauri::State<'_, std::sync::Arc<Database>>,
) -> Result<(), String> {
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}
