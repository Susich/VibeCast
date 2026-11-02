use std::sync::atomic::Ordering;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::catalog::{self, normalize_base};
use crate::models::{
    AppConfig, Bootstrap, CacheStats, Facets, LibraryStats, OverlayState, PlayerState, RemoteCommand, SearchQuery,
    SearchResult, ServerSession, ServerView, Settings, Toast, Track, TrackRow, UpdateInfo,
};
use crate::state::AppState;

fn toast(app: &AppHandle, message: impl Into<String>, level: &str) {
    let _ = app.emit(
        "app://toast",
        Toast {
            message: message.into(),
            level: level.to_string(),
        },
    );
}

fn emit_library(app: &AppHandle, stats: &LibraryStats) {
    let _ = app.emit("library://updated", stats);
}

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Bootstrap {
    Bootstrap {
        server: state.server_view(),
        devices: state.discovery.devices(),
        player: state.player.state(),
        settings: state.settings(),
        stats: state.stats(),
        cached_count: state.cache.cached_count(),
    }
}

#[tauri::command]
pub async fn connect_manual(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    token: Option<String>,
) -> Result<ServerView, String> {
    let (base_url, token_from_url) = normalize_base(&url)?;
    let token = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(token_from_url)
        .ok_or_else(|| {
            "Укажите токен с телефона. Его можно скопировать на экране VibeCast.".to_string()
        })?;

    apply_connection(&app, state.inner(), base_url, token, true).await
}

/// Reconnects to a phone that was paired before, reusing its saved bearer
/// token. This is what the "found on the network" card calls after the phone
/// changes IP: the user does not need to copy the token again.
#[tauri::command]
pub async fn connect_saved(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<ServerView, String> {
    let (base_url, _) = normalize_base(&url)?;
    let saved = state
        .session()
        .ok_or_else(|| "Нет сохранённого подключения. Введите токен с телефона.".to_string())?;
    apply_connection(&app, state.inner(), base_url, saved.token, false).await
}

async fn apply_connection(
    app: &AppHandle,
    state: &AppState,
    base_url: String,
    token: String,
    reset_on_base_change: bool,
) -> Result<ServerView, String> {
    let health = catalog::validate_token(&state.http, &base_url, &token).await?;

    let previous_base = state.session().map(|session| session.base_url);
    let base_changed = previous_base.as_deref() != Some(base_url.as_str());
    let session = ServerSession {
        base_url: base_url.clone(),
        token,
        device_name: health.device_name.clone(),
    };

    state.db.save_server(&session)?;
    if reset_on_base_change && base_changed {
        state.db.reset_catalog()?;
        state.version.store(0, Ordering::SeqCst);
        state.track_count.store(0, Ordering::SeqCst);
    }
    {
        let mut current = state
            .session
            .write()
            .map_err(|_| "Состояние подключения недоступно".to_string())?;
        *current = Some(session);
    }
    state.protocol.store(health.protocol, Ordering::SeqCst);
    state.connection_epoch.fetch_add(1, Ordering::SeqCst);
    state.set_online(app, true);
    stop_sse(app);

    let stats = match sync_catalog(app).await {
        Ok(stats) => stats,
        Err(err) => {
            state.set_online(app, false);
            return Err(format!(
                "Телефон найден, но библиотека не загрузилась: {err}"
            ));
        }
    };
    emit_library(app, &stats);
    restart_sse(app);
    state.emit_server(app);

    state
        .server_view()
        .ok_or_else(|| "Не удалось сохранить подключение".to_string())
}

#[tauri::command]
pub async fn disconnect(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.connection_epoch.fetch_add(1, Ordering::SeqCst);
    stop_sse(&app);
    {
        let mut current = state
            .session
            .write()
            .map_err(|_| "Состояние подключения недоступно".to_string())?;
        *current = None;
    }
    state.db.clear_server()?;
    // Явное отключение очищает каталог: чужие треки не должны оставаться на ПК.
    state.db.reset_catalog()?;
    state.version.store(0, Ordering::SeqCst);
    state.track_count.store(0, Ordering::SeqCst);
    state.player.stop().await;
    state.set_online(&app, false);
    emit_library(&app, &state.stats());
    state.emit_server(&app);
    Ok(())
}

#[tauri::command]
pub fn search_tracks(
    state: State<'_, AppState>,
    query: SearchQuery,
) -> Result<SearchResult, String> {
    let cached_only = query.cached_only.unwrap_or(false);
    if cached_only {
        let cached_ids = state.cache.all_cached_ids();
        let mut tracks: Vec<TrackRow> = Vec::new();
        let mut found_ids = std::collections::HashSet::new();

        if !cached_ids.is_empty() {
            if let Ok(db_tracks) = state.db.get_tracks_by_ids(&cached_ids) {
                for t in db_tracks {
                    found_ids.insert(t.id.clone());
                    tracks.push(TrackRow {
                        track: t,
                        cached: true,
                    });
                }
            }
        }

        for id in &cached_ids {
            if !found_ids.contains(id) {
                if let Some(path) = state.cache.cached_path_for_id(id) {
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("audio");
                    let size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);
                    let title = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(id)
                        .to_string();
                    tracks.push(TrackRow {
                        track: Track {
                            id: id.clone(),
                            title,
                            artist: "Локальный кэш".to_string(),
                            album: "Сохранённые треки".to_string(),
                            album_artist: None,
                            duration_ms: 0,
                            mime: format!("audio/{ext}"),
                            size,
                            track_no: None,
                            year: None,
                            cover_id: None,
                            date_modified: 0,
                        },
                        cached: true,
                    });
                }
            }
        }

        if let Some(ref q) = query.query {
            let q_lower = q.to_lowercase();
            tracks.retain(|row| {
                row.track.title.to_lowercase().contains(&q_lower)
                    || row.track.artist.to_lowercase().contains(&q_lower)
                    || row.track.album.to_lowercase().contains(&q_lower)
            });
        }

        if let Some(ref art) = query.artist {
            let art_lower = art.to_lowercase();
            tracks.retain(|row| row.track.artist.to_lowercase().contains(&art_lower));
        }
        if let Some(ref alb) = query.album {
            let alb_lower = alb.to_lowercase();
            tracks.retain(|row| row.track.album.to_lowercase().contains(&alb_lower));
        }

        match query.sort.as_deref() {
            Some("title") => tracks.sort_by(|a, b| a.track.title.to_lowercase().cmp(&b.track.title.to_lowercase())),
            Some("artist") => tracks.sort_by(|a, b| a.track.artist.to_lowercase().cmp(&b.track.artist.to_lowercase())),
            Some("album") => tracks.sort_by(|a, b| a.track.album.to_lowercase().cmp(&b.track.album.to_lowercase())),
            Some("duration") => tracks.sort_by(|a, b| b.track.duration_ms.cmp(&a.track.duration_ms)),
            _ => tracks.sort_by(|a, b| a.track.title.to_lowercase().cmp(&b.track.title.to_lowercase())),
        }

        let total = tracks.len() as i64;
        return Ok(SearchResult { tracks, total });
    }

    let mut result = state.db.search(&query)?;
    for row in &mut result.tracks {
        row.cached = state.cache.is_cached(&row.track.id);
    }
    Ok(result)
}

#[tauri::command]
pub fn facets(state: State<'_, AppState>) -> Result<Facets, String> {
    state.db.facets()
}

#[tauri::command]
pub async fn play_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<PlayerState, String> {
    let track = match state.db.get_track(&track_id)? {
        Some(t) => t,
        None => {
            // Check if track is present in local cache even without DB entry
            if let Some(cached_file) = state.cache.cached_path_for_id(&track_id) {
                let ext = cached_file
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("audio");
                let mime = match ext {
                    "mp3" => "audio/mpeg",
                    "m4a" => "audio/mp4",
                    "flac" => "audio/flac",
                    "wav" => "audio/wav",
                    "ogg" => "audio/ogg",
                    "opus" => "audio/opus",
                    _ => "audio/octet-stream",
                };
                crate::models::Track {
                    id: track_id.clone(),
                    title: format!("Кэш ({})", &track_id[..8.min(track_id.len())]),
                    artist: "Локальный кэш".to_string(),
                    album: "Сохранённые треки".to_string(),
                    album_artist: None,
                    duration_ms: 0,
                    mime: mime.to_string(),
                    size: cached_file.metadata().map(|m| m.len() as i64).unwrap_or(0),
                    track_no: None,
                    year: None,
                    cover_id: None,
                    date_modified: 0,
                }
            } else {
                return Err("Трек не найден в каталоге".to_string());
            }
        }
    };

    let cached = state.cache.cached_path(&track);
    let session = state.session();

    let (uri, remote, token, download) = match cached {
        Some(path) => {
            let normalized = path.to_string_lossy().replace('\\', "/");
            (normalized, false, None, None)
        }
        None => {
            let session = session
                .as_ref()
                .ok_or_else(|| {
                    "Телефон недоступен, а трека нет в кэше. Подключите телефон.".to_string()
                })?
                .clone();
            if !state.online.load(Ordering::SeqCst) {
                return Err(
                    "Телефон недоступен, а этого трека нет в кэше. Воспроизведите ранее сохранённый трек или дождитесь переподключения."
                        .to_string(),
                );
            }
            let uri = format!(
                "{}/audio/{}",
                session.base_url.trim_end_matches('/'),
                track.id
            );
            (uri, true, Some(session.token.clone()), Some(session))
        }
    };

    state
        .player
        .play(&track, &uri, remote, token.as_deref(), 0.0)
        .await?;

    if let Some(session) = download {
        let cache_mode = state
            .db
            .get_setting("cache_mode")
            .unwrap_or_else(|| "auto".to_string());
        if cache_mode != "manual" {
            state
                .cache
                .ensure_download(track.clone(), session.base_url, session.token);
        }
    }

    Ok(state.player.state())
}

#[tauri::command]
pub async fn toggle_pause(state: State<'_, AppState>) -> Result<PlayerState, String> {
    state.player.toggle_pause().await;
    Ok(state.player.state())
}

#[tauri::command]
pub async fn set_pause(state: State<'_, AppState>, paused: bool) -> Result<PlayerState, String> {
    state.player.set_pause(paused).await;
    Ok(state.player.state())
}

#[tauri::command]
pub async fn seek(state: State<'_, AppState>, position: f64) -> Result<PlayerState, String> {
    state.player.seek(position).await;
    Ok(state.player.state())
}

#[tauri::command]
pub async fn set_volume(state: State<'_, AppState>, volume: f64) -> Result<PlayerState, String> {
    let volume = volume.clamp(0.0, 100.0);
    state.player.set_volume(volume).await;
    if let Ok(mut settings) = state.settings.write() {
        settings.volume = volume;
    }
    let _ = state.db.set_setting("volume", &format!("{volume:.1}"));
    Ok(state.player.state())
}

#[tauri::command]
pub fn get_player_state(state: State<'_, AppState>) -> PlayerState {
    state.player.state()
}

#[tauri::command]
pub async fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    state.player.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn get_cover(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<Option<String>, String> {
    let session = state.session();
    let (base_url, token) = match session {
        Some(session) => (Some(session.base_url), Some(session.token)),
        None => (None, None),
    };
    Ok(state
        .cache
        .cover_data_url(&track_id, base_url.as_deref(), token.as_deref())
        .await)
}

#[tauri::command]
pub fn cache_stats(state: State<'_, AppState>) -> CacheStats {
    state.cache.stats()
}

#[tauri::command]
pub fn clear_cache(state: State<'_, AppState>) -> Result<CacheStats, String> {
    state.cache.clear()
}

#[tauri::command]
pub fn delete_cached_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<CacheStats, String> {
    state.cache.delete_track(&track_id)
}

#[tauri::command]
pub async fn cache_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<(), String> {
    let track = if let Ok(Some(t)) = state.db.get_track(&track_id) {
        t
    } else {
        return Err("Трек не найден в каталоге".to_string());
    };

    let session = state.session().ok_or_else(|| "Телефон не подключен".to_string())?;
    state.cache.ensure_download(track, session.base_url, session.token);
    Ok(())
}

#[tauri::command]
pub fn set_cache_mode(state: State<'_, AppState>, mode: String) -> Result<String, String> {
    let mode = if mode == "manual" { "manual" } else { "auto" };
    state.db.set_setting("cache_mode", mode)?;
    if let Ok(mut settings) = state.settings.write() {
        settings.cache_mode = mode.to_string();
    }
    sync_to_config_json(state.inner());
    Ok(mode.to_string())
}

#[tauri::command]
pub fn open_cache_dir(state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.cache.audio_dir().to_path_buf();
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Не удалось открыть папку кэша: {e}"))
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    mpv_path: Option<String>,
) -> Result<Settings, String> {
    let mpv_path = mpv_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    let previous = state.settings().mpv_path;
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| "Настройки недоступны".to_string())?;
        settings.mpv_path = mpv_path.clone();
    }
    state
        .db
        .set_setting("mpv_path", mpv_path.as_deref().unwrap_or(""))?;
    if previous != mpv_path {
        state.player.set_mpv_path(mpv_path).await;
    }
    sync_to_config_json(state.inner());
    Ok(state.settings())
}

pub fn sync_to_config_json(state: &AppState) {
    let settings = state.settings();
    let is_overlay = state
        .db
        .get_setting("is_overlay")
        .map(|v| v == "true")
        .unwrap_or(false);
    let overlay_x = state
        .db
        .get_setting("overlay_pos_x")
        .and_then(|v| v.parse::<i32>().ok());
    let overlay_y = state
        .db
        .get_setting("overlay_pos_y")
        .and_then(|v| v.parse::<i32>().ok());

    let config = serde_json::json!({
        "theme": settings.theme,
        "volume": settings.volume,
        "mpvPath": settings.mpv_path,
        "cacheMode": settings.cache_mode,
        "overlay": {
            "alwaysOnTop": true,
            "isOverlay": is_overlay,
            "lastX": overlay_x,
            "lastY": overlay_y,
            "width": 380,
            "height": 140
        }
    });

    if let Ok(content) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write("config.json", &content);
        if let Some(app_data) = dirs::data_dir() {
            let config_dir = app_data.join("com.vibecast.desktop");
            let _ = std::fs::create_dir_all(&config_dir);
            let _ = std::fs::write(config_dir.join("config.json"), &content);
        }
    }
}

#[tauri::command]
pub fn set_theme(state: State<'_, AppState>, theme: String) -> Result<String, String> {
    let clean_theme = theme.trim().to_lowercase();
    state.db.set_setting("theme", &clean_theme)?;
    if let Ok(mut settings) = state.settings.write() {
        settings.theme = clean_theme.clone();
    }
    sync_to_config_json(state.inner());
    Ok(clean_theme)
}

#[tauri::command]
pub fn get_overlay_state(state: State<'_, AppState>) -> OverlayState {
    let is_overlay = state
        .db
        .get_setting("is_overlay")
        .map(|v| v == "true")
        .unwrap_or(false);
    let x = state
        .db
        .get_setting("overlay_pos_x")
        .and_then(|v| v.parse::<i32>().ok());
    let y = state
        .db
        .get_setting("overlay_pos_y")
        .and_then(|v| v.parse::<i32>().ok());
    OverlayState { is_overlay, x, y }
}

#[tauri::command]
pub async fn set_overlay_mode(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<OverlayState, String> {
    if enabled {
        if let Ok(pos) = window.outer_position() {
            let _ = state.db.set_setting("full_pos_x", &pos.x.to_string());
            let _ = state.db.set_setting("full_pos_y", &pos.y.to_string());
        }
        if let Ok(size) = window.outer_size() {
            let _ = state.db.set_setting("full_size_w", &size.width.to_string());
            let _ = state.db.set_setting("full_size_h", &size.height.to_string());
        }

        let _ = window.set_decorations(false);
        let _ = window.set_shadow(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_resizable(false);
        let _ = window.set_size(tauri::LogicalSize::new(390.0, 185.0));

        let saved_x = state
            .db
            .get_setting("overlay_pos_x")
            .and_then(|v| v.parse::<i32>().ok());
        let saved_y = state
            .db
            .get_setting("overlay_pos_y")
            .and_then(|v| v.parse::<i32>().ok());
        if let (Some(x), Some(y)) = (saved_x, saved_y) {
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }

        let _ = state.db.set_setting("is_overlay", "true");
        sync_to_config_json(state.inner());

        Ok(OverlayState {
            is_overlay: true,
            x: saved_x,
            y: saved_y,
        })
    } else {
        if let Ok(pos) = window.outer_position() {
            let _ = state.db.set_setting("overlay_pos_x", &pos.x.to_string());
            let _ = state.db.set_setting("overlay_pos_y", &pos.y.to_string());
        }

        let _ = window.set_always_on_top(false);
        let _ = window.set_shadow(true);
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);

        // Restore window to maximized (во весь экран)
        let _ = window.maximize();

        let _ = state.db.set_setting("is_overlay", "false");
        sync_to_config_json(state.inner());

        Ok(OverlayState {
            is_overlay: false,
            x: None,
            y: None,
        })
    }
}

#[tauri::command]
pub fn save_overlay_position(state: State<'_, AppState>, x: i32, y: i32) -> Result<(), String> {
    state.db.set_setting("overlay_pos_x", &x.to_string())?;
    state.db.set_setting("overlay_pos_y", &y.to_string())?;
    sync_to_config_json(state.inner());
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_compact(
    window: tauri::WebviewWindow,
    compact: bool,
) -> Result<(), String> {
    let _ = window.set_shadow(false);
    if compact {
        if let (Ok(pos), Ok(Some(monitor))) = (window.outer_position(), window.current_monitor()) {
            let scale = monitor.scale_factor();
            let screen_w = monitor.size().width as i32;
            let screen_h = monitor.size().height as i32;
            let target_w = (120.0 * scale) as i32;
            let target_h = (120.0 * scale) as i32;
            let margin = (4.0 * scale) as i32;

            let clamped_x = pos.x.clamp(margin, (screen_w - target_w - margin).max(margin));
            let clamped_y = pos.y.clamp(margin, (screen_h - target_h - margin - (35.0 * scale) as i32).max(margin));

            if clamped_x != pos.x || clamped_y != pos.y {
                let _ = window.set_position(tauri::PhysicalPosition::new(clamped_x, clamped_y));
            }
        }
        let _ = window.set_size(tauri::LogicalSize::new(120.0, 120.0));
    } else {
        if let (Ok(pos), Ok(Some(monitor))) = (window.outer_position(), window.current_monitor()) {
            let scale = monitor.scale_factor();
            let screen_w = monitor.size().width as i32;
            let screen_h = monitor.size().height as i32;
            let target_w = (390.0 * scale) as i32;
            let target_h = (185.0 * scale) as i32;
            let margin = (8.0 * scale) as i32;

            let clamped_x = pos.x.clamp(margin, (screen_w - target_w - margin).max(margin));
            let clamped_y = pos.y.clamp(margin, (screen_h - target_h - margin - (35.0 * scale) as i32).max(margin));

            if clamped_x != pos.x || clamped_y != pos.y {
                let _ = window.set_position(tauri::PhysicalPosition::new(clamped_x, clamped_y));
            }
        }
        let _ = window.set_size(tauri::LogicalSize::new(390.0, 185.0));
    }
    Ok(())
}

#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_config(state: State<'_, AppState>) -> AppConfig {
    let settings = state.settings();
    let is_overlay = state
        .db
        .get_setting("is_overlay")
        .map(|v| v == "true")
        .unwrap_or(false);
    let x = state
        .db
        .get_setting("overlay_pos_x")
        .and_then(|v| v.parse::<i32>().ok());
    let y = state
        .db
        .get_setting("overlay_pos_y")
        .and_then(|v| v.parse::<i32>().ok());

    let cache_mode = state
        .db
        .get_setting("cache_mode")
        .or_else(|| Some("auto".to_string()));

    AppConfig {
        theme: settings.theme,
        volume: settings.volume,
        mpv_path: settings.mpv_path,
        overlay: OverlayState { is_overlay, x, y },
        cache_mode,
    }
}

#[tauri::command]
pub async fn resync(app: AppHandle) -> Result<LibraryStats, String> {
    let stats = sync_catalog(&app).await?;
    emit_library(&app, &stats);
    Ok(stats)
}

/// Downloads every page of the phone library and replaces the local catalog in
/// one transaction. The connection epoch prevents an in-flight sync from
/// overwriting a newer connection.
pub async fn sync_catalog(app: &AppHandle) -> Result<LibraryStats, String> {
    let state = app.state::<AppState>();
    let _guard = state.sync_lock.lock().await;

    let session = state
        .session()
        .ok_or_else(|| "Нет подключения к телефону".to_string())?;
    let epoch = state.connection_epoch.load(Ordering::SeqCst);

    let (tracks, version) =
        catalog::fetch_library(&state.http, &session.base_url, &session.token).await?;

    if state.connection_epoch.load(Ordering::SeqCst) != epoch {
        return Err("Подключение изменилось во время синхронизации".to_string());
    }

    let stats = state.db.replace_tracks(&tracks, version)?;
    state.version.store(version, Ordering::SeqCst);
    state.track_count.store(stats.tracks, Ordering::SeqCst);
    state.set_online(app, true);
    state.emit_server(app);
    Ok(stats)
}

pub fn stop_sse(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.sse_generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = state.sse_task.lock() {
        if let Some(task) = guard.take() {
            task.abort();
        }
    };
}

/// Starts one SSE reader. A generation counter makes stale reconnect loops
/// exit after reconnect/disconnect.
pub fn restart_sse(app: &AppHandle) {
    let state = app.state::<AppState>();
    let generation = state.sse_generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut guard) = state.sse_task.lock() {
        if let Some(task) = guard.take() {
            task.abort();
        }
    };
    let app_handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        sse_loop(app_handle, generation).await;
    });
    if let Ok(mut guard) = state.sse_task.lock() {
        *guard = Some(task);
    };

    let app_remote = app.clone();
    tauri::async_runtime::spawn(async move {
        remote_control_loop(app_remote, generation).await;
    });

    let app_sync = app.clone();
    tauri::async_runtime::spawn(async move {
        remote_state_sync_loop(app_sync, generation).await;
    });
}

fn parse_sse_command(line: &str) -> Option<RemoteCommand> {
    let line = line.trim_end_matches('\r').trim();
    let data = line.strip_prefix("data:")?.trim();
    serde_json::from_str::<RemoteCommand>(data).ok()
}

async fn remote_control_loop(app: AppHandle, generation: u64) {
    loop {
        {
            let state = app.state::<AppState>();
            if state.sse_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if state.session().is_none() {
                return;
            }
        }

        let (client, base_url, token) = {
            let state = app.state::<AppState>();
            let Some(session) = state.session() else {
                return;
            };
            (state.http.clone(), session.base_url, session.token)
        };

        let response = client
            .get(format!("{}/remote/events", base_url.trim_end_matches('/')))
            .bearer_auth(&token)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .send()
            .await;

        if let Ok(response) = response {
            if response.status().is_success() {
                let mut stream = response.bytes_stream();
                let mut buffer = String::new();

                while let Some(chunk) = stream.next().await {
                    if app.state::<AppState>().sse_generation.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    let Ok(chunk) = chunk else { break; };
                    buffer.push_str(&String::from_utf8_lossy(&chunk));

                    while let Some(newline) = buffer.find('\n') {
                        let line: String = buffer.drain(..=newline).collect();
                        if let Some(cmd) = parse_sse_command(&line) {
                            let _ = app.emit("remote-control", cmd);
                        }
                    }
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn remote_state_sync_loop(app: AppHandle, generation: u64) {
    let mut last_sync = std::time::Instant::now();
    let mut last_hash = String::new();

    loop {
        {
            let state = app.state::<AppState>();
            if state.sse_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if state.session().is_none() {
                return;
            }
        }

        let (client, base_url, token, player_state) = {
            let state = app.state::<AppState>();
            let Some(session) = state.session() else {
                return;
            };
            let p = state.player.state();
            (state.http.clone(), session.base_url, session.token, p)
        };

        let hash = format!(
            "{:?}-{}-{}-{:?}",
            player_state.current_track_id, player_state.paused, player_state.volume, player_state.position.round()
        );

        if hash != last_hash || last_sync.elapsed().as_secs() >= 1 {
            last_hash = hash;
            last_sync = std::time::Instant::now();
            let _ = client
                .post(format!("{}/remote/state", base_url.trim_end_matches('/')))
                .bearer_auth(&token)
                .json(&player_state)
                .timeout(std::time::Duration::from_millis(1500))
                .send()
                .await;
        }

        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
}

#[tauri::command]
pub async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let client = &state.http;
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = "https://api.github.com/repos/Susich/VibeCast/releases/latest";

    let resp = client
        .get(url)
        .header("User-Agent", format!("VibeCast-Desktop/{}", current_version))
        .header("Accept", "application/vnd.github.v3+json")
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await;

    let response = match resp {
        Ok(r) => r,
        Err(e) => return Err(format!("Не удалось связаться с сервером обновлений: {e}")),
    };

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            has_update: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            release_url: "https://github.com/Susich/VibeCast".to_string(),
            download_url: None,
            release_notes: Some("У вас установлена актуальная версия.".to_string()),
        });
    }

    if !response.status().is_success() {
        return Err(format!("GitHub API вернул статус {}", response.status().as_u16()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Неверный ответ GitHub API: {e}"))?;

    let tag_name = json.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").trim_start_matches('v').to_string();
    let release_url = json.get("html_url").and_then(|v| v.as_str()).unwrap_or("https://github.com/Susich/VibeCast").to_string();
    let release_notes = json.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());

    let mut download_url = None;
    if let Some(assets) = json.get("assets").and_then(|v| v.as_array()) {
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(|v| v.as_str()) {
                if name.ends_with(".exe") {
                    download_url = asset.get("browser_download_url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    break;
                }
            }
        }
    }

    let has_update = is_newer_version(&tag_name, &current_version);

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: if tag_name.is_empty() { env!("CARGO_PKG_VERSION").to_string() } else { tag_name },
        release_url,
        download_url,
        release_notes,
    })
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    if latest.is_empty() || latest == current {
        return false;
    }
    let parse_parts = |s: &str| -> Vec<u32> {
        s.split('.')
            .filter_map(|p| p.parse::<u32>().ok())
            .collect()
    };
    let l_parts = parse_parts(latest);
    let c_parts = parse_parts(current);
    for i in 0..l_parts.len().max(c_parts.len()) {
        let l = l_parts.get(i).copied().unwrap_or(0);
        let c = c_parts.get(i).copied().unwrap_or(0);
        if l > c { return true; }
        if l < c { return false; }
    }
    false
}

async fn sse_loop(app: AppHandle, generation: u64) {
    loop {
        {
            let state = app.state::<AppState>();
            if state.sse_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            if state.session().is_none() {
                return;
            }
        }

        let (client, base_url, token) = {
            let state = app.state::<AppState>();
            let Some(session) = state.session() else {
                return;
            };
            (state.http.clone(), session.base_url, session.token)
        };

        let response = client
            .get(format!("{}/events", base_url.trim_end_matches('/')))
            .bearer_auth(&token)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                {
                    let state = app.state::<AppState>();
                    state.set_online(&app, true);
                }

                let mut stream = response.bytes_stream();
                let mut buffer = String::new();

                while let Some(chunk) = stream.next().await {
                    if app
                        .state::<AppState>()
                        .sse_generation
                        .load(Ordering::SeqCst)
                        != generation
                    {
                        return;
                    }
                    let Ok(chunk) = chunk else {
                        break;
                    };
                    buffer.push_str(&String::from_utf8_lossy(&chunk));

                    while let Some(newline) = buffer.find('\n') {
                        let line: String = buffer.drain(..=newline).collect();
                        let Some(event) = catalog::parse_sse_data(&line) else {
                            continue;
                        };
                        let current = app.state::<AppState>().version.load(Ordering::SeqCst);
                        if event.version != current {
                            match sync_catalog(&app).await {
                                Ok(stats) => emit_library(&app, &stats),
                                Err(err) => toast(
                                    &app,
                                    format!("Не удалось обновить библиотеку: {err}"),
                                    "error",
                                ),
                            }
                        }
                    }
                }
            }
            Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
                let state = app.state::<AppState>();
                state.set_online(&app, false);
                toast(
                    &app,
                    "Телефон отклонил токен. Подключитесь заново и скопируйте токен с телефона.",
                    "error",
                );
                return;
            }
            Ok(_) => {
                app.state::<AppState>().set_online(&app, false);
            }
            Err(_) => {
                app.state::<AppState>().set_online(&app, false);
            }
        }

        app.state::<AppState>().set_online(&app, false);
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}
