import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";

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
  const toggleMute = useStore((state) => state.toggleMute);
  const toggleOverlay = useStore((state) => state.toggleOverlay);
  const overlayTransition = useStore((state) => state.overlayTransition);
  const expandOnHotkey = useStore((state) => state.settings.expandOnHotkey ?? true);

  // Expanded = full player controls (390x185); Collapsed = compact circular bubble (120x120)
  const [expanded, setExpanded] = useState(true);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const [pinned, setPinned] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const pinnedRef = useRef(pinned);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  const isMuted = player.volume === 0;
  const current = player.currentTrackId;
  const isPlaying = !player.paused && !!current;

  const clearTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const collapse = useCallback(() => {
    if (pinnedRef.current) return;
    clearTimer();
    setIsCollapsing(true);
    setTimeout(async () => {
      if (pinnedRef.current) {
        setIsCollapsing(false);
        return;
      }
      setExpanded(false);
      setIsCollapsing(false);
      await call("set_overlay_compact", { compact: true }).catch(() => undefined);
    }, 160);
  }, [clearTimer]);

  const expandWithTimer = useCallback(
    async (durationMs = 5000) => {
      clearTimer();
      // Ensure the Tauri window is resized and positioned FIRST before rendering expanded card
      await call("set_overlay_compact", { compact: false }).catch(() => undefined);
      setExpanded(true);
      setIsCollapsing(false);

      if (!pinnedRef.current && !isHoveredRef.current) {
        collapseTimerRef.current = setTimeout(() => {
          if (!isHoveredRef.current && !pinnedRef.current) {
            collapse();
          }
        }, durationMs);
      }
    },
    [clearTimer, collapse],
  );

  // Listen to global hotkey triggers to reveal full player (if enabled in settings)
  useEffect(() => {
    const onHotkey = (e: Event) => {
      const customEvent = e as CustomEvent<{ action: string }>;
      if (customEvent.detail?.action && customEvent.detail.action !== "toggle_overlay") {
        if (expandOnHotkey) {
          void expandWithTimer(5000);
        }
      }
    };

    window.addEventListener("vibecast-hotkey", onHotkey);
    return () => {
      window.removeEventListener("vibecast-hotkey", onHotkey);
    };
  }, [expandOnHotkey, expandWithTimer]);

  // Clean up any pending collapse timer on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  // Initial mount: show big player first, then auto-collapse to circle after 5s
  useEffect(() => {
    collapseTimerRef.current = setTimeout(() => {
      if (!isHoveredRef.current && !pinnedRef.current) {
        collapse();
      }
    }, 5000);
    return () => {
      clearTimer();
    };
  }, [clearTimer, collapse]);

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
    void call("start_clamped_drag").catch(() => undefined);
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const step = 3;
    const delta = e.deltaY < 0 ? step : -step;
    setVolume(Math.max(0, Math.min(100, Math.round(player.volume + delta))));
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
    if (expanded && !pinnedRef.current) {
      void expandWithTimer(5000);
    }
  };

  const progressPercent =
    player.duration > 0
      ? Math.min(100, Math.max(0, (player.position / player.duration) * 100))
      : 0;

  const volumeScale = isPlaying ? Math.max(0.3, player.volume / 100) : 0;

  // Track pointer interactions on circle: separate dragging from clicking
  const pointerStartRef = useRef<{
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);

  const handleCirclePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pointerStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleCirclePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.moved) return;

    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    // If pointer moves at least 4 pixels, user is dragging the widget
    if (Math.hypot(dx, dy) >= 4) {
      start.moved = true;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      void call("start_clamped_drag").catch(() => undefined);
    }
  };

  const handleCirclePointerUp = async (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    // Genuine click: pointer moved less than 6px
    if (start && !start.moved) {
      await expandWithTimer(5000);
    }
  };

  const handleCirclePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    pointerStartRef.current = null;
  };

  const isExpandingToFull = overlayTransition === "expanding_to_full";

  // VIEW 1: Compact Floating Circle with Music Wave Aura (When Collapsed)
  if (!expanded) {
    return (
      <div
        className={`mini-circle-root ${isExpandingToFull ? "expanding-to-full" : ""}`}
        onPointerDown={handleCirclePointerDown}
        onPointerMove={handleCirclePointerMove}
        onPointerUp={handleCirclePointerUp}
        onPointerCancel={handleCirclePointerCancel}
        title={
          isPlaying
            ? `${player.title ?? "VibeCast"} · Нажмите для управления`
            : "VibeCast · Нажмите для управления"
        }
      >
        {/* Radial Circular Equalizer Spectrum Visualizer */}
        <CircularVisualizer
          isPlaying={isPlaying}
          volume={player.volume}
          trackId={current}
          position={player.position}
        />

        {/* Circular Floating Bubble */}
        <div className={`mini-circle-bubble ${isPlaying ? "is-playing" : ""}`}>
          <div className="mini-circle-logo-wrap">
            <img
              src="/logo.png"
              alt="VibeCast"
              className="mini-circle-logo"
              draggable={false}
            />
            <div className="mini-circle-logo-tint" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: Full Player Card (When Expanded via hotkey, click, or pin)
  return (
    <div
      className={`mini-overlay ${isCollapsing ? "collapsing" : ""} ${isExpandingToFull ? "expanding-to-full" : ""}`}
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
              pinnedRef.current = nextPin;
              if (nextPin) {
                clearTimer();
              } else if (!isHoveredRef.current) {
                void expandWithTimer(5000);
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

        <div className="mini-volume" onWheel={handleVolumeWheel}>
          <button
            className="icon-button compact ghost"
            onClick={toggleMute}
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
            onWheel={handleVolumeWheel}
            aria-label="Громкость"
          />
          <span className="mini-volume-pct">{Math.round(player.volume)}%</span>
        </div>
      </div>
    </div>
  );
}
