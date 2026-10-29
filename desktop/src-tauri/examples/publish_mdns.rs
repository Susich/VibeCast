// Development helper: advertise the Node mock server over mDNS so the
// desktop discovery list can be tested without an Android phone.
//
// Run the mock server first, then:
//   cargo run --example publish_mdns
//
// VIBECAST_MDNS_PORT and VIBECAST_MDNS_NAME override the defaults, which is
// useful for testing reconnects after the phone address or port changes.
use std::env;
use std::net::UdpSocket;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceInfo};

fn local_ipv4() -> String {
    let socket = UdpSocket::bind("0.0.0.0:0").expect("bind UDP socket");
    socket.connect("8.8.8.8:80").expect("route probe");
    socket.local_addr().expect("local address").ip().to_string()
}

fn main() {
    let ip = local_ipv4();
    let port = env::var("VIBECAST_MDNS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8765);
    let name = env::var("VIBECAST_MDNS_NAME").unwrap_or_else(|_| "VibeCast Mock".to_string());
    let instance = name.replace(' ', "-");
    let daemon = ServiceDaemon::new().expect("start mDNS daemon");
    let properties = [
        ("version", "3"),
        ("token_required", "1"),
        ("device", name.as_str()),
    ];
    let service = ServiceInfo::new(
        "_vibecast._tcp.local.",
        &instance,
        &format!("vibecast-mock.local."),
        ip.as_str(),
        port,
        &properties[..],
    )
    .expect("build service info")
    .enable_addr_auto();
    daemon.register(service).expect("register service");

    println!("Advertising {name} at {ip}:{port}; press Ctrl+C to stop");
    std::thread::sleep(Duration::from_secs(600));
    let _ = daemon.shutdown();
}
