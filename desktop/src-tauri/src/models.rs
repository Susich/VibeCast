use serde::{Deserialize, Serialize};

/// Track as published by the phone. Field names intentionally match the
/// Android `TrackDto` JSON (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    #[serde(default)]
    pub album_artist: Option<String>,
    pub duration_ms: i64,
    pub mime: String,
    pub size: i64,
    #[serde(default)]
    pub track_no: Option<i64>,
    #[serde(default)]
    pub year: Option<i64>,
    #[serde(default)]
    pub cover_id: Option<i64>,
    pub date_modified: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRow {
    #[serde(flatten)]
    pub track: Track,
    pub cached: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub version: i64,
    pub total: i64,
    #[allow(dead_code)]
    pub offset: i64,
    #[allow(dead_code)]
    pub limit: i64,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub ok: bool,
    pub app: String,
    pub protocol: i32,
    pub device_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub catalog_version: i64,
    #[serde(default)]
    #[allow(dead_code)]
    pub track_count: i64,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub token_required: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ServerSession {
    pub base_url: String,
    pub token: String,
    pub device_name: String,
}

/// Safe view of the active server. The token is deliberately not part of it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    pub base_url: String,
    pub device_name: String,
    pub online: bool,
    pub version: i64,
    pub track_count: i64,
    pub protocol: i32,
    pub has_token: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub version: Option<String>,
    pub token_required: bool,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub ping_ms: Option<u64>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_hotkey_toggle")]
    pub toggle: String,
    #[serde(default = "default_hotkey_next")]
    pub next: String,
    #[serde(default = "default_hotkey_prev")]
    pub prev: String,
    #[serde(default = "default_hotkey_volume_up")]
    pub volume_up: String,
    #[serde(default = "default_hotkey_volume_down")]
    pub volume_down: String,
    #[serde(default = "default_hotkey_toggle_overlay")]
    pub toggle_overlay: String,
}

fn default_hotkey_toggle() -> String {
    "Ctrl+Alt+Space".to_string()
}
fn default_hotkey_next() -> String {
    "Ctrl+Alt+Right".to_string()
}
fn default_hotkey_prev() -> String {
    "Ctrl+Alt+Left".to_string()
}
fn default_hotkey_volume_up() -> String {
    "Ctrl+Alt+Up".to_string()
}
fn default_hotkey_volume_down() -> String {
    "Ctrl+Alt+Down".to_string()
}
fn default_hotkey_toggle_overlay() -> String {
    "Ctrl+Alt+W".to_string()
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            enabled: default_true(),
            toggle: default_hotkey_toggle(),
            next: default_hotkey_next(),
            prev: default_hotkey_prev(),
            volume_up: default_hotkey_volume_up(),
            volume_down: default_hotkey_volume_down(),
            toggle_overlay: default_hotkey_toggle_overlay(),
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub volume: f64,
    pub mpv_path: Option<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_cache_mode")]
    pub cache_mode: String,
    #[serde(default = "default_true")]
    pub expand_on_hotkey: bool,
    #[serde(default)]
    pub hotkeys: HotkeyConfig,
}

fn default_cache_mode() -> String {
    "auto".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            volume: 100.0,
            mpv_path: None,
            theme: default_theme(),
            cache_mode: default_cache_mode(),
            expand_on_hotkey: default_true(),
            hotkeys: HotkeyConfig::default(),
        }
    }
}

fn default_theme() -> String {
    "cyberpunk".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub is_overlay: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: String,
    pub volume: f64,
    pub mpv_path: Option<String>,
    pub overlay: OverlayState,
    pub cache_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub current_track_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: f64,
    /// "stream" while playing from the phone, "cache" for local files.
    pub source: Option<String>,
    pub loading: bool,
    pub buffering: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub tracks: i64,
    pub artists: i64,
    pub albums: i64,
    pub version: i64,
    pub synced_at: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub count: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub server: Option<ServerView>,
    pub devices: Vec<Device>,
    pub player: PlayerState,
    pub settings: Settings,
    pub stats: LibraryStats,
    pub cached_count: usize,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    pub query: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub cached_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub tracks: Vec<TrackRow>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facet {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumFacet {
    pub album: String,
    pub artist: String,
    pub count: i64,
    pub cover_track_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub artists: Vec<Facet>,
    pub albums: Vec<AlbumFacet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheProgress {
    pub track_id: String,
    pub received: u64,
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionEvent {
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub message: String,
    /// "info" | "error" | "success"
    pub level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommand {
    pub action: String,
    pub position: Option<f64>,
    pub volume: Option<f64>,
    pub track_id: Option<String>,
    pub queue_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub download_url: Option<String>,
    pub release_notes: Option<String>,
}

