use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{stream, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::{AppHandle, Emitter};

use crate::models::{Device, Health};

pub struct Discovery {
    _daemon: Option<ServiceDaemon>,
    udp_beacons: Arc<Mutex<HashMap<String, (Device, Instant)>>>,
    devices: Arc<Mutex<HashMap<String, Device>>>,
    scanned: Arc<Mutex<HashMap<String, Device>>>,
    stop: Arc<AtomicBool>,
}

impl Discovery {
    pub fn start(app: AppHandle) -> Self {
        let udp_beacons = Arc::new(Mutex::new(HashMap::<String, (Device, Instant)>::new()));
        let devices = Arc::new(Mutex::new(HashMap::<String, Device>::new()));
        let scanned = Arc::new(Mutex::new(HashMap::<String, Device>::new()));
        let stop = Arc::new(AtomicBool::new(false));

        // 1. UDP Broadcast Listener on port 41234
        let udp_app = app.clone();
        let udp_map = udp_beacons.clone();
        let udp_devices = devices.clone();
        let udp_scanned = scanned.clone();
        let udp_stop = stop.clone();

        tauri::async_runtime::spawn(async move {
            let socket = match tokio::net::UdpSocket::bind("0.0.0.0:41234").await {
                Ok(s) => {
                    let _ = s.set_broadcast(true);
                    log::info!("UDP Discovery: слушает broadcast на 0.0.0.0:41234");
                    Some(s)
                }
                Err(err) => {
                    log::warn!("UDP Discovery: не удалось открыть 0.0.0.0:41234: {err}");
                    None
                }
            };

            let Some(socket) = socket else { return };
            let mut buf = [0u8; 2048];
            let ping_client = reqwest::Client::builder()
                .connect_timeout(Duration::from_millis(400))
                .timeout(Duration::from_millis(800))
                .no_proxy()
                .build()
                .ok();

            while !udp_stop.load(Ordering::Relaxed) {
                tokio::select! {
                    res = socket.recv_from(&mut buf) => {
                        if let Ok((len, peer_addr)) = res {
                            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&buf[..len]) {
                                let service = val.get("service").and_then(|v| v.as_str()).unwrap_or("");
                                if service == "audio_stream" || service == "vibecast" {
                                    let dev_name = val.get("device_name")
                                        .or_else(|| val.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("Android");
                                    let port = val.get("port")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(8765) as u16;
                                    let host = peer_addr.ip().to_string();
                                    let base_url = format!("http://{host}:{port}");
                                    let version = val.get("version").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    let token_required = val.get("token_required").and_then(|v| v.as_bool()).unwrap_or(true);

                                    let mut ping_ms = None;
                                    if let Some(ref client) = ping_client {
                                        let start = Instant::now();
                                        if let Ok(resp) = client.get(format!("{base_url}/health")).send().await {
                                            if resp.status().is_success() {
                                                ping_ms = Some(start.elapsed().as_millis().max(1) as u64);
                                            }
                                        }
                                    }

                                    let device = Device {
                                        id: format!("udp:{host}:{port}"),
                                        name: dev_name.to_string(),
                                        host,
                                        port,
                                        base_url,
                                        version,
                                        token_required,
                                        ping_ms: ping_ms.or(Some(4)),
                                        source: Some("UDP Broadcast".to_string()),
                                    };

                                    let changed = if let Ok(mut map) = udp_map.lock() {
                                        map.insert(device.id.clone(), (device, Instant::now()));
                                        true
                                    } else {
                                        false
                                    };

                                    if changed {
                                        emit_merged_all(&udp_app, &udp_map, &udp_devices, &udp_scanned);
                                    }
                                }
                            }
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                }
            }
        });

        // 2. mDNS Discovery (_vibecast._tcp.local.)
        let mdns_daemon = match ServiceDaemon::new() {
            Ok(daemon) => match daemon.browse("_vibecast._tcp.local.") {
                Ok(receiver) => {
                    let thread_udp = udp_beacons.clone();
                    let thread_devices = devices.clone();
                    let thread_scanned = scanned.clone();
                    let thread_app = app.clone();

                    std::thread::spawn(move || {
                        while let Ok(event) = receiver.recv() {
                            let mut changed = false;
                            match event {
                                ServiceEvent::ServiceResolved(info) => {
                                    let port = info.get_port();
                                    let Some(ip) = pick_address(&info.get_addresses_v4()) else {
                                        continue;
                                    };
                                    let fullname = info.get_fullname().to_string();
                                    let instance = fullname
                                        .split("._vibecast._tcp")
                                        .next()
                                        .unwrap_or("VibeCast")
                                        .to_string();
                                    let name = info
                                        .get_property_val_str("device")
                                        .filter(|value| !value.is_empty())
                                        .unwrap_or(&instance)
                                        .to_string();
                                    let version = info
                                        .get_property_val_str("version")
                                        .map(str::to_string)
                                        .filter(|value| !value.is_empty());
                                    let token_required =
                                        info.get_property_val_str("token_required") != Some("0");

                                    let device = Device {
                                        id: fullname,
                                        name,
                                        host: ip.to_string(),
                                        port,
                                        base_url: format!("http://{ip}:{port}"),
                                        version,
                                        token_required,
                                        ping_ms: Some(8),
                                        source: Some("mDNS".to_string()),
                                    };

                                    match thread_devices.lock() {
                                        Ok(mut map) => {
                                            map.insert(device.id.clone(), device);
                                            changed = true;
                                        }
                                        Err(_) => break,
                                    }
                                }
                                ServiceEvent::ServiceRemoved(_, fullname) => {
                                    if let Ok(mut map) = thread_devices.lock() {
                                        changed = map.remove(&fullname).is_some();
                                    }
                                }
                                _ => {}
                            }

                            if changed {
                                emit_merged_all(&thread_app, &thread_udp, &thread_devices, &thread_scanned);
                            }
                        }
                    });
                    Some(daemon)
                }
                Err(err) => {
                    log::warn!("Не удалось начать mDNS-поиск: {err}");
                    None
                }
            },
            Err(err) => {
                log::warn!("mDNS недоступен: {err}");
                None
            }
        };

        // 3. Fallback LAN /health probing
        let scan_app = app.clone();
        let scan_udp = udp_beacons.clone();
        let scan_devices = devices.clone();
        let scan_scanned = scanned.clone();
        let scan_stop = stop.clone();
        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder()
                .connect_timeout(Duration::from_millis(300))
                .timeout(Duration::from_millis(900))
                .no_proxy()
                .build()
            {
                Ok(client) => client,
                Err(err) => {
                    log::warn!("Не удалось создать клиент для LAN-поиска: {err}");
                    return;
                }
            };
            loop {
                if scan_stop.load(Ordering::Relaxed) {
                    break;
                }
                let found = scan_local_network(&client).await;
                let changed = match scan_scanned.lock() {
                    Ok(mut map) => {
                        if *map == found {
                            false
                        } else {
                            *map = found;
                            true
                        }
                    }
                    Err(_) => break,
                };
                if changed {
                    emit_merged_all(&scan_app, &scan_udp, &scan_devices, &scan_scanned);
                }
                tokio::time::sleep(Duration::from_secs(6)).await;
            }
        });

        // 4. Background ping updater for all active devices
        let ping_app = app;
        let ping_udp = udp_beacons.clone();
        let ping_devices = devices.clone();
        let ping_scanned = scanned.clone();
        let ping_stop = stop.clone();
        tauri::async_runtime::spawn(async move {
            let ping_client = reqwest::Client::builder()
                .connect_timeout(Duration::from_millis(400))
                .timeout(Duration::from_millis(800))
                .no_proxy()
                .build()
                .ok();

            let Some(client) = ping_client else { return };
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                if ping_stop.load(Ordering::Relaxed) {
                    break;
                }

                // Evict stale UDP beacons (> 20s)
                let now = Instant::now();
                if let Ok(mut udp_map) = ping_udp.lock() {
                    udp_map.retain(|_, (_, seen)| now.duration_since(*seen) < Duration::from_secs(20));
                }

                let current_list = merge_devices_all(&ping_udp, &ping_devices, &ping_scanned);
                for dev in current_list {
                    let start = Instant::now();
                    let url = format!("{}/health", dev.base_url);
                    if let Ok(resp) = client.get(&url).send().await {
                        if resp.status().is_success() {
                            let ms = start.elapsed().as_millis().max(1) as u64;
                            if let Ok(mut scanned_map) = ping_scanned.lock() {
                                if let Some(d) = scanned_map.get_mut(&dev.id) {
                                    d.ping_ms = Some(ms);
                                }
                            }
                            if let Ok(mut udp_map) = ping_udp.lock() {
                                if let Some((d, _)) = udp_map.get_mut(&dev.id) {
                                    d.ping_ms = Some(ms);
                                }
                            }
                            if let Ok(mut mdns_map) = ping_devices.lock() {
                                if let Some(d) = mdns_map.get_mut(&dev.id) {
                                    d.ping_ms = Some(ms);
                                }
                            }
                        }
                    }
                }
                emit_merged_all(&ping_app, &ping_udp, &ping_devices, &ping_scanned);
            }
        });

        Self {
            _daemon: mdns_daemon,
            udp_beacons,
            devices,
            scanned,
            stop,
        }
    }

    pub fn devices(&self) -> Vec<Device> {
        merge_devices_all(&self.udp_beacons, &self.devices, &self.scanned)
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn emit_merged_all(
    app: &AppHandle,
    udp: &Arc<Mutex<HashMap<String, (Device, Instant)>>>,
    mdns: &Arc<Mutex<HashMap<String, Device>>>,
    scanned: &Arc<Mutex<HashMap<String, Device>>>,
) {
    let list = merge_devices_all(udp, mdns, scanned);
    let _ = app.emit("discovery://devices", list);
}

pub fn merge_devices_all(
    udp: &Arc<Mutex<HashMap<String, (Device, Instant)>>>,
    mdns: &Arc<Mutex<HashMap<String, Device>>>,
    scanned: &Arc<Mutex<HashMap<String, Device>>>,
) -> Vec<Device> {
    let udp = udp.lock().map(|m| m.clone()).unwrap_or_default();
    let mdns = mdns.lock().map(|m| m.clone()).unwrap_or_default();
    let scanned = scanned.lock().map(|m| m.clone()).unwrap_or_default();

    // 1. UDP beacons take highest priority (live broadcast beacon direct from phone)
    let mut list: Vec<Device> = udp.into_values().map(|(d, _)| d).collect();

    // 2. Add LAN scanned devices if not already present
    for dev in scanned.into_values() {
        let exists = list.iter().any(|d| d.base_url == dev.base_url || (d.name.eq_ignore_ascii_case(&dev.name) && d.port == dev.port));
        if !exists {
            list.push(dev);
        }
    }

    // 3. Add mDNS devices if not already present
    for dev in mdns.into_values() {
        let exists = list.iter().any(|d| d.base_url == dev.base_url || (d.name.eq_ignore_ascii_case(&dev.name) && d.port == dev.port));
        if !exists {
            list.push(dev);
        }
    }

    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list
}

// Retain merge_devices for backward compatibility in tests
#[allow(dead_code)]
pub fn merge_devices(
    mdns: &Arc<Mutex<HashMap<String, Device>>>,
    scanned: &Arc<Mutex<HashMap<String, Device>>>,
) -> Vec<Device> {
    let empty_udp = Arc::new(Mutex::new(HashMap::new()));
    merge_devices_all(&empty_udp, mdns, scanned)
}

async fn scan_local_network(client: &reqwest::Client) -> HashMap<String, Device> {
    let Some(local) = local_ipv4() else {
        return HashMap::new();
    };
    let octets = local.octets();
    if lan_rank(local) >= 4 {
        return HashMap::new();
    }
    let prefix = format!("{}.{}.{}", octets[0], octets[1], octets[2]);

    let hosts = (1u8..=254)
        .filter(|last| *last != octets[3])
        .flat_map(|last| {
            let host = format!("{prefix}.{last}");
            (8765u16..=8766).map(move |port| (host.clone(), port))
        });

    let found: Vec<Device> = stream::iter(hosts)
        .map(|(host, port)| {
            let client = client.clone();
            async move {
                let url = format!("http://{host}:{port}/health");
                let start = Instant::now();
                let health = client
                    .get(&url)
                    .send()
                    .await
                    .ok()?
                    .error_for_status()
                    .ok()?
                    .json::<Health>()
                    .await
                    .ok()?;
                if !health.ok || health.app != "vibecast" {
                    return None;
                }
                let ping_ms = start.elapsed().as_millis().max(1) as u64;
                let base_url = format!("http://{host}:{port}");
                Some(Device {
                    id: format!("lan:{base_url}"),
                    name: health.device_name,
                    host,
                    port,
                    base_url,
                    version: Some(health.protocol.to_string()),
                    token_required: true,
                    ping_ms: Some(ping_ms),
                    source: Some("LAN Scan".to_string()),
                })
            }
        })
        .buffer_unordered(64)
        .filter_map(|device| async move { device })
        .collect()
        .await;

    found
        .into_iter()
        .map(|device| (device.id.clone(), device))
        .collect()
}

pub fn pick_address(addresses: &std::collections::HashSet<Ipv4Addr>) -> Option<Ipv4Addr> {
    let local = local_ipv4();
    addresses
        .iter()
        .copied()
        .filter(|ip| lan_rank(*ip) < 4)
        .min_by_key(|ip| {
            let same_lan = local
                .map(|local| local.octets()[..3] == ip.octets()[..3])
                .unwrap_or(false);
            (if same_lan { 0 } else { 1 }, lan_rank(*ip), ip.octets())
        })
}

pub fn local_ipv4() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

pub fn lan_rank(ip: Ipv4Addr) -> u8 {
    match ip.octets() {
        [192, 168, _, _] => 0,
        [10, _, _, _] => 1,
        [172, second, _, _] if (16..=31).contains(&second) => 2,
        [169, 254, _, _] => 5,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Device;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, Mutex};

    fn device(id: &str, name: &str, host: &str, port: u16) -> Device {
        Device {
            id: id.to_string(),
            name: name.to_string(),
            host: host.to_string(),
            port,
            base_url: format!("http://{host}:{port}"),
            version: Some("1".to_string()),
            token_required: true,
            ping_ms: Some(10),
            source: Some("test".to_string()),
        }
    }

    #[test]
    fn prefers_private_lan_addresses() {
        assert!(lan_rank("192.168.1.10".parse().unwrap()) < lan_rank("10.0.0.2".parse().unwrap()));
        assert!(lan_rank("10.0.0.2".parse().unwrap()) < lan_rank("26.169.103.13".parse().unwrap()));
        assert!(
            lan_rank("26.169.103.13".parse().unwrap()) < lan_rank("169.254.1.1".parse().unwrap())
        );
    }

    #[test]
    fn skips_public_and_link_local_addresses() {
        let addresses = [
            "26.169.103.13".parse().unwrap(),
            "169.254.10.10".parse().unwrap(),
        ]
        .into_iter()
        .collect::<HashSet<_>>();
        assert_eq!(pick_address(&addresses), None);
    }

    #[test]
    fn scanned_address_wins_over_stale_mdns_entry() {
        let mdns = Arc::new(Mutex::new(HashMap::from([
            (
                "old".to_string(),
                device("old", "samsung SM-A546E", "192.168.1.40", 8765),
            ),
            (
                "pixel".to_string(),
                device("pixel", "Pixel 8", "192.168.1.50", 8765),
            ),
        ])));
        let scanned = Arc::new(Mutex::new(HashMap::from([(
            "new".to_string(),
            device("new", "samsung SM-A546E", "192.168.1.13", 8765),
        )])));

        let merged = merge_devices(&mdns, &scanned);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].name, "Pixel 8");
        assert_eq!(merged[1].name, "samsung SM-A546E");
        assert_eq!(merged[1].host, "192.168.1.13");
    }

    #[test]
    fn udp_broadcast_takes_priority_and_merges_cleanly() {
        let udp = Arc::new(Mutex::new(HashMap::from([(
            "udp:192.168.1.15:8765".to_string(),
            (device("udp:192.168.1.15:8765", "Galaxy Ultra", "192.168.1.15", 8765), Instant::now()),
        )])));
        let mdns = Arc::new(Mutex::new(HashMap::from([(
            "mdns:192.168.1.20".to_string(),
            device("mdns:192.168.1.20", "Pixel Tablet", "192.168.1.20", 8765),
        )])));
        let scanned = Arc::new(Mutex::new(HashMap::new()));

        let merged = merge_devices_all(&udp, &mdns, &scanned);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].name, "Galaxy Ultra");
        assert_eq!(merged[1].name, "Pixel Tablet");
    }
}
