use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

use crate::models::{
    AlbumFacet, Facet, Facets, LibraryStats, SearchQuery, SearchResult, ServerSession, Track,
};

pub struct Db {
    conn: Mutex<Connection>,
}

const TRACK_COLUMNS: &str =
    "id, title, artist, album, album_artist, duration_ms, mime, size, track_no, year, cover_id, date_modified";

fn db_err<E: std::fmt::Display>(err: E) -> String {
    format!("Ошибка базы данных: {err}")
}

fn row_to_track(row: &Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get("id")?,
        title: row.get("title")?,
        artist: row.get("artist")?,
        album: row.get("album")?,
        album_artist: row.get("album_artist")?,
        duration_ms: row.get("duration_ms")?,
        mime: row.get("mime")?,
        size: row.get("size")?,
        track_no: row.get("track_no")?,
        year: row.get("year")?,
        cover_id: row.get("cover_id")?,
        date_modified: row.get("date_modified")?,
    })
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn meta_i64(conn: &Connection, key: &str) -> i64 {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
    .and_then(|value| value.parse::<i64>().ok())
    .unwrap_or(0)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать каталог данных: {e}"))?;
        }
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS settings (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS server (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               base_url TEXT NOT NULL,
               token TEXT NOT NULL,
               device_name TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS tracks (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               artist TEXT NOT NULL,
               album TEXT NOT NULL,
               album_artist TEXT,
               duration_ms INTEGER NOT NULL,
               mime TEXT NOT NULL,
               size INTEGER NOT NULL,
               track_no INTEGER,
               year INTEGER,
               cover_id INTEGER,
               date_modified INTEGER NOT NULL,
               title_key TEXT NOT NULL,
               artist_key TEXT NOT NULL,
               album_key TEXT NOT NULL,
               search_text TEXT NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title_key);
             CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_key);
             CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_key);
             CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks(search_text);

             CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );",
        )
        .map_err(db_err)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "База данных недоступна (блокировка)".to_string())
    }

    pub fn load_server(&self) -> Option<ServerSession> {
        let conn = self.conn.lock().ok()?;
        conn.query_row(
            "SELECT base_url, token, device_name FROM server WHERE id = 1",
            [],
            |row| {
                Ok(ServerSession {
                    base_url: row.get(0)?,
                    token: row.get(1)?,
                    device_name: row.get(2)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn save_server(&self, server: &ServerSession) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO server(id, base_url, token, device_name) VALUES(1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               base_url = excluded.base_url,
               token = excluded.token,
               device_name = excluded.device_name",
            params![server.base_url, server.token, server.device_name],
        )
        .map_err(db_err)?;
        Ok(())
    }

    pub fn clear_server(&self) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM server", []).map_err(db_err)?;
        Ok(())
    }

    pub fn reset_catalog(&self) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(db_err)?;
        tx.execute("DELETE FROM tracks", []).map_err(db_err)?;
        set_meta(&tx, "catalog_version", "0").map_err(db_err)?;
        set_meta(&tx, "synced_at", "0").map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(())
    }

    /// Replaces the whole catalog in one transaction. The catalog is small
    /// (MVP: up to tens of thousands of rows) and a full replace avoids
    /// partially updated libraries when a sync is interrupted.
    pub fn replace_tracks(&self, tracks: &[Track], version: i64) -> Result<LibraryStats, String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(db_err)?;
        tx.execute("DELETE FROM tracks", []).map_err(db_err)?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO tracks (
                       id, title, artist, album, album_artist, duration_ms, mime, size,
                       track_no, year, cover_id, date_modified,
                       title_key, artist_key, album_key, search_text
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                )
                .map_err(db_err)?;

            for track in tracks {
                let title_key = track.title.to_lowercase();
                let artist_key = track.artist.to_lowercase();
                let album_key = track.album.to_lowercase();
                let search_text = format!(
                    "{} {} {} {}",
                    track.title,
                    track.artist,
                    track.album,
                    track.album_artist.as_deref().unwrap_or("")
                )
                .to_lowercase();

                stmt.execute(params![
                    track.id,
                    track.title,
                    track.artist,
                    track.album,
                    track.album_artist,
                    track.duration_ms,
                    track.mime,
                    track.size,
                    track.track_no,
                    track.year,
                    track.cover_id,
                    track.date_modified,
                    title_key,
                    artist_key,
                    album_key,
                    search_text,
                ])
                .map_err(db_err)?;
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        set_meta(&tx, "catalog_version", &version.to_string()).map_err(db_err)?;
        set_meta(&tx, "synced_at", &now.to_string()).map_err(db_err)?;
        tx.commit().map_err(db_err)?;

        drop(conn);
        self.stats()
    }

    pub fn search(&self, query: &SearchQuery) -> Result<SearchResult, String> {
        let conn = self.lock()?;

        let mut where_clause = String::from(" WHERE 1 = 1");
        let mut values: Vec<Value> = Vec::new();

        if let Some(text) = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            where_clause.push_str(" AND search_text LIKE ? ESCAPE '\\'");
            values.push(Value::Text(format!(
                "%{}%",
                escape_like(&text.to_lowercase())
            )));
        }
        if let Some(artist) = query
            .artist
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            where_clause.push_str(" AND artist_key = ?");
            values.push(Value::Text(artist.to_lowercase()));
        }
        if let Some(album) = query
            .album
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            where_clause.push_str(" AND album_key = ?");
            values.push(Value::Text(album.to_lowercase()));
        }

        let order = match query.sort.as_deref().unwrap_or("title") {
            "artist" => "artist_key ASC, title_key ASC",
            "album" => "album_key ASC, (track_no IS NULL) ASC, track_no ASC, title_key ASC",
            "duration" => "duration_ms DESC, title_key ASC",
            "added" => "date_modified DESC, title_key ASC",
            "oldest" => "date_modified ASC, title_key ASC",
            _ => "title_key ASC, artist_key ASC",
        };

        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM tracks{where_clause}"),
                params_from_iter(values.clone()),
                |row| row.get(0),
            )
            .map_err(db_err)?;

        let limit = query.limit.unwrap_or(20_000).clamp(1, 20_000);
        let offset = query.offset.unwrap_or(0);
        values.push(Value::Integer(limit as i64));
        values.push(Value::Integer(offset as i64));

        let mut stmt = conn
            .prepare(&format!(
                "SELECT {TRACK_COLUMNS} FROM tracks{where_clause} ORDER BY {order} LIMIT ? OFFSET ?"
            ))
            .map_err(db_err)?;

        let rows = stmt
            .query_map(params_from_iter(values), row_to_track)
            .map_err(db_err)?;

        let tracks = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)?;

        Ok(SearchResult {
            total,
            tracks: tracks
                .into_iter()
                .map(|track| crate::models::TrackRow {
                    track,
                    cached: false,
                })
                .collect(),
        })
    }

    pub fn get_track(&self, id: &str) -> Result<Option<Track>, String> {
        let conn = self.lock()?;
        conn.query_row(
            &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id = ?1"),
            [id],
            row_to_track,
        )
        .optional()
        .map_err(db_err)
    }

    pub fn get_tracks_by_ids(&self, ids: &[String]) -> Result<Vec<Track>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock()?;
        let mut results = Vec::new();
        for chunk in ids.chunks(200) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id IN ({placeholders})");
            let mut stmt = conn.prepare(&sql).map_err(db_err)?;
            let mapped = stmt
                .query_map(params_from_iter(chunk.iter()), row_to_track)
                .map_err(db_err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(db_err)?;
            results.extend(mapped);
        }
        Ok(results)
    }

    pub fn facets(&self) -> Result<Facets, String> {
        let conn = self.lock()?;

        let mut stmt = conn
            .prepare(
                "SELECT MIN(artist) AS name, COUNT(*) AS count
                 FROM tracks GROUP BY artist_key ORDER BY artist_key LIMIT 20000",
            )
            .map_err(db_err)?;
        let artists = stmt
            .query_map([], |row| {
                Ok(Facet {
                    name: row.get("name")?,
                    count: row.get("count")?,
                })
            })
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;

        let mut stmt = conn
            .prepare(
                "SELECT MIN(album) AS album, MIN(artist) AS artist, COUNT(*) AS count, MIN(id) AS cover_id
                 FROM tracks GROUP BY album_key, artist_key ORDER BY album_key, artist_key LIMIT 20000",
            )
            .map_err(db_err)?;
        let albums = stmt
            .query_map([], |row| {
                Ok(AlbumFacet {
                    album: row.get("album")?,
                    artist: row.get("artist")?,
                    count: row.get("count")?,
                    cover_track_id: row.get("cover_id")?,
                })
            })
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;

        Ok(Facets { artists, albums })
    }

    pub fn stats(&self) -> Result<LibraryStats, String> {
        let conn = self.lock()?;
        let (tracks, artists, albums): (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(*),
                        COUNT(DISTINCT artist_key),
                        COUNT(DISTINCT album_key || char(31) || artist_key)
                 FROM tracks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(db_err)?;

        Ok(LibraryStats {
            tracks,
            artists,
            albums,
            version: meta_i64(&conn, "catalog_version"),
            synced_at: meta_i64(&conn, "synced_at"),
        })
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().ok()?;
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(db_err)?;
        Ok(())
    }
}
