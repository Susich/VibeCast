mod cache;
mod catalog;
mod commands;
mod db;
mod discovery;
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::connect_manual,
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
            commands::open_cache_dir,
            commands::update_settings,
            commands::resync,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build VibeCast");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(app_handle.state::<AppState>().player.shutdown());
        }
    });
}
