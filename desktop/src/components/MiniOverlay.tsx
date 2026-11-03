import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";

import { call } from "../lib/api";
import { formatTime } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { CircularVisualizer } from "./CircularVisualizer";
import {
  ExpandIcon,
  MinimizeIcon,
  MusicIcon,
  PauseIcon,
  PinIcon,
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
  const seek = useStore((state) => state.seek);
  const setVolume = useStore((state) => state.setVolume);
  const toggleOverlay = useStore((state) => state.toggleOverlay);

  // Expanded = full player controls (390x185); Collapsed = compact circular bubble (88x88)
  const [expanded, setExpanded] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [lastVolume, setLastVolume] = useState(80);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);

  const isMuted = player.volume === 0;
  const current = player.currentTrackId;
  const isPlaying = !player.paused && !!current;

  const clearTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const updateWindowSize = useCallback((isExp: boolean) => {
    void call("set_overlay_compact", { compact: !isExp }).catch(() => undefined);
  }, []);

  const collapse = useCallback(() => {
    clearTimer();
    setExpanded(false);
    updateWindowSize(false);
  }, [clearTimer, updateWindowSize]);

  const expandWithTimer = useCallback(
    (durationMs = 4500) => {
      setExpanded(true);
      updateWindowSize(true);
      clearTimer();

      if (!pinned && !isHoveredRef.current) {
        collapseTimerRef.current = setTimeout(() => {
          if (!isHoveredRef.current) {
            collapse();
          }
        }, durationMs);
      }
    },
    [clearTimer, collapse, pinned, updateWindowSize],
  );

  // Listen to global hotkey triggers to reveal full player
  useEffect(() => {
    const onHotkey = (e: Event) => {
      const customEvent = e as CustomEvent<{ action: string }>;
      if (customEvent.detail?.action) {
        expandWithTimer(4500);
      }
    };

    window.addEventListener("vibecast-hotkey", onHotkey);
    return () => {
      window.removeEventListener("vibecast-hotkey", onHotkey);
    };
  }, [expandWithTimer]);

  // Initial mount: show full player for 4.5s then gently collapse to circle
  useEffect(() => {
    updateWindowSize(true);
    collapseTimerRef.current = setTimeout(() => {
      if (!isHoveredRef.current) {
        collapse();
      }
    }, 4500);
    return () => {
      clearTimer();
    };
  }, [clearTimer, collapse, updateWindowSize]);

  // When app is minimized (hidden), pause/clear collapse timer so we never resize while minimized
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clearTimer]);

  const handleStartDrag = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT" ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest(".mini-progress-bar")
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

  const handleSeekClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!player.duration || player.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * player.duration);
  };

  const onMouseEnter = () => {
    isHoveredRef.current = true;
    clearTimer();
  };

  const onMouseLeave = () => {
    isHoveredRef.current = false;
    if (expanded && !pinned) {
      expandWithTimer(3000);
    }
  };

  const progressPercent =
    player.duration > 0
      ? Math.min(100, Math.max(0, (player.position / player.duration) * 100))
      : 0;

  const volumeScale = isPlaying ? Math.max(0.3, player.volume / 100) : 0;

  // Dedicated pointer tracking for collapsed circle to guarantee click works!
  const circlePointerRef = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);

  const handleCircleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    circlePointerRef.current = {
      x: e.screenX,
      y: e.screenY,
      time: Date.now(),
      moved: false,
    };
  };

  const handleCircleMouseMove = (e: MouseEvent) => {
    if (!circlePointerRef.current) return;
    const dx = e.screenX - circlePointerRef.current.x;
    const dy = e.screenY - circlePointerRef.current.y;
    if (Math.hypot(dx, dy) >= 6) {
      circlePointerRef.current.moved = true;
      void call("start_window_drag").catch(() => undefined);
    }
  };

  const handleCircleMouseUp = (e: MouseEvent) => {
    if (!circlePointerRef.current) return;
    const { x, y, time, moved } = circlePointerRef.current;
    circlePointerRef.current = null;
    const dx = Math.abs(e.screenX - x);
    const dy = Math.abs(e.screenY - y);
    const dt = Date.now() - time;

    // If mouse didn't drag far and was released within 600ms -> user clicked it!
    if (!moved && dx < 6 && dy < 6 && dt < 600) {
      expandWithTimer(5000);
    }
  };

  // VIEW 1: Compact Floating Circle with Music Wave Aura (When Collapsed)
  if (!expanded) {
    return (
      <div
        className="mini-circle-root"
        onMouseDown={handleCircleMouseDown}
        onMouseMove={handleCircleMouseMove}
        onMouseUp={handleCircleMouseUp}
        onClick={() => expandWithTimer(5000)}
        title={
          isPlaying
            ? `${player.title ?? "VibeCast"} · Нажмите для управления`
            : "VibeCast · Нажмите для управления"
        }
      >
        {/* Radial Circular Equalizer Spectrum Visualizer */}
        <CircularVisualizer isPlaying={isPlaying} volume={player.volume} />

        {/* Circular Floating Bubble */}
        <div className={`mini-circle-bubble ${isPlaying ? "is-playing" : ""}`}>
          <img
            src="/logo.png"
            alt="VibeCast"
            className="mini-circle-logo"
            draggable={false}
          />
        </div>
      </div>
    );
  }

  // VIEW 2: Full Player Card (When Expanded via hotkey, click, or pin)
  return (
    <div
      className="mini-overlay"
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header: Clean, No glowing dot, No stream badge */}
      <div className="mini-header" data-tauri-drag-region>
        <div className="mini-brand" data-tauri-drag-region>
          <img src="/logo.png" alt="VibeCast" className="mini-brand-img" />
          <span className="mini-title-bar">VibeCast</span>
          {player.source === "cache" && (
            <span className="source-badge mini cache">кэш</span>
          )}
        </div>

        <div className="mini-actions">
          <button
            className={`icon-button compact ghost ${pinned ? "active-pin" : ""}`}
            onClick={() => {
              const nextPin = !pinned;
              setPinned(nextPin);
              if (nextPin) {
                clearTimer();
              }
            }}
            title={pinned ? "Открепить авто-сворачивание" : "Закрепить виджет открытым"}
            aria-label="Закрепить виджет"
          >
            <PinIcon size={13} />
          </button>
          <button
            className="icon-button compact ghost"
            onClick={collapse}
            title="Свернуть в кружок"
            aria-label="Свернуть в кружок"
          >
            <MinimizeIcon size={14} />
          </button>
          <button
            className="icon-button compact ghost"
            onClick={() => void toggleOverlay(false)}
            title="Развернуть в полное окно"
            aria-label="Развернуть в полное окно"
          >
            <ExpandIcon size={14} />
          </button>
        </div>
      </div>

      {/* Main Track Info & Visualizer (No box background) */}
      <div className="mini-main" data-tauri-drag-region>
        <div className={`mini-cover-wrap ${isPlaying ? "playing-ring" : ""}`}>
          {current ? (
            <Cover
              trackId={current}
              title={player.album ?? player.title ?? ""}
              size={42}
            />
          ) : (
            <div className="cover cover-empty mini-cover">
              <MusicIcon size={18} />
            </div>
          )}
          {isPlaying && <div className="mini-vinyl-badge" />}
        </div>

        <div className="mini-info" data-tauri-drag-region>
          <div className="mini-track-title" title={player.title ?? undefined}>
            {player.title ?? "Ничего не играет"}
          </div>
          <div className="mini-track-artist" title={player.artist ?? undefined}>
            {player.artist ?? "Выберите трек"}
          </div>
        </div>

        {/* Clean Floating Equalizer (No dark background box) */}
        <div
          className={`vu-meter mini clean ${isPlaying ? "playing" : "paused"}`}
          title="Аудио-визуализатор"
          style={{ "--vol-scale": volumeScale } as CSSProperties}
        >
          <span className="vu-bar bar-1" />
          <span className="vu-bar bar-2" />
          <span className="vu-bar bar-3" />
          <span className="vu-bar bar-4" />
          <span className="vu-bar bar-5" />
          <span className="vu-bar bar-6" />
          <span className="vu-bar bar-7" />
        </div>
      </div>

      {/* Progress Bar with Time */}
      <div className="mini-progress-section">
        <div
          className="mini-progress-bar"
          onClick={handleSeekClick}
          title="Перемотка"
        >
          <div
            className="mini-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mini-time-display">
          <span>{formatTime(player.position)}</span>
          <span>{formatTime(player.duration)}</span>
        </div>
      </div>

      {/* Transport Controls + Volume */}
      <div className="mini-controls" data-tauri-drag-region>
        <div className="mini-transport">
          <button
            className="mini-btn"
            onClick={() => void prev()}
            disabled={!current}
            title="Предыдущий трек"
            aria-label="Предыдущий трек"
          >
            <SkipBackIcon size={14} />
          </button>
          <button
            className="mini-btn play-btn"
            onClick={() => void toggle()}
            disabled={!current}
            title={!current || player.paused ? "Играть" : "Пауза"}
            aria-label={!current || player.paused ? "Играть" : "Пауза"}
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
            disabled={!current}
            title="Следующий трек"
            aria-label="Следующий трек"
          >
            <SkipForwardIcon size={14} />
          </button>
        </div>

        <div className="mini-volume">
          <button
            className="icon-button compact ghost"
            onClick={handleMuteToggle}
            title={isMuted ? "Включить звук" : "Заглушить"}
            aria-label={isMuted ? "Включить звук" : "Заглушить"}
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
            style={
              { "--range-progress": `${player.volume}%` } as CSSProperties
            }
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Громкость"
          />
          <span className="mini-volume-pct">{Math.round(player.volume)}%</span>
        </div>
      </div>
    </div>
  );
}
