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

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    #[cfg(target_os = "windows")]
    {
        // Disable background throttling and occlusion pausing in WebView2 so timers and
        // overlay transitions work reliably without delay, even when games/apps are fullscreen.
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGS").unwrap_or_default();
        let flags = "--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding";
        let combined = if existing.is_empty() {
            flags.to_string()
        } else {
            format!("{} {}", existing, flags)
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGS", combined);
    }

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

            // Overlay topmost watchdog: periodically ensures the overlay stays on top
            // of fullscreen apps, borderless games, and other topmost windows without stealing focus.
            let watchdog_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
                    let is_overlay = watchdog_handle
                        .try_state::<AppState>()
                        .and_then(|s| s.db.get_setting("is_overlay"))
                        .map(|v| v == "true")
                        .unwrap_or(false);

                    if is_overlay {
                        if let Some(w) = watchdog_handle.get_webview_window("main") {
                            if !w.is_minimized().unwrap_or(false) && w.is_visible().unwrap_or(false) {
                                #[cfg(target_os = "windows")]
                                if let Ok(hwnd) = w.hwnd() {
                                    commands::win32_overlay::bring_to_topmost(hwnd.0 as *mut _);
                                }
                            }
                        }
                    }
                }
            });

            // Setup system tray
            if let Some(icon) = app.default_window_icon().cloned() {
                let play_item = MenuItem::with_id(app, "play_pause", "Воспроизведение / Пауза", true, None::<&str>)?;
                let next_item = MenuItem::with_id(app, "next", "Следующий трек", true, None::<&str>)?;
                let show_item = MenuItem::with_id(app, "show", "Показать VibeCast", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&play_item, &next_item, &show_item, &quit_item])?;

                let _tray = TrayIconBuilder::new()
                    .icon(icon)
                    .tooltip("VibeCast")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "play_pause" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app_handle.state::<AppState>();
                                state.player.toggle_pause().await;
                            });
                        }
                        "next" => {
                            let _ = app.emit("player://tray-next", ());
                        }
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                                let _ = app.emit("window://restored", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                                let _ = app.emit("window://restored", ());
                            }
                        }
                    })
                    .build(app);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle();
                    let minimize = app
                        .try_state::<AppState>()
                        .map(|s| s.settings().minimize_to_tray)
                        .unwrap_or(true);
                    if minimize {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Focused(true) => {
                    let _ = window.emit("window://restored", ());
                }
                _ => {}
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
            commands::start_clamped_drag,
            commands::get_overlay_state,
            commands::get_app_config,
            commands::check_for_updates,
            commands::get_equalizer,
            commands::set_equalizer,
            commands::apply_equalizer_live,
            commands::set_minimize_to_tray,
            commands::set_crossfade_duration,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build VibeCast");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(app_handle.state::<AppState>().player.shutdown());
        }
    });
}
