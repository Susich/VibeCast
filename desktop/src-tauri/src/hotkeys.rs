use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

static HOTKEY_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static HOTKEYS_PAUSED: AtomicBool = AtomicBool::new(false);

const WM_USER: u32 = 0x0400;
const WM_RELOAD_HOTKEYS: u32 = WM_USER + 100;
const WM_HOTKEY: u32 = 0x0312;

pub fn reload_hotkeys() {
    let tid = HOTKEY_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        #[cfg(target_os = "windows")]
        unsafe {
            PostThreadMessageW(tid, WM_RELOAD_HOTKEYS, 0, 0);
        }
    }
}

pub fn set_hotkeys_paused(paused: bool) {
    HOTKEYS_PAUSED.store(paused, Ordering::SeqCst);
    reload_hotkeys();
}

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
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentThreadId() -> u32;
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn RegisterHotKey(hwnd: *mut std::ffi::c_void, id: i32, fs_modifiers: u32, vk: u32) -> i32;
    fn UnregisterHotKey(hwnd: *mut std::ffi::c_void, id: i32) -> i32;
    fn GetMessageW(msg: *mut Msg, hwnd: *mut std::ffi::c_void, min: u32, max: u32) -> i32;
    fn PostThreadMessageW(idThread: u32, msg: u32, wParam: usize, lParam: isize) -> i32;
    fn PeekMessageW(
        msg: *mut Msg,
        hwnd: *mut std::ffi::c_void,
        min: u32,
        max: u32,
        remove_msg: u32,
    ) -> i32;
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
const MOD_WIN: u32 = 0x0008;
const MOD_NOREPEAT: u32 = 0x4000;

// Hardware Media Keys
const VK_MEDIA_NEXT_TRACK: u32 = 0xB0;
const VK_MEDIA_PREV_TRACK: u32 = 0xB1;
const VK_MEDIA_PLAY_PAUSE: u32 = 0xB3;

fn parse_vk(key: &str) -> Option<u32> {
    let lower = key.to_ascii_lowercase();
    match lower.as_str() {
        "space" => Some(0x20),
        "left" | "arrowleft" => Some(0x25),
        "up" | "arrowup" => Some(0x26),
        "right" | "arrowright" => Some(0x27),
        "down" | "arrowdown" => Some(0x28),
        "tab" => Some(0x09),
        "enter" | "return" => Some(0x0D),
        "escape" | "esc" => Some(0x1B),
        "backspace" => Some(0x08),
        "insert" => Some(0x2D),
        "delete" | "del" => Some(0x2E),
        "home" => Some(0x24),
        "end" => Some(0x23),
        "pageup" | "pgup" => Some(0x21),
        "pagedown" | "pgdn" => Some(0x22),
        "minus" | "-" => Some(0xBD),
        "equal" | "plus" | "=" | "+" => Some(0xBB),
        "bracketleft" | "[" => Some(0xDB),
        "bracketright" | "]" => Some(0xDD),
        "semicolon" | ";" => Some(0xBA),
        "quote" | "'" => Some(0xDE),
        "comma" | "," => Some(0xBC),
        "period" | "." => Some(0xBE),
        "slash" | "/" => Some(0xBF),
        "backslash" | "\\" => Some(0xDC),
        "backquote" | "`" | "tilde" | "~" => Some(0xC0),
        s if s.starts_with('f') && s.len() > 1 => {
            let num: u32 = s[1..].parse().ok()?;
            if (1..=24).contains(&num) {
                Some(0x70 + (num - 1))
            } else {
                None
            }
        }
        s if s.len() == 1 => {
            let ch = s.chars().next()?;
            if ch.is_ascii_alphabetic() {
                Some(ch.to_ascii_uppercase() as u32)
            } else if ch.is_ascii_digit() {
                Some(ch as u32)
            } else {
                None
            }
        }
        s if s.starts_with("numpad") => {
            let rest = &s[6..];
            match rest {
                "0" => Some(0x60),
                "1" => Some(0x61),
                "2" => Some(0x62),
                "3" => Some(0x63),
                "4" => Some(0x64),
                "5" => Some(0x65),
                "6" => Some(0x66),
                "7" => Some(0x67),
                "8" => Some(0x68),
                "9" => Some(0x69),
                "add" | "+" => Some(0x6B),
                "subtract" | "-" => Some(0x6D),
                "multiply" | "*" => Some(0x6A),
                "divide" | "/" => Some(0x6F),
                _ => None,
            }
        }
        _ => None,
    }
}

pub fn parse_hotkey(s: &str, allow_repeat: bool) -> Option<(u32, u32)> {
    let mut mods = 0u32;
    let mut vk = None;

    for part in s.split('+').map(|p| p.trim()).filter(|p| !p.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "alt" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            "win" | "super" | "meta" => mods |= MOD_WIN,
            key_part => {
                vk = parse_vk(key_part);
            }
        }
    }

    let vk = vk?;
    let final_mods = if allow_repeat {
        mods
    } else {
        mods | MOD_NOREPEAT
    };
    Some((final_mods, vk))
}

#[cfg(target_os = "windows")]
fn register_configured_hotkeys(app: &AppHandle, active: &mut Vec<(i32, String)>) {
    if HOTKEYS_PAUSED.load(Ordering::SeqCst) {
        return;
    }

    let config = app
        .try_state::<AppState>()
        .map(|s| s.hotkeys())
        .unwrap_or_default();

    if !config.enabled {
        return;
    }

    // Single-trigger actions use MOD_NOREPEAT to prevent accidental double-fires;
    // volume up/down allow auto-repeat so holding the keys continuously adjusts volume.
    let items = [
        (1, config.toggle, "toggle", false),
        (2, config.next, "next", false),
        (3, config.prev, "prev", false),
        (4, config.volume_up, "volume_up", true),
        (5, config.volume_down, "volume_down", true),
        (6, config.toggle_overlay, "toggle_overlay", false),
    ];

    unsafe {
        for (id, combo, action, allow_repeat) in items {
            if let Some((mods, vk)) = parse_hotkey(&combo, allow_repeat) {
                let res = RegisterHotKey(std::ptr::null_mut(), id, mods, vk);
                if res != 0 {
                    active.push((id, action.to_string()));
                } else {
                    log::warn!("Could not register hotkey {} for action {}", combo, action);
                }
            }
        }

        // Always register hardware media keys
        let media_keys = [
            (1001, 0, VK_MEDIA_PLAY_PAUSE, "toggle"),
            (1002, 0, VK_MEDIA_NEXT_TRACK, "next"),
            (1003, 0, VK_MEDIA_PREV_TRACK, "prev"),
        ];

        for (id, mods, vk, action) in media_keys {
            let res = RegisterHotKey(std::ptr::null_mut(), id, mods, vk);
            if res != 0 {
                active.push((id, action.to_string()));
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn run_windows_hotkey_loop(app: AppHandle) {
    let tid = unsafe { GetCurrentThreadId() };
    HOTKEY_THREAD_ID.store(tid, Ordering::SeqCst);

    // Force message queue initialization for this thread
    unsafe {
        let mut dummy: Msg = std::mem::zeroed();
        PeekMessageW(&mut dummy, std::ptr::null_mut(), WM_USER, WM_USER, 0);
    }

    let mut active_hotkeys: Vec<(i32, String)> = Vec::new();
    register_configured_hotkeys(&app, &mut active_hotkeys);

    let mut msg: Msg = unsafe { std::mem::zeroed() };
    unsafe {
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                let id = msg.wparam as i32;
                if let Some((_, action)) = active_hotkeys.iter().find(|(h_id, _)| *h_id == id) {
                    let _ = app.emit("global-hotkey", serde_json::json!({ "action": action }));
                }
            } else if msg.message == WM_RELOAD_HOTKEYS {
                for (id, _) in &active_hotkeys {
                    UnregisterHotKey(std::ptr::null_mut(), *id);
                }
                active_hotkeys.clear();
                register_configured_hotkeys(&app, &mut active_hotkeys);
            }
        }

        for (id, _) in &active_hotkeys {
            UnregisterHotKey(std::ptr::null_mut(), *id);
        }
    }
}
