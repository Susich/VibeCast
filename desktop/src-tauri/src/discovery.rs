use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::{AppHandle, Emitter};

use crate::models::Device;

pub struct Discovery {
    // Keeping the daemon alive keeps the browse thread and socket alive.
    _daemon: Option<ServiceDaemon>,
    devices: Arc<Mutex<HashMap<String, Device>>>,
}

impl Discovery {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS недоступен: {e}"))?;
        let receiver = daemon
            .browse("_vibecast._tcp.local.")
            .map_err(|e| format!("Не удалось начать поиск устройств: {e}"))?;

        let devices = Arc::new(Mutex::new(HashMap::<String, Device>::new()));
        let thread_devices = devices.clone();

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
                    if let Ok(map) = thread_devices.lock() {
                        let mut list: Vec<Device> = map.values().cloned().collect();
                        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                        let _ = app.emit("discovery://devices", list);
                    }
                }
            }
        });

        Ok(Self {
            _daemon: Some(daemon),
            devices,
        })
    }

    pub fn empty() -> Self {
        Self {
            _daemon: None,
            devices: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn devices(&self) -> Vec<Device> {
        let mut list: Vec<Device> = self
            .devices
            .lock()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default();
        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        list
    }
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
    use super::{lan_rank, pick_address};
    use std::collections::HashSet;

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
}
