use tauri::{AppHandle, Emitter};

pub fn start_global_hotkeys(app: AppHandle) {
    #[cfg(target_os = "windows")]
    {
        std::thread::Builder::new()
            .name("global-hotkeys".to_string())
            .spawn(move || {
                run_windows_hotkey_loop(app);
            })
            .expect("failed to spawn global hotkeys thread");
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "windows")]
fn run_windows_hotkey_loop(app: AppHandle) {
    #[link(name = "user32")]
    extern "system" {
        fn RegisterHotKey(hwnd: *mut std::ffi::c_void, id: i32, fs_modifiers: u32, vk: u32) -> i32;
        fn UnregisterHotKey(hwnd: *mut std::ffi::c_void, id: i32) -> i32;
        fn GetMessageW(msg: *mut Msg, hwnd: *mut std::ffi::c_void, min: u32, max: u32) -> i32;
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: *mut std::ffi::c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        pt: Point,
    }

    const MOD_ALT: u32 = 0x0001;
    const MOD_CONTROL: u32 = 0x0002;
    const MOD_SHIFT: u32 = 0x0004;
    const MOD_NOREPEAT: u32 = 0x4000;

    // Keys
    const VK_MEDIA_NEXT_TRACK: u32 = 0xB0;
    const VK_MEDIA_PREV_TRACK: u32 = 0xB1;
    const VK_MEDIA_PLAY_PAUSE: u32 = 0xB3;
    const VK_SPACE: u32 = 0x20;
    const VK_LEFT: u32 = 0x25;
    const VK_UP: u32 = 0x26;
    const VK_RIGHT: u32 = 0x27;
    const VK_DOWN: u32 = 0x28;
    const VK_KEY_W: u32 = 0x57;

    let hotkeys = [
        // Media keys
        (1, 0, VK_MEDIA_PLAY_PAUSE, "toggle"),
        (2, 0, VK_MEDIA_NEXT_TRACK, "next"),
        (3, 0, VK_MEDIA_PREV_TRACK, "prev"),
        // Ctrl + Alt combos (gaming safe)
        (4, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_SPACE, "toggle"),
        (5, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_RIGHT, "next"),
        (6, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_LEFT, "prev"),
        (7, MOD_CONTROL | MOD_ALT, VK_UP, "volume_up"),
        (8, MOD_CONTROL | MOD_ALT, VK_DOWN, "volume_down"),
        (9, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_KEY_W, "toggle_overlay"),
        // Ctrl + Shift combos (alternative gaming hotkeys)
        (10, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_SPACE, "toggle"),
        (11, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_RIGHT, "next"),
        (12, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_LEFT, "prev"),
        (13, MOD_CONTROL | MOD_SHIFT, VK_UP, "volume_up"),
        (14, MOD_CONTROL | MOD_SHIFT, VK_DOWN, "volume_down"),
    ];

    unsafe {
        for &(id, mods, vk, _) in &hotkeys {
            let res = RegisterHotKey(std::ptr::null_mut(), id, mods, vk);
            if res == 0 {
                log::debug!("Could not register hotkey id {} (may already be in use)", id);
            }
        }

        let mut msg: Msg = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == 0x0312 {
                // WM_HOTKEY
                let id = msg.wparam as i32;
                if let Some(&(_, _, _, action)) = hotkeys.iter().find(|h| h.0 == id) {
                    let _ = app.emit("global-hotkey", serde_json::json!({ "action": action }));
                }
            }
        }

        for &(id, _, _, _) in &hotkeys {
            UnregisterHotKey(std::ptr::null_mut(), id);
        }
    }
}
