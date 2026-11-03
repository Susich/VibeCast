import { useEffect } from "react";

import { formatCount, isEditableTarget } from "./lib/format";
import { useStore } from "./store";
import { AlbumsView, ArtistsView } from "./components/BrowseViews";
import { ConnectModal } from "./components/ConnectModal";
import { MiniOverlay } from "./components/MiniOverlay";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TrackList } from "./components/TrackList";
import { DiscIcon, DownloadIcon, MusicIcon, RadioIcon, UsersIcon, WifiOffIcon, XIcon } from "./components/Icons";

function ViewHeader() {
  const view = useStore((state) => state.view);
  const artist = useStore((state) => state.artist);
  const album = useStore((state) => state.album);
  const total = useStore((state) => state.total);
  const facets = useStore((state) => state.facets);
  const clearFilters = useStore((state) => state.clearFilters);
  const loading = useStore((state) => state.loading);

  let title = "Все треки";
  let countStr = formatCount(total, "трек", "трека", "треков");

  if (view === "cached") {
    title = "В кэше";
    countStr = formatCount(total, "трек", "трека", "треков");
  } else if (view === "artists") {
    title = "Исполнители";
    countStr = formatCount(facets.artists.length, "исполнитель", "исполнителя", "исполнителей");
  } else if (view === "albums") {
    title = "Альбомы";
    countStr = formatCount(facets.albums.length, "альбом", "альбома", "альбомов");
  } else if (album) {
    title = album;
  } else if (artist) {
    title = artist;
  }

  return (
    <div className="view-header">
      <div className="view-header-main">
        <h1>{title}</h1>
        <span className="view-count">{loading ? "…" : countStr}</span>
      </div>
      {(artist || album) && view === "tracks" && (
        <button className="filter-chip" onClick={clearFilters} title="Сбросить фильтр">
          {album && artist ? `${artist} — ${album}` : album ?? artist}
          <XIcon size={12} />
        </button>
      )}
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
        <img src="/logo.png" alt="VibeCast" className="splash-logo-img" />
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
  const isOverlay = useStore((state) => state.isOverlay);
  const overlayTransition = useStore((state) => state.overlayTransition);
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
    document.body.classList.toggle("is-overlay", isOverlay);
    document.documentElement.classList.toggle("is-overlay", isOverlay);
  }, [isOverlay]);

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

  if (isOverlay) {
    return (
      <div className="overlay-root" style={{ background: "transparent" }}>
        <MiniOverlay />
      </div>
    );
  }

  const isCollapsingToWidget = overlayTransition === "collapsing_to_widget";

  return (
    <div className={`app ${queueOpen ? "queue-is-open" : ""} ${isCollapsingToWidget ? "collapsing-to-widget" : ""}`}>
      <Sidebar />
      <div className="workspace">
        <TopBar />
        {server && !server.online && <OfflineBanner />}
        <main className="content">
          <ViewHeader />
          {loading && <div className="refresh-line" />}
          {(view === "tracks" || view === "cached") && <TrackList />}
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
