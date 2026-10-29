import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatCount } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import {
  DiscIcon,
  DownloadIcon,
  ListMusicIcon,
  MusicIcon,
  QueueIcon,
  RadioIcon,
  ServerIcon,
  SmartphoneIcon,
  UsersIcon,
  WifiOffIcon,
} from "./Icons";

function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function Sidebar() {
  const server = useStore((state) => state.server);
  const stats = useStore((state) => state.stats);
  const cachedCount = useStore((state) => state.cachedCount);
  const view = useStore((state) => state.view);
  const facets = useStore((state) => state.facets);
  const search = useStore((state) => state.search);
  const queue = useStore((state) => state.queue);
  const queueIndex = useStore((state) => state.queueIndex);
  const navigate = useStore((state) => state.navigate);
  const selectArtist = useStore((state) => state.selectArtist);
  const selectAlbum = useStore((state) => state.selectAlbum);
  const playQueueItem = useStore((state) => state.playQueueItem);
  const openConnect = useStore((state) => state.openConnect);
  const openSettings = useStore((state) => state.openSettings);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const displayName = server?.deviceName ?? "VibeCast";

  const needle = search.trim().toLocaleLowerCase("ru");
  const artists = needle
    ? facets.artists.filter((item) => item.name.toLocaleLowerCase("ru").includes(needle))
    : facets.artists;
  const albums = needle
    ? facets.albums.filter((item) =>
        `${item.album} ${item.artist}`.toLocaleLowerCase("ru").includes(needle),
      )
    : facets.albums;

  const listRef = useRef<HTMLDivElement>(null);
  const isArtists = view === "artists";
  const isAlbums = view === "albums";
  const rows = isArtists ? artists.length : isAlbums ? albums.length : 0;
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => listRef.current,
    estimateSize: () => (isAlbums ? 58 : 42),
    overscan: 8,
  });

  const upcoming = queue
    .map((track, index) => ({ track, index }))
    .filter((item) => item.index > queueIndex)
    .slice(0, 3);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <RadioIcon size={19} />
        </div>
        <div>
          <div className="brand-name">VibeCast</div>
          <div className="brand-sub">музыка с телефона</div>
        </div>
      </div>

      <button className={`server-card ${server?.online ? "online" : ""}`} onClick={openConnect} title="Подключить телефон">
        <div className="server-phone">
          {server ? <SmartphoneIcon size={20} /> : <ServerIcon size={20} />}
        </div>
        <div className="server-copy">
          <div className="server-name">{displayName}</div>
          <div className="server-state">
            {server
              ? server.online
                ? hostOf(server.baseUrl)
                : "телефон недоступен"
              : "телефон не подключён"}
          </div>
        </div>
        <span className={`status-dot ${server?.online ? "live" : "idle"}`} />
      </button>

      <nav className="nav">
        <button className={`nav-item ${view === "tracks" ? "active" : ""}`} onClick={() => navigate("tracks")}>
          <MusicIcon size={18} />
          <span>Все треки</span>
          <em>{stats.tracks || ""}</em>
        </button>
        <button className={`nav-item ${view === "artists" ? "active" : ""}`} onClick={() => navigate("artists")}>
          <UsersIcon size={18} />
          <span>Исполнители</span>
          <em>{stats.artists || ""}</em>
        </button>
        <button className={`nav-item ${view === "albums" ? "active" : ""}`} onClick={() => navigate("albums")}>
          <DiscIcon size={18} />
          <span>Альбомы</span>
          <em>{stats.albums || ""}</em>
        </button>
      </nav>

      <div className="sidebar-section-head">
        <span>
          {isArtists ? "Исполнители" : isAlbums ? "Альбомы" : "Библиотека"}
        </span>
        <span className="sidebar-section-count">{rows || stats.tracks}</span>
      </div>

      <div className="sidebar-scroll" ref={listRef}>
        {isArtists && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const artist = artists[item.index];
              if (!artist) return null;
              return (
                <button
                  key={artist.name}
                  className="facet-row"
                  style={{ transform: `translateY(${item.start}px)`, height: item.size }}
                  onClick={() => selectArtist(artist.name)}
                >
                  <span className="facet-avatar">{artist.name.slice(0, 1).toUpperCase()}</span>
                  <span className="facet-name">{artist.name}</span>
                  <span className="facet-count">{artist.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {isAlbums && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const album = albums[item.index];
              if (!album) return null;
              return (
                <button
                  key={`${album.artist}:${album.album}`}
                  className="album-mini"
                  style={{ transform: `translateY(${item.start}px)`, height: item.size }}
                  onClick={() => selectAlbum(album.album, album.artist)}
                >
                  {album.coverTrackId ? (
                    <Cover trackId={album.coverTrackId} title={album.album} size={38} />
                  ) : (
                    <div className="cover cover-empty" style={{ width: 38, height: 38 }}>
                      <DiscIcon size={16} />
                    </div>
                  )}
                  <span className="album-mini-copy">
                    <span className="album-mini-title">{album.album}</span>
                    <span className="album-mini-artist">{album.artist}</span>
                  </span>
                  <span className="facet-count">{album.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {!isArtists && !isAlbums && (
          <div className="sidebar-panels">
            {!server && (
              <div className="sidebar-note">
                <WifiOffIcon size={17} />
                <span>Подключите телефон по Wi-Fi, чтобы увидеть библиотеку.</span>
              </div>
            )}

            <div className="stat-grid">
              <div>
                <b>{stats.tracks}</b>
                <span>{formatCount(stats.tracks, "трек", "трека", "треков")}</span>
              </div>
              <div>
                <b>{stats.artists}</b>
                <span>{formatCount(stats.artists, "артист", "артиста", "артистов")}</span>
              </div>
              <div>
                <b>{stats.albums}</b>
                <span>{formatCount(stats.albums, "альбом", "альбома", "альбомов")}</span>
              </div>
            </div>

            <button className="cache-card" onClick={openSettings} title="Настройки кэша">
              <span className="cache-icon">
                <DownloadIcon size={18} />
              </span>
              <span>
                <b>{formatCount(cachedCount, "трек", "трека", "треков")} в кэше</b>
                <small>повторное воспроизведение с диска</small>
              </span>
            </button>

            <div className="queue-preview-head">
              <span>Дальше в очереди</span>
              <button className="icon-button tiny" onClick={toggleQueue} title="Открыть очередь">
                <ListMusicIcon size={16} />
              </button>
            </div>

            {upcoming.length > 0 ? (
              <div className="queue-preview">
                {upcoming.map(({ track, index }) => (
                  <button key={`${track.id}:${index}`} className="queue-mini" onClick={() => playQueueItem(index)}>
                    <Cover trackId={track.id} title={track.album} size={30} />
                    <span>
                      <b>{track.title}</b>
                      <small>{track.artist}</small>
                    </span>
                    <QueueIcon size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="queue-empty">
                <QueueIcon size={25} />
                <span>Очередь пуста</span>
                <small>Дважды щёлкните трек, чтобы начать</small>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <span>VibeCast 0.1.0</span>
        <span className="foot-dot" />
        <span>локальная сеть</span>
      </div>
    </aside>
  );
}
