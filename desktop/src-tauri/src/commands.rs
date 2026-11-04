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
    let mut token = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(token_from_url);

    if token.is_none() {
        if let Ok(health) = catalog::health(&state.http, &base_url).await {
            token = health.token;
        }
    }

    let token_str = token.unwrap_or_default();
    apply_connection(&app, state.inner(), base_url, token_str, true).await
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
    let (base_url, token_from_url) = normalize_base(&url)?;
    let saved_token = state
        .session()
        .map(|s| s.token)
        .or(token_from_url);

    let token = match saved_token {
        Some(t) if !t.is_empty() => t,
        _ => {
            if let Ok(health) = catalog::health(&state.http, &base_url).await {
                health.token.unwrap_or_default()
            } else {
                String::new()
            }
        }
    };
    apply_connection(&app, state.inner(), base_url, token, false).await
}

async fn apply_connection(
    app: &AppHandle,
    state: &AppState,
    base_url: String,
    token: String,
    reset_on_base_change: bool,
) -> Result<ServerView, String> {
    let health = catalog::validate_token(&state.http, &base_url, &token).await?;
    let effective_token = if !token.is_empty() {
        token
    } else {
        health.token.clone().unwrap_or_default()
    };

    let previous_base = state.session().map(|session| session.base_url);
    let base_changed = previous_base.as_deref() != Some(base_url.as_str());
    let session = ServerSession {
        base_url: base_url.clone(),
        token: effective_token,
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
    // Сохраняем метаданные кэшированных треков перед сбросом каталога
    let cached_ids = state.cache.all_cached_ids();
    let _ = state.db.sync_cached_tracks_from_library(&cached_ids);
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
                    let _ = state.db.save_cached_track(&t);
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
            Some("added") => tracks.sort_by(|a, b| b.track.date_modified.cmp(&a.track.date_modified)),
            Some("oldest") => tracks.sort_by(|a, b| a.track.date_modified.cmp(&b.track.date_modified)),
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
            let _ = state.db.save_cached_track(&track);
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
    let _ = state.db.clear_cached_tracks();
    state.cache.clear()
}

#[tauri::command]
pub fn delete_cached_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<CacheStats, String> {
    let _ = state.db.delete_cached_track(&track_id);
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

    let _ = state.db.save_cached_track(&track);
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
        .get_setting("circle_pos_x")
        .or_else(|| state.db.get_setting("overlay_pos_x"))
        .and_then(|v| v.parse::<i32>().ok());
    let overlay_y = state
        .db
        .get_setting("circle_pos_y")
        .or_else(|| state.db.get_setting("overlay_pos_y"))
        .and_then(|v| v.parse::<i32>().ok());

    let config = serde_json::json!({
        "theme": settings.theme,
        "volume": settings.volume,
        "mpvPath": settings.mpv_path,
        "cacheMode": settings.cache_mode,
        "expandOnHotkey": settings.expand_on_hotkey,
        "hotkeys": settings.hotkeys,
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
pub fn set_expand_on_hotkey(
    state: State<'_, AppState>,
    expand: bool,
) -> Result<bool, String> {
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| "Настройки недоступны".to_string())?;
        settings.expand_on_hotkey = expand;
    }
    state.db.set_setting("expand_on_hotkey", &expand.to_string())?;
    sync_to_config_json(state.inner());
    Ok(expand)
}

#[tauri::command]
pub fn save_hotkeys(
    state: State<'_, AppState>,
    hotkeys: crate::models::HotkeyConfig,
) -> Result<crate::models::HotkeyConfig, String> {
    let json_str = serde_json::to_string(&hotkeys).map_err(|e| e.to_string())?;
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| "Настройки недоступны".to_string())?;
        settings.hotkeys = hotkeys.clone();
    }
    state.db.set_setting("hotkeys", &json_str)?;
    sync_to_config_json(state.inner());
    crate::hotkeys::reload_hotkeys();
    Ok(hotkeys)
}

#[tauri::command]
pub fn get_hotkeys(state: State<'_, AppState>) -> crate::models::HotkeyConfig {
    state.hotkeys()
}

#[tauri::command]
pub fn pause_hotkeys(pause: bool) {
    crate::hotkeys::set_hotkeys_paused(pause);
}

#[tauri::command]
pub async fn get_track_audio(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<tauri::ipc::Response, String> {
    if let Some(path) = state.cache.cached_path_for_id(&track_id) {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Не удалось прочитать кэшированный трек: {e}"))?;
        return Ok(tauri::ipc::Response::new(bytes));
    }

    let track = state
        .db
        .get_track(&track_id)?
        .ok_or_else(|| "Трек не найден".to_string())?;
    let session = state
        .session()
        .ok_or_else(|| "Телефон недоступен".to_string())?;
    let url = format!("{}/stream/{}", session.base_url.trim_end_matches('/'), track.id);
    let resp = state
        .http
        .get(&url)
        .header("Authorization", format!("Bearer {}", session.token))
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки аудио: {e}"))?;

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения потока: {e}"))?;

    Ok(tauri::ipc::Response::new(bytes.to_vec()))
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
            if pos.x > -10000 && pos.y > -10000 {
                let _ = state.db.set_setting("full_pos_x", &pos.x.to_string());
                let _ = state.db.set_setting("full_pos_y", &pos.y.to_string());
            }
        }
        if let Ok(size) = window.outer_size() {
            if size.width > 50 && size.height > 50 {
                let _ = state.db.set_setting("full_size_w", &size.width.to_string());
                let _ = state.db.set_setting("full_size_h", &size.height.to_string());
            }
        }

        // Cleanly clear maximize state before turning into a compact borderless overlay
        let _ = window.unmaximize();
        let _ = window.set_decorations(false);
        let _ = window.set_shadow(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_resizable(true);

        let monitor = window.current_monitor().ok().flatten();
        let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
        let mon_pos = monitor
            .as_ref()
            .map(|m| m.position().clone())
            .unwrap_or(tauri::PhysicalPosition::new(0, 0));
        let mon_size = monitor
            .as_ref()
            .map(|m| m.size().clone())
            .unwrap_or(tauri::PhysicalSize::new(1920, 1080));

        let margin = (24.0 * scale).round() as i32;
        let bottom_margin = (48.0 * scale).round() as i32;

        let card_w = (390.0 * scale).round() as i32;
        let card_h = (185.0 * scale).round() as i32;
        let circle_w = (120.0 * scale).round() as i32;
        let circle_h = (120.0 * scale).round() as i32;

        // Default position for the very first collapse: TOP-LEFT of the screen
        let default_pos = default_overlay_pos(&window);
        let default_card_x = default_pos.x;
        let default_card_y = default_pos.y;

        let saved_card_x = state
            .db
            .get_setting("overlay_pos_x")
            .and_then(|v| v.parse::<i32>().ok())
            .filter(|&v| v > -10000);
        let saved_card_y = state
            .db
            .get_setting("overlay_pos_y")
            .and_then(|v| v.parse::<i32>().ok())
            .filter(|&v| v > -10000);

        let (target_card_x, target_card_y) = match (saved_card_x, saved_card_y) {
            (Some(x), Some(y)) => (x, y),
            _ => {
                let saved_cx = state
                    .db
                    .get_setting("circle_pos_x")
                    .and_then(|v| v.parse::<i32>().ok())
                    .filter(|&v| v > -10000);
                let saved_cy = state
                    .db
                    .get_setting("circle_pos_y")
                    .and_then(|v| v.parse::<i32>().ok())
                    .filter(|&v| v > -10000);
                match (saved_cx, saved_cy) {
                    (Some(cx), Some(cy)) => {
                        (cx - (card_w - circle_w) / 2, cy - (card_h - circle_h) / 2)
                    }
                    _ => (default_card_x, default_card_y),
                }
            }
        };

        let min_x = mon_pos.x + margin;
        let max_x = (mon_pos.x + mon_size.width as i32 - card_w - margin).max(min_x);
        let min_y = mon_pos.y + margin;
        let max_y = (mon_pos.y + mon_size.height as i32 - card_h - bottom_margin).max(min_y);

        let final_card_x = target_card_x.clamp(min_x, max_x);
        let final_card_y = target_card_y.clamp(min_y, max_y);

        let circle_x = final_card_x + (card_w - circle_w) / 2;
        let circle_y = final_card_y + (card_h - circle_h) / 2;

        // Opens FIRST as the big widget (390x185)
        let _ = window.set_size(tauri::LogicalSize::new(390.0, 185.0));
        let _ = window.set_position(tauri::PhysicalPosition::new(final_card_x, final_card_y));

        let _ = state.db.set_setting("overlay_pos_x", &final_card_x.to_string());
        let _ = state.db.set_setting("overlay_pos_y", &final_card_y.to_string());
        let _ = state.db.set_setting("circle_pos_x", &circle_x.to_string());
        let _ = state.db.set_setting("circle_pos_y", &circle_y.to_string());
        let _ = state.db.set_setting("expanded_from_circle_x", &circle_x.to_string());
        let _ = state.db.set_setting("expanded_from_circle_y", &circle_y.to_string());
        let _ = state.db.set_setting("card_dragged_since_expanded", "false");
        let _ = state.db.set_setting("overlay_compact", "false");
        let _ = state.db.set_setting("is_overlay", "true");
        sync_to_config_json(state.inner());

        Ok(OverlayState {
            is_overlay: true,
            x: Some(final_card_x),
            y: Some(final_card_y),
        })
    } else {
        if let Ok(pos) = window.outer_position() {
            if pos.x > -10000 && pos.y > -10000 {
                let _ = state.db.set_setting("overlay_pos_x", &pos.x.to_string());
                let _ = state.db.set_setting("overlay_pos_y", &pos.y.to_string());
            }
        }

        // Immediately update DB is_overlay so any concurrent set_overlay_compact calls exit immediately
        let _ = state.db.set_setting("is_overlay", "false");
        sync_to_config_json(state.inner());

        let _ = window.unmaximize();
        let _ = window.set_always_on_top(false);
        let _ = window.set_shadow(true);
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);

        // Ensure proper baseline restore geometry before maximizing
        let _ = window.set_size(tauri::LogicalSize::new(1200.0, 680.0));
        let _ = window.center();

        // Restore window to maximized (во весь экран)
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();

        Ok(OverlayState {
            is_overlay: false,
            x: None,
            y: None,
        })
    }
}

fn default_overlay_pos(window: &tauri::WebviewWindow) -> tauri::PhysicalPosition<i32> {
    if let Ok(Some(mon)) = window.current_monitor() {
        let scale = mon.scale_factor();
        let mon_pos = mon.position();
        let margin = (24.0 * scale).round() as i32;
        tauri::PhysicalPosition::new(mon_pos.x + margin, mon_pos.y + margin)
    } else {
        tauri::PhysicalPosition::new(24, 24)
    }
}

#[tauri::command]
pub fn save_overlay_position(state: State<'_, AppState>, x: i32, y: i32) -> Result<(), String> {
    if x <= -10000 || y <= -10000 {
        return Ok(());
    }
    state.db.set_setting("overlay_pos_x", &x.to_string())?;
    state.db.set_setting("overlay_pos_y", &y.to_string())?;
    sync_to_config_json(state.inner());
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_compact(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    compact: bool,
) -> Result<(), String> {
    let is_overlay = state
        .db
        .get_setting("is_overlay")
        .map(|v| v == "true")
        .unwrap_or(false);
    // Never resize if overlay mode is turned off!
    if !is_overlay {
        return Ok(());
    }

    if window.is_minimized().unwrap_or(false) {
        return Ok(());
    }

    let _ = window.set_resizable(true);
    let _ = window.set_shadow(false);

    let monitor = window.current_monitor().ok().flatten();
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let mon_pos = monitor
        .as_ref()
        .map(|m| m.position().clone())
        .unwrap_or(tauri::PhysicalPosition::new(0, 0));
    let mon_size = monitor
        .as_ref()
        .map(|m| m.size().clone())
        .unwrap_or(tauri::PhysicalSize::new(1920, 1080));

    let margin = (12.0 * scale).round() as i32;
    let bottom_margin = (48.0 * scale).round() as i32;

    let circle_w = (120.0 * scale).round() as i32;
    let circle_h = (120.0 * scale).round() as i32;
    let card_w = (390.0 * scale).round() as i32;
    let card_h = (185.0 * scale).round() as i32;

    let cur_pos = window
        .outer_position()
        .unwrap_or(tauri::PhysicalPosition::new(100, 100));

    if compact {
        // COLLAPSING TO CIRCLE:
        state.db.set_setting("overlay_compact", "true")?;

        let was_dragged = state
            .db
            .get_setting("card_dragged_since_expanded")
            .map(|v| v == "true")
            .unwrap_or(false);

        let (target_x, target_y) = if !was_dragged {
            // Restore EXACTLY to where the user expanded it from!
            let exp_x = state.db.get_setting("expanded_from_circle_x").and_then(|s| s.parse::<i32>().ok());
            let exp_y = state.db.get_setting("expanded_from_circle_y").and_then(|s| s.parse::<i32>().ok());
            match (exp_x, exp_y) {
                (Some(ex), Some(ey)) if ex > -10000 && ey > -10000 => (ex, ey),
                _ => (
                    cur_pos.x + (card_w - circle_w) / 2,
                    cur_pos.y + (card_h - circle_h) / 2,
                ),
            }
        } else {
            let saved_cx = state.db.get_setting("circle_pos_x").and_then(|s| s.parse::<i32>().ok());
            let saved_cy = state.db.get_setting("circle_pos_y").and_then(|s| s.parse::<i32>().ok());
            match (saved_cx, saved_cy) {
                (Some(cx), Some(cy)) if cx > -10000 && cy > -10000 => (cx, cy),
                _ => (
                    cur_pos.x + (card_w - circle_w) / 2,
                    cur_pos.y + (card_h - circle_h) / 2,
                ),
            }
        };

        let min_x = mon_pos.x + margin;
        let max_x = (mon_pos.x + mon_size.width as i32 - circle_w - margin).max(min_x);
        let min_y = mon_pos.y + margin;
        let max_y = (mon_pos.y + mon_size.height as i32 - circle_h - bottom_margin).max(min_y);

        let clamped_x = target_x.clamp(min_x, max_x);
        let clamped_y = target_y.clamp(min_y, max_y);

        let _ = state.db.set_setting("circle_pos_x", &clamped_x.to_string());
        let _ = state.db.set_setting("circle_pos_y", &clamped_y.to_string());

        let _ = window.set_position(tauri::PhysicalPosition::new(clamped_x, clamped_y));
        let _ = window.set_size(tauri::LogicalSize::new(120.0, 120.0));
    } else {
        // EXPANDING TO CARD:
        let circle_x = if cur_pos.x > -10000 && cur_pos.y > -10000 {
            cur_pos.x
        } else {
            state.db.get_setting("circle_pos_x").and_then(|s| s.parse::<i32>().ok()).unwrap_or(cur_pos.x)
        };
        let circle_y = if cur_pos.y > -10000 && cur_pos.y > -10000 {
            cur_pos.y
        } else {
            state.db.get_setting("circle_pos_y").and_then(|s| s.parse::<i32>().ok()).unwrap_or(cur_pos.y)
        };

        let _ = state.db.set_setting("circle_pos_x", &circle_x.to_string());
        let _ = state.db.set_setting("circle_pos_y", &circle_y.to_string());
        let _ = state.db.set_setting("expanded_from_circle_x", &circle_x.to_string());
        let _ = state.db.set_setting("expanded_from_circle_y", &circle_y.to_string());
        let _ = state.db.set_setting("card_dragged_since_expanded", "false");
        state.db.set_setting("overlay_compact", "false")?;

        // Center expanded card on the circle
        let center_x = circle_x + circle_w / 2;
        let center_y = circle_y + circle_h / 2;

        let desired_card_x = center_x - card_w / 2;
        let desired_card_y = center_y - card_h / 2;

        let min_x = mon_pos.x + margin;
        let max_x = mon_pos.x + (mon_size.width as i32 - card_w - margin).max(0);
        let min_y = mon_pos.y + margin;
        let max_y = mon_pos.y + (mon_size.height as i32 - card_h - bottom_margin).max(0);

        let clamped_x = desired_card_x.clamp(min_x, max_x);
        let clamped_y = desired_card_y.clamp(min_y, max_y);

        let _ = state.db.set_setting("overlay_pos_x", &clamped_x.to_string());
        let _ = state.db.set_setting("overlay_pos_y", &clamped_y.to_string());

        // Resize FIRST so window has full bounds for content, then move
        let _ = window.set_size(tauri::LogicalSize::new(390.0, 185.0));
        let _ = window.set_position(tauri::PhysicalPosition::new(clamped_x, clamped_y));
    }

    sync_to_config_json(state.inner());
    Ok(())
}

#[cfg(target_os = "windows")]
mod win32_drag {
    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct RECT {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    pub struct MONITORINFO {
        pub cb_size: u32,
        pub rc_monitor: RECT,
        pub rc_work: RECT,
        pub dw_flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetCursorPos(lpPoint: *mut POINT) -> i32;
        pub fn GetAsyncKeyState(vKey: i32) -> i16;
        pub fn ClipCursor(lpRect: *const RECT) -> i32;
        pub fn MonitorFromPoint(pt: POINT, dwFlags: u32) -> *mut std::ffi::c_void;
        pub fn GetMonitorInfoW(hMonitor: *mut std::ffi::c_void, lpmi: *mut MONITORINFO) -> i32;
    }

    pub struct ClipCursorGuard;
    impl Drop for ClipCursorGuard {
        fn drop(&mut self) {
            unsafe {
                ClipCursor(std::ptr::null());
            }
        }
    }
}

#[tauri::command]
pub async fn start_clamped_drag(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use win32_drag::*;

        // Check if left mouse button is still pressed
        unsafe {
            if (GetAsyncKeyState(0x01 /* VK_LBUTTON */) as u16 & 0x8000) == 0 {
                return Ok(false);
            }
        }

        let mut cursor = POINT::default();
        unsafe {
            GetCursorPos(&mut cursor);
        }

        let win_pos = match window.outer_position() {
            Ok(p) => p,
            Err(_) => return Ok(false),
        };
        let win_size = match window.outer_size() {
            Ok(s) => s,
            Err(_) => return Ok(false),
        };

        let grab_offset_x = cursor.x - win_pos.x;
        let grab_offset_y = cursor.y - win_pos.y;

        let mut mi = MONITORINFO {
            cb_size: std::mem::size_of::<MONITORINFO>() as u32,
            rc_monitor: RECT::default(),
            rc_work: RECT::default(),
            dw_flags: 0,
        };
        unsafe {
            let h_mon = MonitorFromPoint(cursor, 2 /* MONITOR_DEFAULTTONEAREST */);
            GetMonitorInfoW(h_mon, &mut mi);
        }

        let work_left = mi.rc_work.left;
        let work_top = mi.rc_work.top;
        let work_right = mi.rc_work.right;
        let work_bottom = mi.rc_work.bottom;

        let win_w = win_size.width as i32;
        let win_h = win_size.height as i32;

        let min_win_x = work_left;
        let max_win_x = (work_right - win_w).max(min_win_x);
        let min_win_y = work_top;
        let max_win_y = (work_bottom - win_h).max(min_win_y);

        // Clip cursor so the user physically cannot push the widget past screen edges,
        // and cursor never drifts off the widget.
        let clip_rect = RECT {
            left: min_win_x + grab_offset_x,
            top: min_win_y + grab_offset_y,
            right: max_win_x + grab_offset_x + 1,
            bottom: max_win_y + grab_offset_y + 1,
        };

        let _guard = ClipCursorGuard;
        unsafe {
            ClipCursor(&clip_rect);
        }

        let mut last_win_x = win_pos.x;
        let mut last_win_y = win_pos.y;

        while unsafe { (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0 } {
            if !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false) {
                break;
            }

            unsafe {
                GetCursorPos(&mut cursor);
            }

            let target_win_x = (cursor.x - grab_offset_x).clamp(min_win_x, max_win_x);
            let target_win_y = (cursor.y - grab_offset_y).clamp(min_win_y, max_win_y);

            if target_win_x != last_win_x || target_win_y != last_win_y {
                let _ = window.set_position(tauri::PhysicalPosition::new(target_win_x, target_win_y));
                last_win_x = target_win_x;
                last_win_y = target_win_y;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(4)).await;
        }

        // _guard is dropped here, calling ClipCursor(NULL) automatically

        let is_compact = state
            .db
            .get_setting("overlay_compact")
            .map(|v| v == "true")
            .unwrap_or(false);

        let scale = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);

        if is_compact {
            let _ = state.db.set_setting("circle_pos_x", &last_win_x.to_string());
            let _ = state.db.set_setting("circle_pos_y", &last_win_y.to_string());
            let _ = state.db.set_setting("expanded_from_circle_x", &last_win_x.to_string());
            let _ = state.db.set_setting("expanded_from_circle_y", &last_win_y.to_string());
            let _ = state.db.set_setting("card_dragged_since_expanded", "false");
            // Synchronize card center to match this circle position
            let target_card_w = (390.0 * scale).round() as i32;
            let target_card_h = (185.0 * scale).round() as i32;
            let cx = last_win_x + win_w / 2 - target_card_w / 2;
            let cy = last_win_y + win_h / 2 - target_card_h / 2;
            let _ = state.db.set_setting("overlay_pos_x", &cx.to_string());
            let _ = state.db.set_setting("overlay_pos_y", &cy.to_string());
        } else {
            let _ = state.db.set_setting("card_dragged_since_expanded", "true");
            let _ = state.db.set_setting("overlay_pos_x", &last_win_x.to_string());
            let _ = state.db.set_setting("overlay_pos_y", &last_win_y.to_string());
            // Synchronize circle center to match this card position
            let target_circle_w = (120.0 * scale).round() as i32;
            let target_circle_h = (120.0 * scale).round() as i32;
            let cx = last_win_x + win_w / 2 - target_circle_w / 2;
            let cy = last_win_y + win_h / 2 - target_circle_h / 2;
            let _ = state.db.set_setting("circle_pos_x", &cx.to_string());
            let _ = state.db.set_setting("circle_pos_y", &cy.to_string());
            let _ = state.db.set_setting("expanded_from_circle_x", &cx.to_string());
            let _ = state.db.set_setting("expanded_from_circle_y", &cy.to_string());
        }
        sync_to_config_json(state.inner());

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.start_dragging();
        Ok(true)
    }
}

#[tauri::command]
pub async fn start_window_drag(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    start_clamped_drag(window, state).await
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
    let cached_ids = state.cache.all_cached_ids();
    let _ = state.db.sync_cached_tracks_from_library(&cached_ids);
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

#[tauri::command]
pub async fn get_equalizer(
    state: State<'_, AppState>,
) -> Result<crate::models::EqualizerState, String> {
    Ok(state.settings().equalizer)
}

#[tauri::command]
pub async fn set_equalizer(
    state: State<'_, AppState>,
    equalizer: crate::models::EqualizerState,
) -> Result<crate::models::EqualizerState, String> {
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| "Настройки недоступны".to_string())?;
        settings.equalizer = equalizer.clone();
    }
    let serialized = serde_json::to_string(&equalizer).map_err(|e| e.to_string())?;
    state.db.set_setting("equalizer", &serialized)?;
    state.player.set_equalizer(equalizer.enabled, &equalizer.gains).await;
    sync_to_config_json(state.inner());
    Ok(equalizer)
}

#[tauri::command]
pub async fn apply_equalizer_live(
    state: State<'_, AppState>,
    enabled: bool,
    gains: Vec<f64>,
) -> Result<(), String> {
    state.player.set_equalizer(enabled, &gains).await;
    Ok(())
}

#[tauri::command]
pub async fn set_minimize_to_tray(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    {
        let mut settings = state
            .settings
            .write()
            .map_err(|_| "Настройки недоступны".to_string())?;
        settings.minimize_to_tray = enabled;
    }
    state
        .db
        .set_setting("minimize_to_tray", if enabled { "true" } else { "false" })?;
    sync_to_config_json(state.inner());
    Ok(enabled)
}


