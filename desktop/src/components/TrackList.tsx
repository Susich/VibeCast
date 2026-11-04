import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatTime } from "../lib/format";
import { useStore } from "../store";
import type { TrackRow } from "../lib/types";
import { Cover } from "./Cover";
import {
  DownloadIcon,
  ListPlusIcon,
  MoreVerticalIcon,
  PlayIcon,
  SearchIcon,
  SkipForwardIcon,
  SpinnerIcon,
  TrashIcon,
  WifiOffIcon,
} from "./Icons";

function Equalizer() {
  return (
    <span className="equalizer" aria-label="Играет">
      <i />
      <i />
      <i />
    </span>
  );
}

interface ContextMenuState {
  track: TrackRow;
  x: number;
  y: number;
}

function TrackContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const playTrack = useStore((s) => s.playTrack);
  const playNext = useStore((s) => s.playNext);
  const addToQueue = useStore((s) => s.addToQueue);
  const cacheTrack = useStore((s) => s.cacheTrack);
  const deleteCachedTrack = useStore((s) => s.deleteCachedTrack);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const x = Math.min(state.x, window.innerWidth - 230);
  const y = Math.min(state.y, window.innerHeight - 250);

  return (
    <div
      ref={menuRef}
      className="custom-dropdown-menu track-context-menu menu-enter"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">{state.track.title}</span>
        <span className="context-menu-artist">{state.track.artist}</span>
      </div>
      <div className="context-menu-divider" />
      <button
        className="track-context-item"
        onClick={() => {
          onClose();
          playTrack(state.track);
        }}
      >
        <PlayIcon size={14} />
        <span>Воспроизвести сейчас</span>
      </button>
      <button
        className="track-context-item"
        onClick={() => {
          onClose();
          playNext(state.track);
        }}
      >
        <SkipForwardIcon size={14} />
        <span>Слушать следующим</span>
      </button>
      <button
        className="track-context-item"
        onClick={() => {
          onClose();
          addToQueue(state.track);
        }}
      >
        <ListPlusIcon size={14} />
        <span>В конец очереди</span>
      </button>
      <div className="context-menu-divider" />
      {state.track.cached ? (
        <button
          className="track-context-item danger"
          onClick={() => {
            onClose();
            void deleteCachedTrack(state.track.id);
          }}
        >
          <TrashIcon size={14} />
          <span>Удалить из кэша</span>
        </button>
      ) : (
        <button
          className="track-context-item"
          onClick={() => {
            onClose();
            void cacheTrack(state.track.id);
          }}
        >
          <DownloadIcon size={14} />
          <span>Сохранить в кэш</span>
        </button>
      )}
    </div>
  );
}

function TrackRowItem({
  track,
  index,
  active,
  playing,
  onPlay,
  onOpenMenu,
}: {
  track: TrackRow;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
  onOpenMenu: (track: TrackRow, e: React.MouseEvent) => void;
}) {
  const loadCover = useStore((state) => state.loadCover);
  const progress = useStore((state) => state.progress[track.id]);
  const deleteCachedTrack = useStore((state) => state.deleteCachedTrack);
  const cacheTrack = useStore((state) => state.cacheTrack);

  useEffect(() => {
    loadCover(track.id);
  }, [loadCover, track.id]);

  return (
    <div
      className={`track-row ${active ? "active" : ""}`}
      onClick={onPlay}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu(track, e);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onPlay();
        }
      }}
      tabIndex={0}
      role="row"
      aria-label={`Воспроизвести ${track.title} — ${track.artist}`}
    >
      <div className="track-index">
        {active ? (
          playing ? (
            <Equalizer />
          ) : (
            <PlayIcon size={14} />
          )
        ) : (
          <>
            <span className="index-number">{index + 1}</span>
            <span className="index-play">
              <PlayIcon size={14} />
            </span>
          </>
        )}
      </div>

      <div className="track-main">
        <Cover trackId={track.id} title={track.album} size={40} />
        <div className="track-copy">
          <span className="track-title">{track.title}</span>
          <span className="track-sub">{track.artist}</span>
        </div>
      </div>

      <div className="track-artist">{track.artist}</div>
      <div className="track-album">
        {track.album}
        {track.year ? <span className="track-year">{track.year}</span> : null}
      </div>
      <div className="track-duration">{formatTime(track.durationMs / 1000)}</div>

      <div className="track-cache">
        {progress && !progress.done ? (
          <span className="cache-progress" title="Скачивается в кэш">
            <SpinnerIcon size={13} />
            {Math.round((progress.received / Math.max(1, progress.total)) * 100)}%
          </span>
        ) : track.cached ? (
          <div className="cache-actions-wrap" onClick={(e) => e.stopPropagation()}>
            <span className="cache-badge" title="Сохранено в локальном кэше">
              кэш
            </span>
            <button
              className="track-action-btn delete-cache-btn"
              title="Удалить трек из кэша"
              aria-label="Удалить трек из кэша"
              onClick={(e) => {
                e.stopPropagation();
                void deleteCachedTrack(track.id);
              }}
            >
              <TrashIcon size={13} />
            </button>
          </div>
        ) : (
          <div className="cache-actions-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              className="track-action-btn cache-download-btn"
              title="Скачать трек в кэш"
              aria-label="Скачать трек в кэш"
              onClick={(e) => {
                e.stopPropagation();
                void cacheTrack(track.id);
              }}
            >
              <DownloadIcon size={13} />
            </button>
          </div>
        )}
        <button
          className="track-action-btn track-more-btn"
          title="Действия с треком"
          aria-label="Действия с треком"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(track, e);
          }}
        >
          <MoreVerticalIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  const view = useStore((state) => state.view);
  const server = useStore((state) => state.server);
  const search = useStore((state) => state.search);
  const artist = useStore((state) => state.artist);
  const album = useStore((state) => state.album);
  const openConnect = useStore((state) => state.openConnect);
  const navigate = useStore((state) => state.navigate);
  const cachedCount = useStore((state) => state.cachedCount);

  if (view === "cached") {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <DownloadIcon size={32} />
        </div>
        <h3>В кэше пока нет треков</h3>
        <p>
          Треки, которые вы слушаете, автоматически сохраняются на диск для офлайн-воспроизведения без сети.
        </p>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <WifiOffIcon size={32} />
        </div>
        <h3>Телефон не подключён</h3>
        <p>
          {cachedCount > 0
            ? `Телефон отключён, но у вас сохранено ${cachedCount} трек${
                cachedCount === 1 ? "" : cachedCount < 5 ? "а" : "ов"
              } в локальном кэше для прослушивания.`
            : "Запустите VibeCast на телефоне и нажмите кнопку ниже, чтобы найти его или ввести адрес."}
        </p>
        <div
          className="empty-actions"
          style={{ display: "flex", gap: "10px", marginTop: "12px", justifyContent: "center" }}
        >
          {cachedCount > 0 && (
            <button className="primary-button" onClick={() => navigate("cached")}>
              В кэш ({cachedCount})
            </button>
          )}
          <button className={cachedCount > 0 ? "secondary-button" : "primary-button"} onClick={openConnect}>
            Подключить телефон
          </button>
        </div>
      </div>
    );
  }

  const filtered = Boolean(search.trim() || artist || album);
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {filtered ? <SearchIcon size={30} /> : <WifiOffIcon size={30} />}
      </div>
      <h3>{filtered ? "Ничего не найдено" : "Каталог пуст"}</h3>
      <p>
        {filtered
          ? "Попробуйте другой запрос или сбросьте фильтр."
          : server.online
            ? "На телефоне пока нет треков. Добавьте музыку и нажмите «Обновить»."
            : "Телефон недоступен. Уже загруженные в кэш треки можно играть."}
      </p>
      {filtered && (
        <button className="primary-button" onClick={() => navigate("tracks")}>
          Сбросить фильтры
        </button>
      )}
    </div>
  );
}

export function TrackList() {
  const tracks = useStore((state) => state.tracks);
  const loading = useStore((state) => state.loading);
  const player = useStore((state) => state.player);
  const playTrack = useStore((state) => state.playTrack);
  const search = useStore((state) => state.search);
  const sort = useStore((state) => state.sort);
  const artist = useStore((state) => state.artist);
  const album = useStore((state) => state.album);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [search, sort, artist, album]);

  const handleOpenMenu = (track: TrackRow, e: React.MouseEvent) => {
    setContextMenu({
      track,
      x: e.clientX,
      y: e.clientY,
    });
  };

  if (!tracks.length && (loading || !useStore.getState().booted)) {
    return (
      <div className="track-list-wrap">
        <div className="track-header">
          <span>#</span>
          <span>Трек</span>
          <span>Исполнитель</span>
          <span>Альбом</span>
          <span className="right">Время</span>
          <span />
        </div>
        <div className="skeleton-list">
          {Array.from({ length: 9 }).map((_, index) => (
            <div className="skeleton-row" key={index}>
              <span className="skeleton cover-skeleton" />
              <span className="skeleton line wide" />
              <span className="skeleton line" />
              <span className="skeleton line short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!tracks.length) return <EmptyState />;

  return (
    <div className="track-list-wrap">
      <div className="track-header">
        <span>#</span>
        <span>Трек</span>
        <span>Исполнитель</span>
        <span>Альбом</span>
        <span className="right">Время</span>
        <span />
      </div>
      <div className="track-scroll" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const track = tracks[item.index];
            if (!track) return null;
            return (
              <div
                key={track.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TrackRowItem
                  track={track}
                  index={item.index}
                  active={player.currentTrackId === track.id}
                  playing={player.currentTrackId === track.id && !player.paused}
                  onPlay={() => playTrack(track)}
                  onOpenMenu={handleOpenMenu}
                />
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && (
        <TrackContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
