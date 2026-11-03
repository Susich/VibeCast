mod audio_dsp;
mod cache;
mod catalog;
mod commands;
mod db;
mod discovery;
mod hotkeys;
mod models;
mod mpv;
mod state;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let app = tauri::Builder::default()
        .setup(|app| {
            // The window is deliberately compact for 125%-scaled 1366x768 /
            // 1536x864 screens. DPI awareness itself comes from app.manifest.
            let handle = app.handle().clone();
            let state = AppState::new(&handle).map_err(|err| {
                std::io::Error::new(std::io::ErrorKind::Other, format!("VibeCast: {err}"))
            })?;
            let has_session = state.session().is_some();
            handle.manage(state);

            if has_session {
                // Show the cached catalog immediately, then refresh in the
                // background. SSE keeps it current after reconnect.
                commands::restart_sse(&handle);
                let background = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = commands::sync_catalog(&background).await {
                        log::warn!("initial sync failed: {err}");
                    }
                });
            }

            // Always launch as the normal full application window
            let _ = handle.state::<AppState>().db.set_setting("is_overlay", "false");
            let _ = handle.state::<AppState>().db.set_setting("overlay_compact", "false");

            hotkeys::start_global_hotkeys(handle.clone());

            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Drag positioning and boundaries are managed cleanly and clamped by start_clamped_drag
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::connect_manual,
            commands::connect_saved,
            commands::disconnect,
            commands::search_tracks,
            commands::facets,
            commands::play_track,
            commands::toggle_pause,
            commands::set_pause,
            commands::seek,
            commands::set_volume,
            commands::get_player_state,
            commands::stop_playback,
            commands::get_cover,
            commands::cache_stats,
            commands::clear_cache,
            commands::delete_cached_track,
            commands::cache_track,
            commands::set_cache_mode,
            commands::open_cache_dir,
            commands::update_settings,
            commands::resync,
            commands::set_theme,
            commands::set_expand_on_hotkey,
            commands::save_hotkeys,
            commands::get_hotkeys,
            commands::pause_hotkeys,
            commands::get_track_audio,
            commands::set_overlay_mode,
            commands::set_overlay_compact,
            commands::save_overlay_position,
            commands::start_window_drag,
            commands::start_clamped_drag,
            commands::get_overlay_state,
            commands::get_app_config,
            commands::check_for_updates,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build VibeCast");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(app_handle.state::<AppState>().player.shutdown());
        }
    });
}
