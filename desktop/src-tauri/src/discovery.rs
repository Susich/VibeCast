use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::{AppHandle, Emitter};

use crate::models::{Device, Health};

pub struct Discovery {
    // Keeping the daemon alive keeps the browse thread and socket alive.
    _daemon: Option<ServiceDaemon>,
    devices: Arc<Mutex<HashMap<String, Device>>>,
    scanned: Arc<Mutex<HashMap<String, Device>>>,
    stop: Arc<AtomicBool>,
}

impl Discovery {
    pub fn start(app: AppHandle) -> Self {
        let devices = Arc::new(Mutex::new(HashMap::<String, Device>::new()));
        let scanned = Arc::new(Mutex::new(HashMap::<String, Device>::new()));
        let stop = Arc::new(AtomicBool::new(false));

        // A failed mdns-sd daemon must not disable the LAN health scan below.
        let mdns_daemon = match ServiceDaemon::new() {
            Ok(daemon) => match daemon.browse("_vibecast._tcp.local.") {
                Ok(receiver) => {
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
                                emit_merged(&thread_app, &thread_devices, &thread_scanned);
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

        // NsdManager or a router/firewall can silently block multicast. The
        // phone also exposes a public /health endpoint, so probe the local /24
        // as a fallback. This keeps discovery working on networks where mDNS
        // packets never leave the phone (or never reach this PC).
        let scan_app = app;
        let scan_devices = devices.clone();
        let scan_scanned = scanned.clone();
        let scan_stop = stop.clone();
        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder()
                .connect_timeout(Duration::from_millis(300))
                .timeout(Duration::from_millis(900))
                // A system HTTP proxy cannot reach the phone's LAN address.
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
                    emit_merged(&scan_app, &scan_devices, &scan_scanned);
                }
                tokio::time::sleep(Duration::from_secs(8)).await;
            }
        });

        Self {
            _daemon: mdns_daemon,
            devices,
            scanned,
            stop,
        }
    }

    pub fn devices(&self) -> Vec<Device> {
        merge_devices(&self.devices, &self.scanned)
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn emit_merged(
    app: &AppHandle,
    mdns: &Arc<Mutex<HashMap<String, Device>>>,
    scanned: &Arc<Mutex<HashMap<String, Device>>>,
) {
    let list = merge_devices(mdns, scanned);
    let _ = app.emit("discovery://devices", list);
}

fn merge_devices(
    mdns: &Arc<Mutex<HashMap<String, Device>>>,
    scanned: &Arc<Mutex<HashMap<String, Device>>>,
) -> Vec<Device> {
    let mdns = match mdns.lock() {
        Ok(map) => map,
        Err(_) => return Vec::new(),
    };
    let scanned = match scanned.lock() {
        Ok(map) => map,
        Err(_) => return Vec::new(),
    };

    // Prefer the HTTP-scanned entry: it is based on a fresh /health response
    // and therefore has the phone's current address even after a DHCP change.
    let mut list: Vec<Device> = scanned.values().cloned().collect();
    for device in mdns.values() {
        let duplicate_url = list.iter().any(|item| item.base_url == device.base_url);
        let duplicate_phone = list
            .iter()
            .any(|item| item.name.eq_ignore_ascii_case(&device.name) && item.port == device.port);
        if !duplicate_url && !duplicate_phone {
            list.push(device.clone());
        }
    }
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list
}

/// Probe the PC's local /24 for the Android `/health` endpoint. Only ports
/// 8765-8766 are checked: the Android service takes the first free port and
/// normally starts at 8765.
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
                let health = client
                    .get(url)
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
                let base_url = format!("http://{host}:{port}");
                Some(Device {
                    id: format!("lan:{base_url}"),
                    name: health.device_name,
                    host,
                    port,
                    base_url,
                    version: Some(health.protocol.to_string()),
                    token_required: true,
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

/// Prefer the address that shares a /24 with the PC's default route, then
/// ordinary home/office LAN ranges, over VPN/virtual adapters. A phone that
/// advertises several IPv4 addresses should remain reachable.
fn pick_address(addresses: &std::collections::HashSet<Ipv4Addr>) -> Option<Ipv4Addr> {
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

fn local_ipv4() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

fn lan_rank(ip: Ipv4Addr) -> u8 {
    match ip.octets() {
        [192, 168, _, _] => 0,
        [10, _, _, _] => 1,
        [172, second, _, _] if (16..=31).contains(&second) => 2,
        [169, 254, _, _] => 5,
        // Public, CGNAT and VPN ranges are never a phone's LAN address.
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::{lan_rank, merge_devices, pick_address};
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
}
