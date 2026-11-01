import { useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

import { call } from "../lib/api";
import { useStore } from "../store";
import { Cover } from "./Cover";
import {
  ExpandIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "./Icons";

export function MiniOverlay() {
  const player = useStore((state) => state.player);
  const toggle = useStore((state) => state.toggle);
  const next = useStore((state) => state.next);
  const prev = useStore((state) => state.prev);
  const setVolume = useStore((state) => state.setVolume);
  const toggleOverlay = useStore((state) => state.toggleOverlay);

  const [lastVolume, setLastVolume] = useState(80);
  const isMuted = player.volume === 0;

  const current = player.currentTrackId;
  const isPlaying = !player.paused && !!current;

  const handleStartDrag = (e: MouseEvent) => {
    // Only drag when clicking non-interactive elements
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("input")
    ) {
      return;
    }
    void call("start_window_drag").catch(() => undefined);
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      setVolume(lastVolume > 0 ? lastVolume : 80);
    } else {
      setLastVolume(player.volume);
      setVolume(0);
    }
  };

  return (
    <div
      className="mini-overlay"
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
    >
      <div className="mini-header" data-tauri-drag-region>
        <div className="mini-brand" data-tauri-drag-region>
          <span className="mini-dot live" />
          <span className="mini-title-bar">VibeCast</span>
          {player.source && (
            <span className={`source-badge mini ${player.source}`}>
              {player.source === "cache" ? "кэш" : "стрим"}
            </span>
          )}
        </div>
        <div className="mini-actions">
          <button
            className="icon-button compact ghost"
            onClick={() => void toggleOverlay(false)}
            title="Развернуть в полное окно"
          >
            <ExpandIcon size={14} />
          </button>
        </div>
      </div>

      <div className="mini-main" data-tauri-drag-region>
        <div className="mini-cover-wrap">
          {current ? (
            <Cover trackId={current} title={player.album ?? player.title ?? ""} size={38} />
          ) : (
            <div className="cover cover-empty mini-cover">
              <MusicIcon size={16} />
            </div>
          )}
        </div>

        <div className="mini-info" data-tauri-drag-region>
          <div className="mini-track-title">{player.title ?? "Ничего не играет"}</div>
          <div className="mini-track-artist">
            {player.artist ?? "Выберите трек на ПК"}
          </div>
        </div>

        {/* Compact Animated VU-Meter / Equalizer */}
        <div className={`vu-meter mini ${isPlaying ? "playing" : "paused"}`} title="VU-метр">
          <span className="vu-bar bar-1" />
          <span className="vu-bar bar-2" />
          <span className="vu-bar bar-3" />
          <span className="vu-bar bar-4" />
          <span className="vu-bar bar-5" />
          <span className="vu-bar bar-6" />
        </div>
      </div>

      <div className="mini-controls" data-tauri-drag-region>
        <div className="mini-transport">
          <button
            className="mini-btn"
            onClick={() => void prev()}
            disabled={!current}
            title="Предыдущий"
          >
            <SkipBackIcon size={14} />
          </button>
          <button
            className="mini-btn play-btn"
            onClick={() => void toggle()}
            disabled={!current}
            title={!current || player.paused ? "Играть" : "Пауза"}
          >
            {player.loading || player.buffering ? (
              <span className="play-spinner mini" />
            ) : !current || player.paused ? (
              <PlayIcon size={14} />
            ) : (
              <PauseIcon size={14} />
            )}
          </button>
          <button
            className="mini-btn"
            onClick={() => void next()}
            title="Следующий"
          >
            <SkipForwardIcon size={14} />
          </button>
        </div>

        <div className="mini-volume">
          <button
            className="icon-button compact ghost"
            onClick={handleMuteToggle}
            title={isMuted ? "Включить звук (Unmute)" : "Заглушить (Mute)"}
          >
            {isMuted ? <VolumeOffIcon size={14} /> : <VolumeIcon size={14} />}
          </button>
          <input
            className="volume-range mini"
            type="range"
            min={0}
            max={100}
            step={1}
            value={player.volume}
            style={{ "--range-progress": `${player.volume}%` } as CSSProperties}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Громкость оверлея"
          />
        </div>
      </div>
    </div>
  );
}
