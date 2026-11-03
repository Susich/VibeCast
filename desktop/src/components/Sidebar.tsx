import { formatCount } from "../lib/format";
import { useStore } from "../store";
import {
  DiscIcon,
  DownloadIcon,
  ListMusicIcon,
  MusicIcon,
  RadioIcon,
  ServerIcon,
  SmartphoneIcon,
  UsersIcon,
} from "./Icons";

function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function Sidebar() {
  const server = useStore((state) => state.server);
  const stats = useStore((state) => state.stats);
  const cachedCount = useStore((state) => state.cachedCount);
  const view = useStore((state) => state.view);
  const queue = useStore((state) => state.queue);
  const queueIndex = useStore((state) => state.queueIndex);
  const navigate = useStore((state) => state.navigate);
  const openConnect = useStore((state) => state.openConnect);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const displayName = server?.deviceName ?? "VibeCast";

  const queueRemaining = Math.max(0, queue.length - (queueIndex + 1));

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="brand">
        <div className="brand-mark">
          <img src="/logo.png" alt="VibeCast" className="brand-logo-img" />
        </div>
        <div className="brand-text">
          <div className="brand-name">VibeCast</div>
        </div>
      </div>

      {/* Connection Status Pill */}
      <button
        className={`server-card ${server?.online ? "online" : ""}`}
        onClick={openConnect}
        title={server?.online ? `Подключено: ${displayName}` : "Подключить телефон"}
      >
        <div className="server-phone">
          {server ? <SmartphoneIcon size={18} /> : <ServerIcon size={18} />}
        </div>
        <div className="server-copy">
          <div className="server-name">{displayName}</div>
          <div className="server-state">
            {server
              ? server.online
                ? hostOf(server.baseUrl)
                : "не в сети"
              : "не подключён"}
          </div>
        </div>
        <span className={`status-dot ${server?.online ? "live" : "idle"}`} />
      </button>

      {/* Main Navigation */}
      <nav className="nav">
        <button
          className={`nav-item ${view === "tracks" ? "active" : ""}`}
          onClick={() => navigate("tracks")}
        >
          <MusicIcon size={18} />
          <span>Все треки</span>
          {stats.tracks > 0 && <em>{stats.tracks}</em>}
        </button>

        <button
          className={`nav-item ${view === "cached" ? "active" : ""}`}
          onClick={() => navigate("cached")}
        >
          <DownloadIcon size={18} />
          <span>В кэше</span>
          {cachedCount > 0 && <em>{cachedCount}</em>}
        </button>

        <button
          className={`nav-item ${view === "artists" ? "active" : ""}`}
          onClick={() => navigate("artists")}
        >
          <UsersIcon size={18} />
          <span>Исполнители</span>
          {stats.artists > 0 && <em>{stats.artists}</em>}
        </button>

        <button
          className={`nav-item ${view === "albums" ? "active" : ""}`}
          onClick={() => navigate("albums")}
        >
          <DiscIcon size={18} />
          <span>Альбомы</span>
          {stats.albums > 0 && <em>{stats.albums}</em>}
        </button>
      </nav>

      {/* Spacer to push footer to bottom */}
      <div className="sidebar-spacer" />

      {/* Optional Queue indicator if tracks are queued */}
      {queueRemaining > 0 && (
        <button className="queue-quick-btn" onClick={toggleQueue} title="Открыть очередь воспроизведения">
          <ListMusicIcon size={16} />
          <span>В очереди: {queueRemaining}</span>
        </button>
      )}

      {/* Sleek Minimal Footer */}
      <div className="sidebar-foot">
        <span>VibeCast</span>
        <span className="foot-dot" />
        <span>v0.2.3</span>
      </div>
    </aside>
  );
}
