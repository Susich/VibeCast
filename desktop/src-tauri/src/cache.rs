use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::models::{CacheProgress, CacheStats, Track};

#[derive(Clone)]
pub struct CacheManager {
    inner: Arc<CacheInner>,
}

struct CacheInner {
    app: AppHandle,
    audio_dir: PathBuf,
    cover_dir: PathBuf,
    client: reqwest::Client,
    cached: Mutex<HashSet<String>>,
    in_flight: Mutex<HashSet<String>>,
    memory_covers: Mutex<HashMap<String, String>>,
    download_lock: AsyncMutex<()>,
}

pub fn cache_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local).join("vibecast");
        }
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cache")
        .join("vibecast")
}

pub fn extension_for(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/x-ms-wma" => "wma",
        "audio/aiff" | "audio/x-aiff" => "aiff",
        _ => "audio",
    }
}

fn safe_id(id: &str) -> Option<&str> {
    if !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(id)
    } else {
        None
    }
}

fn sniff_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

impl CacheManager {
    pub fn new(app: AppHandle, client: reqwest::Client, root: &Path) -> Result<Self, String> {
        let audio_dir = root.join("audio");
        let cover_dir = root.join("covers");
        std::fs::create_dir_all(&audio_dir)
            .map_err(|e| format!("Не удалось создать кэш аудио: {e}"))?;
        std::fs::create_dir_all(&cover_dir)
            .map_err(|e| format!("Не удалось создать кэш обложек: {e}"))?;

        let mut cached = HashSet::new();
        if let Ok(entries) = std::fs::read_dir(&audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || path.extension().and_then(|e| e.to_str()) == Some("part") {
                    continue;
                }
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                        cached.insert(stem.to_string());
                    }
                }
            }
        }

        Ok(Self {
            inner: Arc::new(CacheInner {
                app,
                audio_dir,
                cover_dir,
                client,
                cached: Mutex::new(cached),
                in_flight: Mutex::new(HashSet::new()),
                memory_covers: Mutex::new(HashMap::new()),
                download_lock: AsyncMutex::new(()),
            }),
        })
    }

    pub fn audio_dir(&self) -> &Path {
        &self.inner.audio_dir
    }

    pub fn is_cached(&self, track_id: &str) -> bool {
        self.inner
            .cached
            .lock()
            .map(|set| set.contains(track_id))
            .unwrap_or(false)
    }

    pub fn cached_count(&self) -> usize {
        self.inner.cached.lock().map(|set| set.len()).unwrap_or(0)
    }

    pub fn all_cached_ids(&self) -> Vec<String> {
        let mut ids = HashSet::new();
        if let Ok(set) = self.inner.cached.lock() {
            ids.extend(set.iter().cloned());
        }
        if let Ok(entries) = std::fs::read_dir(&self.inner.audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|e| e.to_str()) != Some("part") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                            ids.insert(stem.to_string());
                        }
                    }
                }
            }
        }
        if let Ok(mut set) = self.inner.cached.lock() {
            *set = ids.clone();
        }
        ids.into_iter().collect()
    }

    pub fn path_for(&self, track: &Track) -> Option<PathBuf> {
        let id = safe_id(&track.id)?;
        Some(
            self.inner
                .audio_dir
                .join(format!("{id}.{}", extension_for(&track.mime))),
        )
    }

    pub fn cached_path(&self, track: &Track) -> Option<PathBuf> {
        // 1. Check exact path derived from track.mime
        if let Some(path) = self.path_for(track) {
            if path
                .metadata()
                .map(|meta| meta.is_file() && meta.len() > 0)
                .unwrap_or(false)
            {
                if let Ok(mut set) = self.inner.cached.lock() {
                    set.insert(track.id.clone());
                }
                return Some(path);
            }
        }

        // 2. Fall back to finding by ID across all known audio extensions
        self.cached_path_for_id(&track.id)
    }

    pub fn cached_path_for_id(&self, track_id: &str) -> Option<PathBuf> {
        let id = safe_id(track_id)?;

        // Check common audio extensions in priority order
        const EXTENSIONS: &[&str] = &[
            "mp3", "m4a", "flac", "wav", "ogg", "opus", "aac", "wma", "aiff", "audio",
        ];
        for ext in EXTENSIONS {
            let candidate = self.inner.audio_dir.join(format!("{id}.{ext}"));
            if candidate
                .metadata()
                .map(|m| m.is_file() && m.len() > 0)
                .unwrap_or(false)
            {
                if let Ok(mut set) = self.inner.cached.lock() {
                    set.insert(track_id.to_string());
                }
                return Some(candidate);
            }
        }

        // Deep fallback: scan audio_dir for any file with matching stem
        if let Ok(entries) = std::fs::read_dir(&self.inner.audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|e| e.to_str()) != Some("part") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if stem == id
                            && path
                                .metadata()
                                .map(|m| m.is_file() && m.len() > 0)
                                .unwrap_or(false)
                        {
                            if let Ok(mut set) = self.inner.cached.lock() {
                                set.insert(track_id.to_string());
                            }
                            return Some(path);
                        }
                    }
                }
            }
        }

        None
    }

    pub fn ensure_download(&self, track: Track, base_url: String, token: String) {
        if self.cached_path(&track).is_some() {
            return;
        }
        match self.inner.in_flight.lock() {
            Ok(mut set) => {
                if !set.insert(track.id.clone()) {
                    return;
                }
            }
            Err(_) => return,
        }

        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let track_id = track.id.clone();
            let result = manager.download(&track, &base_url, &token).await;
            if let Ok(mut set) = manager.inner.in_flight.lock() {
                set.remove(&track_id);
            }
            match result {
                Ok(()) => {
                    if let Ok(mut set) = manager.inner.cached.lock() {
                        set.insert(track_id.clone());
                    }
                    let progress = CacheProgress {
                        track_id,
                        received: track.size.max(0) as u64,
                        total: track.size.max(0) as u64,
                        done: true,
                        error: None,
                    };
                    let _ = manager.inner.app.emit("cache://progress", progress);
                }
                Err(err) => {
                    let progress = CacheProgress {
                        track_id,
                        received: 0,
                        total: track.size.max(0) as u64,
                        done: true,
                        error: Some(err),
                    };
                    let _ = manager.inner.app.emit("cache://progress", progress);
                }
            }
        });
    }

    async fn download(&self, track: &Track, base_url: &str, token: &str) -> Result<(), String> {
        // One writer at a time keeps cache I/O predictable; parallel playback
        // still works because audio comes from mpv, not from this task.
        let _guard = self.inner.download_lock.lock().await;

        let final_path = self
            .path_for(track)
            .ok_or_else(|| "Некорректный идентификатор трека".to_string())?;
        let ext = extension_for(&track.mime);
        let id =
            safe_id(&track.id).ok_or_else(|| "Некорректный идентификатор трека".to_string())?;
        let part_path = self.inner.audio_dir.join(format!("{id}.{ext}.part"));

        let mut existing = std::fs::metadata(&part_path)
            .map(|m| m.len())
            .unwrap_or(0)
            .min(track.size.max(0) as u64);

        let mut request = self
            .inner
            .client
            .get(format!(
                "{}/audio/{}",
                base_url.trim_end_matches('/'),
                track.id
            ))
            .bearer_auth(token);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Сеть недоступна: {e}"))?;
        let status = response.status();

        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing > 0 {
            tokio::fs::rename(&part_path, &final_path)
                .await
                .map_err(|e| format!("Не удалось завершить кэш: {e}"))?;
            return Ok(());
        }

        if status == reqwest::StatusCode::OK && existing > 0 {
            // Server ignored Range; start from scratch.
            let _ = tokio::fs::remove_file(&part_path).await;
            existing = 0;
        }

        if !status.is_success() {
            return Err(if status == reqwest::StatusCode::UNAUTHORIZED {
                "Телефон отклонил токен при скачивании".to_string()
            } else {
                format!("Сервер вернул HTTP {}", status.as_u16())
            });
        }

        let expected_body = response.content_length().unwrap_or(0);
        let total = if expected_body > 0 {
            existing + expected_body
        } else {
            track.size.max(0) as u64
        };

        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Не удалось открыть файл кэша: {e}"))?;

        let mut received = existing;
        let mut last_emit = Instant::now();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Ошибка загрузки: {e}"))?;
            if chunk.is_empty() {
                continue;
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Ошибка записи кэша: {e}"))?;
            received += chunk.len() as u64;

            if last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                let _ = self.inner.app.emit(
                    "cache://progress",
                    CacheProgress {
                        track_id: track.id.clone(),
                        received,
                        total,
                        done: false,
                        error: None,
                    },
                );
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Ошибка записи кэша: {e}"))?;
        drop(file);

        if total > 0 && received < total {
            return Err(format!(
                "Файл скачан не полностью ({received} из {total} байт)"
            ));
        }

        tokio::fs::rename(&part_path, &final_path)
            .await
            .map_err(|e| format!("Не удалось завершить кэш: {e}"))?;
        log::info!("cached track {} ({} bytes)", track.id, received);
        Ok(())
    }

    pub async fn cover_data_url(
        &self,
        track_id: &str,
        base_url: Option<&str>,
        token: Option<&str>,
    ) -> Option<String> {
        let id = safe_id(track_id)?;

        if let Ok(cache) = self.inner.memory_covers.lock() {
            if let Some(value) = cache.get(id) {
                return Some(value.clone());
            }
        }

        let path = self.inner.cover_dir.join(format!("{id}.img"));
        if let Ok(bytes) = std::fs::read(&path) {
            if !bytes.is_empty() {
                return Some(self.remember_cover(id, &bytes));
            }
        }

        let (base_url, token) = (base_url?, token?);
        let response = self
            .inner
            .client
            .get(format!(
                "{}/cover/{}",
                base_url.trim_end_matches('/'),
                track_id
            ))
            .bearer_auth(token)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .ok()?;

        if !response.status().is_success() {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
            return None;
        }

        let tmp = self.inner.cover_dir.join(format!("{id}.tmp"));
        if std::fs::write(&tmp, &bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
        Some(self.remember_cover(id, &bytes))
    }

    fn remember_cover(&self, id: &str, bytes: &[u8]) -> String {
        let url = format!(
            "data:{};base64,{}",
            sniff_image_mime(bytes),
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        if let Ok(mut cache) = self.inner.memory_covers.lock() {
            if cache.len() > 400 {
                cache.clear();
            }
            cache.insert(id.to_string(), url.clone());
        }
        url
    }

    pub fn stats(&self) -> CacheStats {
        let mut count = 0usize;
        let mut bytes = 0u64;
        if let Ok(entries) = std::fs::read_dir(&self.inner.audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || path.extension().and_then(|e| e.to_str()) == Some("part") {
                    continue;
                }
                if let Ok(meta) = path.metadata() {
                    count += 1;
                    bytes += meta.len();
                }
            }
        }
        CacheStats { count, bytes }
    }

    pub fn clear(&self) -> Result<CacheStats, String> {
        let stats = self.stats();
        if let Ok(entries) = std::fs::read_dir(&self.inner.audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
        if let Ok(mut set) = self.inner.cached.lock() {
            set.clear();
        }
        let _ = self.inner.app.emit("cache://cleared", &stats);
        Ok(stats)
    }

    pub fn delete_track(&self, track_id: &str) -> Result<CacheStats, String> {
        let safe = safe_id(track_id).ok_or_else(|| "Неверный ID трека".to_string())?;
        if let Ok(entries) = std::fs::read_dir(&self.inner.audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if stem == safe {
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }
            }
        }
        if let Ok(mut set) = self.inner.cached.lock() {
            set.remove(track_id);
        }
        let stats = self.stats();
        let _ = self.inner.app.emit(
            "cache://track_deleted",
            serde_json::json!({
                "trackId": track_id,
                "stats": &stats
            }),
        );
        Ok(stats)
    }
}
