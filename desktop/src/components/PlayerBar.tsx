import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { formatTime } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import {
  DownloadIcon,
  MusicIcon,
  OverlayIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  SkipBackIcon,
  SkipForwardIcon,
  TrashIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "./Icons";

export function PlayerBar() {
  const player = useStore((state) => state.player);
  const queue = useStore((state) => state.queue);
  const queueIndex = useStore((state) => state.queueIndex);
  const queueOpen = useStore((state) => state.queueOpen);
  const toggle = useStore((state) => state.toggle);
  const next = useStore((state) => state.next);
  const prev = useStore((state) => state.prev);
  const seek = useStore((state) => state.seek);
  const setVolume = useStore((state) => state.setVolume);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const toggleOverlay = useStore((state) => state.toggleOverlay);
  const cacheTrack = useStore((state) => state.cacheTrack);
  const deleteCachedTrack = useStore((state) => state.deleteCachedTrack);

  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState(0);

  const duration = player.duration || 0;
  const value = dragging ? draft : Math.min(player.position, duration || 0);
  const percent = duration > 0 ? Math.min(100, (value / duration) * 100) : 0;
  const current = player.currentTrackId;

  useEffect(() => {
    setDragging(false);
    setDraft(0);
  }, [current]);

  const commit = (position: number) => {
    setDragging(false);
    void seek(position);
  };

  return (
    <footer className="player-bar">
      <div className="now-playing">
        {current ? (
          <Cover trackId={current} title={player.album ?? player.title ?? ""} size={54} />
        ) : (
          <div className="cover cover-empty now-cover">
            <MusicIcon size={22} />
          </div>
        )}
        <div className="now-copy">
          <div className="now-title">{player.title ?? "Ничего не играет"}</div>
          <div className="now-sub">
            {player.artist ?? "Выберите трек, чтобы начать"}
            {player.source === "cache" && (
              <span className="source-badge cache" title="Воспроизводится из локального кэша">
                кэш
              </span>
            )}
            {current && (
              player.source === "cache" ? (
                <button
                  className="icon-button tiny ghost player-cache-btn"
                  title="Удалить этот трек из кэша"
                  aria-label="Удалить этот трек из кэша"
                  onClick={() => void deleteCachedTrack(current)}
                >
                  <TrashIcon size={12} />
                </button>
              ) : (
                <button
                  className="icon-button tiny ghost player-cache-btn"
                  title="Скачать этот трек в кэш"
                  aria-label="Скачать этот трек в кэш"
                  onClick={() => void cacheTrack(current)}
                >
                  <DownloadIcon size={12} />
                </button>
              )
            )}
          </div>
          {player.error && <div className="now-error">{player.error}</div>}
        </div>
        {current && (
          <div className={`vu-meter bar-view ${!player.paused ? "playing" : "paused"}`} title="VU-метр">
            <span className="vu-bar bar-1" />
            <span className="vu-bar bar-2" />
            <span className="vu-bar bar-3" />
            <span className="vu-bar bar-4" />
            <span className="vu-bar bar-5" />
          </div>
        )}
      </div>

      <div className="player-center">
        <div className="transport">
          <button className="transport-button" onClick={() => void prev()} disabled={!current} title="Предыдущий">
            <SkipBackIcon size={18} />
          </button>
          <button
            className="play-button"
            onClick={() => void toggle()}
            disabled={!current}
            title={!current || player.paused ? "Играть" : "Пауза"}
          >
            {player.loading || player.buffering ? (
              <span className="play-spinner" />
            ) : !current || player.paused ? (
              <PlayIcon size={20} />
            ) : (
              <PauseIcon size={20} />
            )}
          </button>
          <button className="transport-button" onClick={() => void next()} title="Следующий">
            <SkipForwardIcon size={18} />
          </button>
        </div>

        <div className="timeline">
          <span className="time">{formatTime(value)}</span>
          <input
            className="seek"
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.1}
            value={value}
            disabled={!current}
            style={{ "--range-progress": `${percent}%` } as CSSProperties}
            onPointerDown={() => {
              setDragging(true);
              setDraft(player.position);
            }}
            onChange={(event) => {
              setDragging(true);
              setDraft(Number(event.target.value));
            }}
            onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                commit(Number((event.target as HTMLInputElement).value));
              }
            }}
            aria-label="Позиция воспроизведения"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {queue.length > 0 && (
          <span className="queue-counter">
            {queueIndex + 1} / {queue.length}
          </span>
        )}
        <div className="volume">
          <button
            className="icon-button ghost"
            onClick={() => setVolume(player.volume > 0 ? 0 : 80)}
            title={player.volume > 0 ? "Выключить звук" : "Включить звук"}
          >
            {player.volume > 0 ? <VolumeIcon size={18} /> : <VolumeOffIcon size={18} />}
          </button>
          <input
            className="volume-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={player.volume}
            style={{ "--range-progress": `${player.volume}%` } as CSSProperties}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Громкость"
          />
        </div>
        <button
          className={`icon-button queue-button ${queueOpen ? "active" : ""}`}
          onClick={toggleQueue}
          title="Очередь воспроизведения"
        >
          <QueueIcon size={19} />
          {queue.length > 0 && <span className="queue-dot">{queue.length}</span>}
        </button>
        <button
          className="icon-button overlay-button"
          onClick={() => void toggleOverlay(true)}
          title="Компактный плавающий оверлей"
        >
          <OverlayIcon size={18} />
        </button>
      </div>
    </footer>
  );
}
