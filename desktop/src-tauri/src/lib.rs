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

            hotkeys::start_global_hotkeys(handle.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Moved(pos) = event {
                // In Windows, minimized windows have negative off-screen positions (e.g. -32000, -32000).
                // Never clamp, reposition, or save position while minimized or hidden, otherwise it causes
                // recursive message loop deadlock (AppHang) and destroys the restore coordinates.
                if window.is_minimized().unwrap_or(false)
                    || pos.x <= -10000
                    || pos.y <= -10000
                    || !window.is_visible().unwrap_or(true)
                {
                    return;
                }

                let state = window.state::<AppState>();
                let is_overlay = state
                    .db
                    .get_setting("is_overlay")
                    .map(|v| v == "true")
                    .unwrap_or(false);

                if is_overlay {
                    if let (Ok(size), Ok(Some(monitor))) = (window.outer_size(), window.current_monitor()) {
                        let win_w = size.width as i32;
                        let win_h = size.height as i32;

                        if win_w > 50 && win_h > 50 {
                            let scale = monitor.scale_factor();
                            let screen_w = monitor.size().width as i32;
                            let screen_h = monitor.size().height as i32;
                            let margin = (4.0 * scale) as i32;

                            let clamped_x = pos.x.clamp(margin, (screen_w - win_w - margin).max(margin));
                            let clamped_y = pos.y.clamp(margin, (screen_h - win_h - margin - (35.0 * scale) as i32).max(margin));

                            if clamped_x != pos.x || clamped_y != pos.y {
                                let _ = window.set_position(tauri::PhysicalPosition::new(clamped_x, clamped_y));
                            }
                            let _ = state.db.set_setting("overlay_pos_x", &clamped_x.to_string());
                            let _ = state.db.set_setting("overlay_pos_y", &clamped_y.to_string());
                        }
                    }
                }
            }
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
