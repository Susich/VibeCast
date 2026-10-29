// Development helper: print VibeCast mDNS events from the local network.
// Useful to distinguish "phone does not advertise" from "desktop app misses it".
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent};

fn main() {
    let daemon = ServiceDaemon::new().expect("start mDNS daemon");
    let receiver = daemon
        .browse("_vibecast._tcp.local.")
        .expect("start browse");
    println!("Browsing for _vibecast._tcp.local. for 20 seconds...");
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                println!(
                    "RESOLVED {} port={} addresses={:?} txt={:?}",
                    info.get_fullname(),
                    info.get_port(),
                    info.get_addresses(),
                    info.get_properties()
                );
            }
            Ok(ServiceEvent::ServiceFound(ty, name)) => {
                println!("FOUND {ty} {name}");
            }
            Ok(ServiceEvent::ServiceRemoved(ty, name)) => {
                println!("REMOVED {ty} {name}");
            }
            Ok(ServiceEvent::SearchStarted(ty)) => println!("SEARCH {ty}"),
            Ok(other) => println!("EVENT {other:?}"),
            Err(_) => {}
        }
    }
    let _ = daemon.shutdown();
}
