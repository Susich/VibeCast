import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatTime } from "../lib/format";
import { useStore } from "../store";
import type { TrackRow } from "../lib/types";
import { Cover } from "./Cover";
import { DownloadIcon, MusicIcon, PlayIcon, SearchIcon, SpinnerIcon, TrashIcon, WifiOffIcon } from "./Icons";

function Equalizer() {
  return (
    <span className="equalizer" aria-label="Играет">
      <i />
      <i />
      <i />
    </span>
  );
}

function TrackRowItem({
  track,
  index,
  active,
  playing,
  onPlay,
}: {
  track: TrackRow;
  index: number;
  active: boolean;
  playing: boolean;
  onPlay: () => void;
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
  const libraryError = useStore((state) => state.libraryError);
  const openConnect = useStore((state) => state.openConnect);
  const navigate = useStore((state) => state.navigate);

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

  if (libraryError) {
    return (
      <div className="empty-state">
        <div className="empty-icon error">
          <WifiOffIcon size={30} />
        </div>
        <h3>Не удалось прочитать каталог</h3>
        <p>{libraryError}</p>
        <button className="primary-button" onClick={() => navigate("tracks")}>
          Повторить
        </button>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <MusicIcon size={32} />
        </div>
        <h3>Здесь появится ваша музыка</h3>
        <p>Подключите телефон с VibeCast по Wi-Fi — каталог загрузится автоматически.</p>
        <button className="primary-button" onClick={openConnect}>
          Подключить телефон
        </button>
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
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
