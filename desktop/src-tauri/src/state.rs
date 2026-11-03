use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use tauri::{AppHandle, Emitter, Manager};

use crate::cache::CacheManager;
use crate::db::Db;
use crate::discovery::Discovery;
use crate::models::{LibraryStats, ServerSession, ServerView, Settings};
use crate::mpv::PlayerHandle;

pub struct AppState {
    pub db: Db,
    pub http: reqwest::Client,
    pub player: PlayerHandle,
    pub cache: CacheManager,
    pub discovery: Discovery,
    pub session: RwLock<Option<ServerSession>>,
    pub settings: RwLock<Settings>,
    pub online: AtomicBool,
    pub version: AtomicI64,
    pub track_count: AtomicI64,
    pub protocol: AtomicI32,
    pub sse_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub sse_generation: AtomicU64,
    pub connection_epoch: AtomicU64,
    pub sync_lock: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Не удалось получить каталог данных: {e}"))?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Не удалось создать каталог данных: {e}"))?;

        let db = Db::open(&data_dir.join("vibecast.db"))?;
        let stats = db.stats()?;

        let volume = db
            .get_setting("volume")
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(80.0)
            .clamp(0.0, 100.0);
        let mpv_path = db
            .get_setting("mpv_path")
            .filter(|value| !value.trim().is_empty());
        let theme = db
            .get_setting("theme")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "cyberpunk".to_string());
        let cache_mode = db
            .get_setting("cache_mode")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "auto".to_string());
        let expand_on_hotkey = db
            .get_setting("expand_on_hotkey")
            .map(|value| value == "true")
            .unwrap_or(true);
        let hotkeys: crate::models::HotkeyConfig = db
            .get_setting("hotkeys")
            .and_then(|val| serde_json::from_str(&val).ok())
            .unwrap_or_default();
        let settings = Settings {
            volume,
            mpv_path,
            theme,
            cache_mode,
            expand_on_hotkey,
            hotkeys,
        };

        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .user_agent("VibeCast/0.1")
            .build()
            .map_err(|e| format!("Не удалось создать HTTP-клиент: {e}"))?;

        let cache = CacheManager::new(app.clone(), http.clone(), &crate::cache::cache_root())?;
        let player = PlayerHandle::new(app.clone(), volume, settings.mpv_path.clone());
        let discovery = Discovery::start(app.clone());
        let session = db.load_server();

        Ok(Self {
            db,
            http,
            player,
            cache,
            discovery,
            session: RwLock::new(session),
            settings: RwLock::new(settings),
            online: AtomicBool::new(false),
            version: AtomicI64::new(stats.version),
            track_count: AtomicI64::new(stats.tracks),
            protocol: AtomicI32::new(1),
            sse_task: Mutex::new(None),
            sse_generation: AtomicU64::new(0),
            connection_epoch: AtomicU64::new(0),
            sync_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn session(&self) -> Option<ServerSession> {
        self.session.read().ok().and_then(|session| session.clone())
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn hotkeys(&self) -> crate::models::HotkeyConfig {
        self.settings().hotkeys
    }

    pub fn server_view(&self) -> Option<ServerView> {
        let session = self.session()?;
        Some(ServerView {
            base_url: session.base_url,
            device_name: session.device_name,
            online: self.online.load(Ordering::SeqCst),
            version: self.version.load(Ordering::SeqCst),
            track_count: self.track_count.load(Ordering::SeqCst),
            protocol: self.protocol.load(Ordering::SeqCst),
            has_token: true,
        })
    }

    pub fn stats(&self) -> LibraryStats {
        self.db.stats().unwrap_or_default()
    }

    pub fn emit_server(&self, app: &AppHandle) {
        let _ = app.emit("server://changed", self.server_view());
    }

    pub fn set_online(&self, app: &AppHandle, online: bool) {
        let changed = self.online.swap(online, Ordering::SeqCst) != online;
        if changed {
            self.emit_server(app);
        }
    }
}
