// Development helper: advertise the Node mock server over mDNS so the
// desktop discovery list can be tested without an Android phone.
//
// Run the mock server first, then:
//   cargo run --example publish_mdns
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
    let daemon = ServiceDaemon::new().expect("start mDNS daemon");
    let properties = [
        ("version", "3"),
        ("token_required", "1"),
        ("device", "VibeCast Mock"),
    ];
    let service = ServiceInfo::new(
        "_vibecast._tcp.local.",
        "VibeCast-Mock",
        &format!("vibecast-mock.local."),
        ip.as_str(),
        8765,
        &properties[..],
    )
    .expect("build service info")
    .enable_addr_auto();
    daemon.register(service).expect("register service");

    println!("Advertising VibeCast-Mock at {ip}:8765; press Ctrl+C to stop");
    std::thread::sleep(Duration::from_secs(600));
    let _ = daemon.shutdown();
}
