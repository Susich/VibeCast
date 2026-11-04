use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::models::{PlayerState, Track};

trait IpcStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> IpcStream for T {}

struct Connection {
    tx: mpsc::UnboundedSender<Value>,
    child: Child,
    #[cfg_attr(windows, allow(dead_code))]
    socket: String,
}

pub struct PlayerHandle {
    app: AppHandle,
    conn: Arc<AsyncMutex<Option<Connection>>>,
    state: Arc<Mutex<PlayerState>>,
    last_emit: Arc<Mutex<Instant>>,
    eof_for: Arc<Mutex<Option<String>>>,
    volume: Arc<Mutex<f64>>,
    target_volume: Arc<AtomicU64>,
    #[allow(dead_code)]
    current_volume: Arc<AtomicU64>,
    volume_tx: mpsc::UnboundedSender<f64>,
    mpv_path: Arc<Mutex<Option<String>>>,
    equalizer_filter: Arc<Mutex<Option<String>>>,
    crossfade_duration: Arc<AtomicU64>,
    request_id: AtomicU64,
}

impl PlayerHandle {
    pub fn new(app: AppHandle, volume: f64, mpv_path: Option<String>) -> Self {
        #[cfg(windows)]
        {
            tauri::async_runtime::spawn_blocking(cleanup_orphaned_mpv);
        }

        let volume = volume.clamp(0.0, 100.0);
        let mut state = PlayerState::default();
        state.volume = volume;
        let conn: Arc<AsyncMutex<Option<Connection>>> = Arc::new(AsyncMutex::new(None));
        let (volume_tx, mut volume_rx) = mpsc::unbounded_channel::<f64>();
        let target_volume = Arc::new(AtomicU64::new(volume.to_bits()));
        let current_volume = Arc::new(AtomicU64::new(volume.to_bits()));

        // Background volume smoother loop applying exponential lerp (10-20ms window)
        // to prevent clicks, pops, and IPC floods when volume slider moves rapidly.
        let smoother_conn = conn.clone();
        let smoother_target = target_volume.clone();
        let smoother_current = current_volume.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(target) = volume_rx.recv().await {
                // Drain any additional rapid updates from channel to get latest target immediately
                let mut latest_target = target;
                while let Ok(next_target) = volume_rx.try_recv() {
                    latest_target = next_target;
                }
                smoother_target.store(latest_target.to_bits(), Ordering::Relaxed);

                let mut current = f64::from_bits(smoother_current.load(Ordering::Relaxed));
                let target = latest_target;

                // If already at target, skip
                if (current - target).abs() < 0.1 {
                    continue;
                }

                // 15ms exponential lerp window with 10ms discrete steps
                let tau: f64 = 0.015 / 3.0;
                let dt: f64 = 0.010;
                let alpha: f64 = 1.0 - (-dt / tau).exp();

                while (current - target).abs() >= 0.2 {
                    let step = (target - current) * alpha;
                    current += step;
                    smoother_current.store(current.to_bits(), Ordering::Relaxed);

                    // Send smoothed volume to mpv softvol
                    let guard = smoother_conn.lock().await;
                    if let Some(conn) = guard.as_ref() {
                        let _ = conn.tx.send(json!({
                            "command": ["set_property", "volume", current]
                        }));
                    }
                    drop(guard);

                    tokio::time::sleep(Duration::from_millis(10)).await;

                    // If target was updated during interpolation, read latest
                    let fresh_target = f64::from_bits(smoother_target.load(Ordering::Relaxed));
                    if (fresh_target - target).abs() > 0.05 {
                        break;
                    }
                }

                // Settle cleanly at target
                let final_target = f64::from_bits(smoother_target.load(Ordering::Relaxed));
                smoother_current.store(final_target.to_bits(), Ordering::Relaxed);
                let guard = smoother_conn.lock().await;
                if let Some(conn) = guard.as_ref() {
                    let _ = conn.tx.send(json!({
                        "command": ["set_property", "volume", final_target]
                    }));
                }
            }
        });

        Self {
            app,
            conn,
            state: Arc::new(Mutex::new(state)),
            last_emit: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1))),
            eof_for: Arc::new(Mutex::new(None)),
            volume: Arc::new(Mutex::new(volume)),
            target_volume,
            current_volume,
            volume_tx,
            mpv_path: Arc::new(Mutex::new(mpv_path)),
            equalizer_filter: Arc::new(Mutex::new(None)),
            crossfade_duration: Arc::new(AtomicU64::new(1.5f64.to_bits())),
            request_id: AtomicU64::new(1),
        }
    }

    pub fn set_crossfade_duration(&self, duration: f64) {
        self.crossfade_duration
            .store(duration.clamp(0.0, 5.0).to_bits(), Ordering::Relaxed);
    }

    pub fn crossfade_duration(&self) -> f64 {
        f64::from_bits(self.crossfade_duration.load(Ordering::Relaxed))
    }

    pub fn state(&self) -> PlayerState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub async fn set_mpv_path(&self, path: Option<String>) {
        *self
            .mpv_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = path;
        self.kill_connection().await;
    }

    pub async fn play(
        &self,
        track: &Track,
        uri: &str,
        remote: bool,
        token: Option<&str>,
        start: f64,
    ) -> Result<(), String> {
        if remote && token.is_none() {
            return Err("Нет токена для потокового воспроизведения".to_string());
        }

        self.ensure_started().await?;

        let vol = self.volume.lock().map(|v| *v).unwrap_or(80.0);

        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Состояние плеера недоступно".to_string())?;
            state.current_track_id = Some(track.id.clone());
            state.title = Some(track.title.clone());
            state.artist = Some(track.artist.clone());
            state.album = Some(track.album.clone());
            state.position = start.max(0.0);
            state.duration = (track.duration_ms.max(0) as f64) / 1000.0;
            state.paused = false;
            state.loading = true;
            state.buffering = false;
            state.error = None;
            state.source = Some(if remote { "stream" } else { "cache" }.to_string());
        }
        if let Ok(mut eof) = self.eof_for.lock() {
            *eof = None;
        }

        let mut options = Map::new();
        if remote {
            options.insert(
                "http-header-fields".to_string(),
                json!(format!(
                    "Authorization: Bearer {}",
                    token.unwrap_or_default()
                )),
            );
        }
        if start > 0.01 {
            options.insert("start".to_string(), json!(format!("{start:.3}")));
        }
        options.insert("pause".to_string(), json!("no"));

        let crossfade = self.crossfade_duration();
        let was_playing = self
            .state
            .lock()
            .map(|s| s.current_track_id.is_some() && !s.paused)
            .unwrap_or(false);

        // If another track was playing and crossfade is enabled, do a brief 60ms micro-fade down
        // on outgoing track to prevent click/pop upon track switch
        if was_playing && crossfade > 0.05 {
            let vol = self.volume.lock().map(|v| *v).unwrap_or(80.0);
            if vol > 5.0 {
                self.fade_volume_ipc(vol, 0.0, 60).await;
            }
        }

        let command = if options.is_empty() {
            json!({
                "command": ["loadfile", uri, "replace"],
                "request_id": self.request_id.fetch_add(1, Ordering::Relaxed),
            })
        } else {
            json!({
                "command": ["loadfile", uri, "replace", -1, options],
                "request_id": self.request_id.fetch_add(1, Ordering::Relaxed),
            })
        };
        self.send(command).await?;

        // Explicitly unpause mpv to guarantee playback starts on first try after phone connection
        let _ = self
            .send(json!({
                "command": ["set_property", "pause", false],
                "request_id": self.request_id.fetch_add(1, Ordering::Relaxed),
            }))
            .await;

        self.send_optional(json!({ "command": ["set_property", "volume", vol] }))
            .await;

        let filter_opt = self.equalizer_filter.lock().ok().and_then(|g| g.clone());
        let af_value = match (filter_opt, crossfade > 0.05) {
            (Some(ref eq), true) if !eq.is_empty() => {
                format!("{},lavfi=[afade=t=in:ss=0:d={crossfade:.2}]", eq)
            }
            (_, true) => {
                format!("lavfi=[afade=t=in:ss=0:d={crossfade:.2}]")
            }
            (Some(ref eq), false) if !eq.is_empty() => {
                eq.clone()
            }
            _ => String::new(),
        };

        if !af_value.is_empty() {
            self.send_optional(json!({ "command": ["set_property", "af", af_value] }))
                .await;
        } else {
            self.send_optional(json!({ "command": ["set_property", "af", ""] }))
                .await;
        }

        self.emit_state(true);
        Ok(())
    }

    pub async fn stop(&self) {
        self.send_optional(json!({ "command": ["stop"] })).await;
        self.send_optional(json!({ "command": ["set_property", "pause", false] }))
            .await;
        if let Ok(mut state) = self.state.lock() {
            let volume = state.volume;
            *state = PlayerState {
                volume,
                ..Default::default()
            };
        }
        if let Ok(mut eof) = self.eof_for.lock() {
            *eof = None;
        }
        self.emit_state(true);
    }

    async fn fade_volume_ipc(&self, from: f64, to: f64, duration_ms: u64) {
        if (from - to).abs() < 1.0 {
            return;
        }
        let steps = 4;
        let step_dur = Duration::from_millis((duration_ms / steps).max(1));
        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            let vol = from + (to - from) * t;
            self.send_optional(json!({
                "command": ["set_property", "volume", vol.clamp(0.0, 100.0)]
            }))
            .await;
            tokio::time::sleep(step_dur).await;
        }
    }

    pub async fn set_equalizer(&self, enabled: bool, gains: &[f64]) {
        let filter = build_equalizer_filter(enabled, gains);
        if let Ok(mut guard) = self.equalizer_filter.lock() {
            *guard = Some(filter.clone());
        }
        let arg = if filter.is_empty() { "" } else { &filter };
        self.send_optional(json!({
            "command": ["set_property", "af", arg]
        }))
        .await;
    }

    pub async fn set_pause(&self, paused: bool) {
        let current_paused = self.state.lock().map(|state| state.paused).unwrap_or(false);
        if current_paused == paused {
            return;
        }
        if let Ok(mut state) = self.state.lock() {
            if state.current_track_id.is_none() {
                return;
            }
            state.paused = paused;
        }

        let vol = self.volume.lock().map(|v| *v).unwrap_or(80.0);
        if paused {
            if vol > 5.0 {
                self.fade_volume_ipc(vol, 0.0, 75).await;
            }
            self.send_optional(json!({ "command": ["set_property", "pause", true] }))
                .await;
            self.send_optional(json!({ "command": ["set_property", "volume", vol] }))
                .await;
        } else {
            self.send_optional(json!({ "command": ["set_property", "volume", 0.0] }))
                .await;
            self.send_optional(json!({ "command": ["set_property", "pause", false] }))
                .await;
            if vol > 5.0 {
                self.fade_volume_ipc(0.0, vol, 75).await;
            } else {
                self.send_optional(json!({ "command": ["set_property", "volume", vol] }))
                    .await;
            }
        }

        self.emit_state(true);
    }

    pub async fn toggle_pause(&self) {
        let paused = self.state.lock().map(|state| state.paused).unwrap_or(false);
        self.set_pause(!paused).await;
    }

    pub async fn seek(&self, position: f64) {
        let position = position.max(0.0);
        if let Ok(mut state) = self.state.lock() {
            if state.current_track_id.is_none() {
                return;
            }
            state.position = position;
        }
        self.send_optional(json!({
            "command": ["seek", position, "absolute+exact"]
        }))
        .await;
        self.emit_state(true);
    }

    pub async fn set_volume(&self, volume: f64) {
        let volume = volume.clamp(0.0, 100.0);
        if let Ok(mut state) = self.state.lock() {
            state.volume = volume;
        }
        if let Ok(mut stored) = self.volume.lock() {
            *stored = volume;
        }
        self.target_volume.store(volume.to_bits(), Ordering::Relaxed);
        let _ = self.volume_tx.send(volume);
        self.emit_state(false);
    }

    pub async fn shutdown(&self) {
        let mut guard = self.conn.lock().await;
        if let Some(mut conn) = guard.take() {
            let _ = conn.tx.send(json!({ "command": ["quit"] }));
            let _ = conn.child.kill();
            let _ = conn.child.wait();
            #[cfg(unix)]
            let _ = std::fs::remove_file(&conn.socket);
        }
    }

    async fn kill_connection(&self) {
        let mut guard = self.conn.lock().await;
        if let Some(mut conn) = guard.take() {
            let _ = conn.child.kill();
            let _ = conn.child.wait();
            #[cfg(unix)]
            let _ = std::fs::remove_file(&conn.socket);
        }
    }

    async fn send(&self, value: Value) -> Result<(), String> {
        let guard = self.conn.lock().await;
        match guard.as_ref() {
            Some(conn) => conn
                .tx
                .send(value)
                .map_err(|_| "mpv IPC закрыт".to_string()),
            None => Err("mpv не запущен".to_string()),
        }
    }

    async fn send_optional(&self, value: Value) {
        let guard = self.conn.lock().await;
        if let Some(conn) = guard.as_ref() {
            let _ = conn.tx.send(value);
        }
    }

    async fn ensure_started(&self) -> Result<(), String> {
        let mut guard = self.conn.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let configured = self
            .mpv_path
            .lock()
            .map(|path| path.clone())
            .unwrap_or(None);
        let mpv = find_mpv(&self.app, configured).ok_or_else(|| {
            "mpv не найден. Установите mpv и укажите путь к mpv.exe в настройках VibeCast."
                .to_string()
        })?;

        let socket = socket_path();
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&socket);
        }

        let volume = self.volume.lock().map(|volume| *volume).unwrap_or(80.0);
        let mut command = Command::new(&mpv);
        command.args([
            "--idle=yes",
            "--pause=no",
            "--no-video",
            "--gapless-audio=yes",
            "--audio-buffer=0.3",
            "--no-terminal",
            "--force-window=no",
            "--keep-open=no",
            "--user-agent=VibeCast/0.1",
            "--msg-level=all=warn",
        ]);
        command.arg(format!("--input-ipc-server={socket}"));
        command.arg(format!("--volume={volume:.0}"));
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|err| format!("Не удалось запустить mpv ({mpv}): {err}"))?;

        #[cfg(windows)]
        job_object::assign_child(&child);

        let mut connected = None;
        let mut last_error = None;
        for _ in 0..60 {
            if let Ok(Some(status)) = child.try_wait() {
                let mut err_msg = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    let _ = stderr.read_to_string(&mut err_msg);
                }
                let details = err_msg.trim();
                let msg = if details.is_empty() {
                    format!("mpv завершился сразу после запуска ({status}). Проверьте установку mpv.")
                } else {
                    format!("mpv завершился с ошибкой ({status}): {details}")
                };
                return Err(msg);
            }
            match connect_ipc(&socket).await {
                Ok(stream) => {
                    connected = Some(stream);
                    break;
                }
                Err(err) => {
                    last_error = Some(err.to_string());
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        let stream = match connected {
            Some(stream) => stream,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "mpv не открыл IPC-канал: {}",
                    last_error.unwrap_or_else(|| "таймаут".to_string())
                ));
            }
        };

        let (reader, mut writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();

        tokio::spawn(async move {
            while let Some(value) = rx.recv().await {
                let mut line = value.to_string();
                line.push('\n');
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
            }
        });

        let state = self.state.clone();
        let app = self.app.clone();
        let last_emit = self.last_emit.clone();
        let eof_for = self.eof_for.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => handle_line(&app, &state, &last_emit, &eof_for, &line),
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        });

        for (id, property) in [
            (1, "time-pos"),
            (2, "duration"),
            (3, "pause"),
            (4, "volume"),
            (5, "eof-reached"),
            (6, "paused-for-cache"),
            (7, "media-title"),
        ] {
            let _ = tx.send(json!({
                "command": ["observe_property", id, property]
            }));
        }

        if let Ok(guard) = self.equalizer_filter.lock() {
            if let Some(ref filter) = *guard {
                if !filter.is_empty() {
                    let _ = tx.send(json!({
                        "command": ["set_property", "af", filter]
                    }));
                }
            }
        }

        log::info!("mpv started ({mpv})");
        *guard = Some(Connection { tx, child, socket });
        Ok(())
    }

    fn emit_state(&self, force: bool) {
        emit_state(&self.app, &self.state, &self.last_emit, force);
    }
}

fn emit_state(
    app: &AppHandle,
    state: &Arc<Mutex<PlayerState>>,
    last_emit: &Arc<Mutex<Instant>>,
    force: bool,
) {
    if !force {
        let last = match last_emit.lock() {
            Ok(last) => *last,
            Err(_) => return,
        };
        if last.elapsed() < Duration::from_millis(250) {
            return;
        }
    }
    if let Ok(mut last) = last_emit.lock() {
        *last = Instant::now();
    }
    let snapshot = match state.lock() {
        Ok(state) => state.clone(),
        Err(_) => return,
    };
    let _ = app.emit("player://state", snapshot);
}

fn handle_line(
    app: &AppHandle,
    state: &Arc<Mutex<PlayerState>>,
    last_emit: &Arc<Mutex<Instant>>,
    eof_for: &Arc<Mutex<Option<String>>>,
    line: &str,
) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };

    if let Some(event) = value.get("event").and_then(Value::as_str) {
        if event == "end-file" {
            let reason = value.get("reason").and_then(Value::as_str).unwrap_or("");
            let failed = reason == "error";
            let ended = reason == "eof";
            if failed || ended {
                let mut eof_id = None;
                if let Ok(mut player) = state.lock() {
                    player.loading = false;
                    player.buffering = false;
                    if failed {
                        player.paused = true;
                        player.error = Some(
                            "Не удалось открыть трек. Телефон недоступен или файл удалён."
                                .to_string(),
                        );
                    } else {
                        player.position = player.duration;
                        player.paused = true;
                        if let Some(id) = player.current_track_id.clone() {
                            if let Ok(mut last_eof) = eof_for.lock() {
                                if last_eof.as_deref() != Some(id.as_str()) {
                                    *last_eof = Some(id.clone());
                                    eof_id = Some(id);
                                }
                            }
                        }
                    }
                }
                if let Some(track_id) = eof_id {
                    let _ = app.emit("player://eof", json!({ "trackId": track_id }));
                }
                emit_state(app, state, last_emit, true);
            }
            return;
        }
        if event != "property-change" {
            return;
        }
        let Some(name) = value.get("name").and_then(Value::as_str) else {
            return;
        };
        let data = value.get("data");
        let mut force = false;
        let mut eof_id = None;

        if let Ok(mut player) = state.lock() {
            match name {
                "time-pos" => {
                    if let Some(position) = data.and_then(Value::as_f64) {
                        player.position = position.max(0.0);
                        player.loading = false;
                    }
                }
                "duration" => {
                    if let Some(duration) = data.and_then(Value::as_f64) {
                        if duration > 0.0 {
                            player.duration = duration;
                        }
                        force = true;
                    }
                }
                "pause" => {
                    if let Some(paused) = data.and_then(Value::as_bool) {
                        player.paused = paused;
                        player.loading = false;
                        force = true;
                    }
                }
                "volume" => {
                    if let Some(volume) = data.and_then(Value::as_f64) {
                        player.volume = volume.clamp(0.0, 100.0);
                        force = true;
                    }
                }
                "paused-for-cache" => {
                    player.buffering = data.and_then(Value::as_bool).unwrap_or(false);
                    force = true;
                }
                "eof-reached" => {
                    let reached = data.and_then(Value::as_bool).unwrap_or(false);
                    if reached {
                        player.loading = false;
                        player.buffering = false;
                        player.paused = true;
                        if let Some(id) = player.current_track_id.clone() {
                            if let Ok(mut last_eof) = eof_for.lock() {
                                if last_eof.as_deref() != Some(id.as_str()) {
                                    *last_eof = Some(id.clone());
                                    eof_id = Some(id);
                                }
                            }
                        }
                    } else if let Ok(mut last_eof) = eof_for.lock() {
                        *last_eof = None;
                    }
                    force = true;
                }
                _ => {}
            }
        }

        if let Some(track_id) = eof_id {
            let _ = app.emit("player://eof", json!({ "trackId": track_id }));
        }
        emit_state(app, state, last_emit, force);
        return;
    }

    if let Some(error) = value.get("error").and_then(Value::as_str) {
        if error == "success" {
            return;
        }
        let lower = error.to_lowercase();
        if lower.contains("loading failed")
            || lower.contains("failed to open")
            || lower.contains("error opening")
        {
            if let Ok(mut player) = state.lock() {
                player.loading = false;
                player.buffering = false;
                player.error = Some(format!("mpv: {error}"));
            }
            emit_state(app, state, last_emit, true);
        }
    }
}

fn find_mpv(app: &AppHandle, configured: Option<String>) -> Option<String> {
    if let Some(path) = configured {
        let path = path.trim().to_string();
        if !path.is_empty() && std::path::Path::new(&path).is_file() {
            return Some(path);
        }
    }
    if let Ok(path) = std::env::var("VIBECAST_MPV") {
        let path = path.trim().to_string();
        if !path.is_empty() && std::path::Path::new(&path).is_file() {
            return Some(path);
        }
    }
    // 1. Check relative to current running executable (for portable vibecast.exe)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for candidate in [
                "mpv.exe",
                "mpv",
                "resources/mpv.exe",
                "resources/mpv",
                "binaries/mpv.exe",
                "binaries/mpv",
                "mpv/mpv.exe",
                "mpv/mpv",
            ] {
                let path = parent.join(candidate);
                if path.is_file() {
                    return Some(path.to_string_lossy().to_string());
                }
            }
        }
    }
    // 2. Check Tauri resource_dir() (NSIS installer bundles resources here)
    if let Ok(resources) = app.path().resource_dir() {
        for candidate in [
            "mpv.exe",
            "mpv",
            "resources/mpv.exe",
            "resources/mpv",
            "binaries/mpv.exe",
            "binaries/mpv",
            "mpv/mpv.exe",
            "mpv/mpv",
        ] {
            let path = resources.join(candidate);
            if path.is_file() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    // 3. Check AppLocalData directory
    if let Ok(data_dir) = app.path().app_local_data_dir() {
        for candidate in [
            "mpv.exe",
            "mpv",
            "resources/mpv.exe",
            "binaries/mpv.exe",
        ] {
            let path = data_dir.join(candidate);
            if path.is_file() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    // 4. System PATH
    if let Some(path) = find_in_path("mpv") {
        return Some(path);
    }
    // 5. Common installation paths
    for candidate in common_mpv_paths() {
        if std::path::Path::new(&candidate).is_file() {
            return Some(candidate);
        }
    }
    None
}

fn find_in_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for file in [name.to_string(), format!("{name}.exe")] {
            let candidate = dir.join(file);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn common_mpv_paths() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mut paths = vec![
            r"C:\Program Files\mpv\mpv.exe".to_string(),
            r"C:\Program Files\MPV Player\mpv.exe".to_string(),
            r"C:\Program Files (x86)\mpv\mpv.exe".to_string(),
            r"C:\Program Files (x86)\MPV Player\mpv.exe".to_string(),
            r"C:\Program Files\mpv\mpv.com".to_string(),
        ];
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            paths.push(
                std::path::PathBuf::from(local)
                    .join("Programs")
                    .join("mpv")
                    .join("mpv.exe")
                    .to_string_lossy()
                    .to_string(),
            );
        }
        paths
    }
    #[cfg(target_os = "macos")]
    {
        vec![
            "/opt/homebrew/bin/mpv".to_string(),
            "/usr/local/bin/mpv".to_string(),
            "/Applications/mpv.app/Contents/MacOS/mpv".to_string(),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            "/usr/bin/mpv".to_string(),
            "/usr/local/bin/mpv".to_string(),
            "/snap/bin/mpv".to_string(),
        ]
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Vec::new()
    }
}

fn socket_path() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\vibecast-mpv-{}-{}", std::process::id(), stamp)
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!(
                "vibecast-mpv-{}-{}.sock",
                std::process::id(),
                stamp
            ))
            .to_string_lossy()
            .to_string()
    }
}

#[cfg(windows)]
async fn connect_ipc(path: &str) -> std::io::Result<Box<dyn IpcStream>> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let client = ClientOptions::new().open(path)?;
    Ok(Box::new(client))
}

#[cfg(unix)]
async fn connect_ipc(path: &str) -> std::io::Result<Box<dyn IpcStream>> {
    let stream = tokio::net::UnixStream::connect(path).await?;
    Ok(Box::new(stream))
}

#[cfg(windows)]
fn cleanup_orphaned_mpv() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"name = 'mpv.exe'\" | Where-Object { $_.CommandLine -like '*vibecast-mpv*' } | Stop-Process -Force -ErrorAction SilentlyContinue",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(windows)]
mod job_object {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;

    type HANDLE = *mut std::ffi::c_void;
    type BOOL = i32;

    #[repr(C)]
    struct IO_COUNTERS {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        basic_limit_information: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        io_info: IO_COUNTERS,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *mut std::ffi::c_void, lpName: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            hJob: HANDLE,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const std::ffi::c_void,
            cbJobObjectInformationLength: u32,
        ) -> BOOL;
        fn AssignProcessToJobObject(hJob: HANDLE, hProcess: HANDLE) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
    }

    struct JobHandle(HANDLE);
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    static GLOBAL_JOB: OnceLock<JobHandle> = OnceLock::new();

    pub fn assign_child(child: &std::process::Child) {
        let job = GLOBAL_JOB.get_or_init(|| {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if !job.is_null() {
                    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                    info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        job,
                        JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                        &info as *const _ as *const std::ffi::c_void,
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    );
                }
                JobHandle(job)
            }
        });

        if !job.0.is_null() {
            unsafe {
                AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE);
            }
        }
    }
}

pub fn build_equalizer_filter(enabled: bool, gains: &[f64]) -> String {
    if !enabled || gains.is_empty() || gains.iter().all(|&g| g.abs() < 0.05) {
        return String::new();
    }
    let freqs = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let parts: Vec<String> = freqs
        .iter()
        .zip(gains.iter())
        .filter(|(_, &g)| g.abs() >= 0.1)
        .map(|(f, g)| format!("equalizer=f={}:t=o:w=1:g={:.1}", f, g.clamp(-12.0, 12.0)))
        .collect();
    if parts.is_empty() {
        return String::new();
    }
    format!("lavfi=[{}]", parts.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_socket_path_generation() {
        let p1 = socket_path();
        let p2 = socket_path();
        assert!(!p1.is_empty());
        assert!(!p2.is_empty());
        #[cfg(windows)]
        {
            assert!(p1.starts_with(r"\\.\pipe\vibecast-mpv-"));
        }
    }

    #[test]
    fn test_build_equalizer_filter() {
        // Disabled returns empty string
        assert_eq!(build_equalizer_filter(false, &[3.0; 10]), "");

        // All zeroes returns empty string
        assert_eq!(build_equalizer_filter(true, &[0.0; 10]), "");

        // Gains applied correctly
        let gains = vec![4.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0];
        let filter = build_equalizer_filter(true, &gains);
        assert!(filter.starts_with("lavfi=["));
        assert!(filter.contains("equalizer=f=31:t=o:w=1:g=4.0"));
        assert!(filter.contains("equalizer=f=16000:t=o:w=1:g=2.0"));
        assert!(!filter.contains("f=125:"));
    }
}
