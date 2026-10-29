import { useEffect } from "react";

import { formatCount, isEditableTarget } from "./lib/format";
import { useStore } from "./store";
import { AlbumsView, ArtistsView } from "./components/BrowseViews";
import { ConnectModal } from "./components/ConnectModal";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TrackList } from "./components/TrackList";
import { DiscIcon, MusicIcon, RadioIcon, UsersIcon, WifiOffIcon, XIcon } from "./components/Icons";

function ViewHeader() {
  const view = useStore((state) => state.view);
  const artist = useStore((state) => state.artist);
  const album = useStore((state) => state.album);
  const total = useStore((state) => state.total);
  const stats = useStore((state) => state.stats);
  const facets = useStore((state) => state.facets);
  const clearFilters = useStore((state) => state.clearFilters);
  const loading = useStore((state) => state.loading);

  if (view === "artists") {
    return (
      <div className="view-header">
        <div>
          <span className="eyebrow">Библиотека</span>
          <h1>Исполнители</h1>
          <p>
            {formatCount(facets.artists.length, "исполнитель", "исполнителя", "исполнителей")} ·{" "}
            {formatCount(stats.tracks, "трек", "трека", "треков")}
          </p>
        </div>
        <div className="view-mark">
          <UsersIcon size={30} />
        </div>
      </div>
    );
  }

  if (view === "albums") {
    return (
      <div className="view-header">
        <div>
          <span className="eyebrow">Библиотека</span>
          <h1>Альбомы</h1>
          <p>
            {formatCount(facets.albums.length, "альбом", "альбома", "альбомов")} ·{" "}
            {formatCount(stats.tracks, "трек", "трека", "треков")}
          </p>
        </div>
        <div className="view-mark">
          <DiscIcon size={30} />
        </div>
      </div>
    );
  }

  const title = album ?? artist ?? "Все треки";
  const subtitle = album && artist ? artist : artist ? "Все треки исполнителя" : "Ваша локальная библиотека";

  return (
    <div className="view-header">
      <div>
        <span className="eyebrow">{album ? "Альбом" : artist ? "Исполнитель" : "Библиотека"}</span>
        <h1>{title}</h1>
        <p>
          {loading ? "Обновляем…" : `${formatCount(total, "трек", "трека", "треков")} · ${subtitle}`}
          {stats.version > 0 && <span className="version-pill">v{stats.version}</span>}
        </p>
        {(artist || album) && (
          <button className="filter-chip" onClick={clearFilters}>
            {album && artist ? `${artist} — ${album}` : album ?? artist}
            <XIcon size={13} />
          </button>
        )}
      </div>
      <div className="view-mark">
        {album ? <DiscIcon size={30} /> : artist ? <UsersIcon size={30} /> : <MusicIcon size={30} />}
      </div>
    </div>
  );
}

function OfflineBanner() {
  return (
    <div className="offline-banner">
      <WifiOffIcon size={17} />
      <span>
        <b>Телефон недоступен.</b> Каталог сохранён — треки из кэша продолжают играть. Переподключение
        произойдёт автоматически.
      </span>
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo">
        <RadioIcon size={34} />
      </div>
      <h1>VibeCast</h1>
      <p>Музыка с телефона — на этом компьютере.</p>
      <span className="splash-loader" />
    </div>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="splash">
      <div className="splash-logo error">
        <WifiOffIcon size={32} />
      </div>
      <h1>Не удалось запустить VibeCast</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={() => window.location.reload()}>
        Попробовать снова
      </button>
    </div>
  );
}

export default function App() {
  const booted = useStore((state) => state.booted);
  const bootError = useStore((state) => state.bootError);
  const server = useStore((state) => state.server);
  const view = useStore((state) => state.view);
  const search = useStore((state) => state.search);
  const connectOpen = useStore((state) => state.connectOpen);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const queueOpen = useStore((state) => state.queueOpen);
  const init = useStore((state) => state.init);
  const refreshLibrary = useStore((state) => state.refreshLibrary);
  const next = useStore((state) => state.next);
  const prev = useStore((state) => state.prev);
  const toggle = useStore((state) => state.toggle);
  const closeConnect = useStore((state) => state.closeConnect);
  const closeSettings = useStore((state) => state.closeSettings);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const loading = useStore((state) => state.loading);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(() => {
      void refreshLibrary();
    }, 180);
    return () => clearTimeout(timer);
  }, [booted, search, refreshLibrary]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (connectOpen) closeConnect();
        else if (settingsOpen) closeSettings();
        else if (queueOpen) toggleQueue();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (connectOpen || settingsOpen) return;

      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void toggle();
      } else if (event.key === "ArrowRight" && event.shiftKey) {
        event.preventDefault();
        void next();
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        void prev();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    connectOpen,
    settingsOpen,
    queueOpen,
    closeConnect,
    closeSettings,
    toggleQueue,
    toggle,
    next,
    prev,
  ]);

  if (bootError) return <BootError message={bootError} />;
  if (!booted) return <Splash />;

  return (
    <div className={`app ${queueOpen ? "queue-is-open" : ""}`}>
      <Sidebar />
      <div className="workspace">
        <TopBar />
        {server && !server.online && <OfflineBanner />}
        <main className="content">
          <ViewHeader />
          {loading && <div className="refresh-line" />}
          {view === "tracks" && <TrackList />}
          {view === "artists" && <ArtistsView />}
          {view === "albums" && <AlbumsView />}
        </main>
      </div>
      <PlayerBar />
      <QueuePanel />
      <ConnectModal />
      <SettingsModal />
      <Toasts />
    </div>
  );
}
