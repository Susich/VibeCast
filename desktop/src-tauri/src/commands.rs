use std::sync::atomic::Ordering;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::catalog::{self, normalize_base};
use crate::models::{
    Bootstrap, CacheStats, Facets, LibraryStats, PlayerState, SearchQuery, SearchResult,
    ServerSession, ServerView, Settings, Toast,
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
    let track = state
        .db
        .get_track(&track_id)?
        .ok_or_else(|| "Трек не найден в каталоге".to_string())?;

    let cached = state.cache.cached_path(&track);
    let session = state.session();

    let (uri, remote, token, download) = match cached {
        Some(path) => (path.to_string_lossy().to_string(), false, None, None),
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
        state
            .cache
            .ensure_download(track.clone(), session.base_url, session.token);
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
    Ok(state.settings())
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
