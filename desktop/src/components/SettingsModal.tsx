import { useEffect, useRef, useState } from "react";

import { call } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";
import { THEMES } from "../themes";
import type { CacheStats, HotkeyConfig, UpdateInfo } from "../lib/types";
import { DownloadIcon, FolderIcon, PaletteIcon, ServerIcon, SpinnerIcon, TrashIcon, XIcon, CheckIcon, RefreshIcon } from "./Icons";

const DEFAULT_HOTKEYS: HotkeyConfig = {
  enabled: true,
  toggle: "Ctrl+Alt+Space",
  next: "Ctrl+Alt+Right",
  prev: "Ctrl+Alt+Left",
  volumeUp: "Ctrl+Alt+Up",
  volumeDown: "Ctrl+Alt+Down",
  toggleOverlay: "Ctrl+Alt+W",
};

type HotkeyActionKey = Exclude<keyof HotkeyConfig, "enabled">;

type SettingsTab = "all" | "general" | "equalizer" | "theme" | "cache" | "hotkeys" | "connection" | "updates";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "all", label: "Все" },
  { id: "general", label: "Основные" },
  { id: "equalizer", label: "Эквалайзер" },
  { id: "theme", label: "Темы" },
  { id: "cache", label: "Кэш" },
  { id: "hotkeys", label: "Клавиши" },
  { id: "connection", label: "Телефон" },
  { id: "updates", label: "Обновления" },
];

const EQUALIZER_FREQS = [
  "31 Гц",
  "63 Гц",
  "125 Гц",
  "250 Гц",
  "500 Гц",
  "1 кГц",
  "2 кГц",
  "4 кГц",
  "8 кГц",
  "16 кГц",
];

const EQUALIZER_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: "Flat (Сброс)", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass_boost: { label: "Bass Boost", gains: [8, 9, 7, 4, 1, 0, 0, 0, 1, 1.5] },
  rock: { label: "Рок", gains: [6, 5, 3.5, 0, -1.5, 1, 3.5, 6, 7, 6.5] },
  electronic: { label: "Electronic", gains: [7, 8, 5.5, 1, -1, 2, 2.5, 5, 7, 7] },
  vocal: { label: "Вокал", gains: [-2.5, -1.5, 0, 2.5, 5, 6, 4.5, 2.5, 1, -1] },
  classical: { label: "Классика", gains: [5, 4, 3, 1.5, 0, 0, 2, 4, 4.5, 5] },
};

function EqBandSlider({
  freq,
  gain,
  onChange,
  disabled,
}: {
  freq: string;
  gain: number;
  onChange: (gain: number) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const calcGainFromPointer = (clientY: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const clampedY = Math.max(rect.top, Math.min(rect.bottom, clientY));
    const fraction = (rect.bottom - clampedY) / rect.height;
    const rawGain = -12 + fraction * 24;
    return Math.round(rawGain * 2) / 2;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const newGain = calcGainFromPointer(e.clientY);
    onChange(newGain);

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const g = calcGainFromPointer(ev.clientY);
      onChange(g);
    };

    const onPointerUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.5 : -0.5;
    const newGain = Math.max(-12, Math.min(12, Math.round((gain + delta) * 2) / 2));
    onChange(newGain);
  };

  const handleDoubleClick = () => {
    if (disabled) return;
    onChange(0);
  };

  const percent = ((gain + 12) / 24) * 100;
  const isPositive = gain > 0;
  const isNegative = gain < 0;

  return (
    <div
      className={`eq-band-col ${disabled ? "is-disabled" : ""}`}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      title={`${freq}: ${gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)} dB (Двойной клик — в 0 dB, колёсико — шаг 0.5 dB)`}
    >
      <span className={`eq-gain-val ${isPositive ? "positive" : isNegative ? "negative" : ""}`}>
        {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
      </span>

      <div
        ref={trackRef}
        className={`eq-track-container ${dragging ? "is-dragging" : ""}`}
        onPointerDown={handlePointerDown}
      >
        <div className="eq-track-groove" />
        <div className="eq-track-zero-line" />
        <div
          className={`eq-track-fill ${isPositive ? "fill-pos" : isNegative ? "fill-neg" : ""}`}
          style={
            isPositive
              ? { bottom: "50%", height: `${(gain / 12) * 50}%` }
              : isNegative
              ? { top: "50%", height: `${(Math.abs(gain) / 12) * 50}%` }
              : { height: 0 }
          }
        />
        <div
          className="eq-thumb"
          style={{ bottom: `calc(${percent}% - 8px)` }}
        />
      </div>

      <span className="eq-freq-label">{freq}</span>
    </div>
  );
}

const HOTKEY_ITEMS: { key: HotkeyActionKey; label: string; extraHint?: string }[] = [
  { key: "toggle", label: "Воспроизведение / Пауза", extraHint: "Media Play" },
  { key: "next", label: "Следующий трек", extraHint: "Media Next" },
  { key: "prev", label: "Предыдущий трек", extraHint: "Media Prev" },
  { key: "volumeUp", label: "Прибавить громкость" },
  { key: "volumeDown", label: "Убавить громкость" },
  { key: "toggleOverlay", label: "Виджет / Оверлей" },
];

function formatKeyPart(part: string): string {
  switch (part.toLowerCase()) {
    case "up":
    case "arrowup":
      return "↑";
    case "down":
    case "arrowdown":
      return "↓";
    case "left":
    case "arrowleft":
      return "←";
    case "right":
    case "arrowright":
      return "→";
    default:
      return part;
  }
}

function renderKbdCombo(combo: string) {
  const parts = combo.split("+").map((p) => p.trim());
  return (
    <>
      {parts.map((part, idx) => (
        <span key={idx}>
          <kbd>{formatKeyPart(part)}</kbd>
          {idx < parts.length - 1 && " + "}
        </span>
      ))}
    </>
  );
}

export function SettingsModal() {
  const open = useStore((state) => state.settingsOpen);
  const close = useStore((state) => state.closeSettings);
  const server = useStore((state) => state.server);
  const settings = useStore((state) => state.settings);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const cachedCount = useStore((state) => state.cachedCount);
  const clearCache = useStore((state) => state.clearCache);
  const setCacheMode = useStore((state) => state.setCacheMode);
  const disconnect = useStore((state) => state.disconnect);
  const addToast = useStore((state) => state.addToast);
  const equalizer = useStore((state) => state.equalizer);
  const setEqualizer = useStore((state) => state.setEqualizer);
  const setMinimizeToTray = useStore((state) => state.setMinimizeToTray);
  const setExpandOnHotkey = useStore((state) => state.setExpandOnHotkey);
  const setCrossfadeDuration = useStore((state) => state.setCrossfadeDuration);
  const saveHotkeys = useStore((state) => state.saveHotkeys);
  const setRecordingHotkey = useStore((state) => state.setRecordingHotkey);

  const crossfadeDuration = settings.crossfadeDuration ?? 1.5;

  const [cache, setCache] = useState<CacheStats>({ count: cachedCount, bytes: 0 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordingAction, setRecordingAction] = useState<HotkeyActionKey | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("all");

  const hotkeysEnabled = settings.hotkeys?.enabled ?? true;

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    void call<CacheStats>("cache_stats")
      .then(setCache)
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingAction(null);
        return;
      }

      // If user just pressed a modifier alone, wait for the actual key
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Win");

      if (parts.length === 0) {
        addToast("Горячая клавиша должна содержать Ctrl, Alt или Shift", "info");
        return;
      }

      let keyName = e.code;
      if (keyName.startsWith("Key")) {
        keyName = keyName.slice(3);
      } else if (keyName.startsWith("Digit")) {
        keyName = keyName.slice(5);
      } else if (keyName.startsWith("Arrow")) {
        keyName = keyName.slice(5);
      } else if (keyName === "Space") {
        keyName = "Space";
      }

      parts.push(keyName);
      const combo = parts.join("+");

      const currentHotkeys = settings.hotkeys || DEFAULT_HOTKEYS;
      const updated: HotkeyConfig = { ...currentHotkeys, [recordingAction]: combo };
      void saveHotkeys(updated);
      setRecordingAction(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [recordingAction, settings.hotkeys, saveHotkeys, addToast]);

  useEffect(() => {
    setRecordingHotkey(recordingAction !== null);
    return () => {
      setRecordingHotkey(false);
    };
  }, [recordingAction, setRecordingHotkey]);

  if (!open) return null;

  const clear = async () => {
    setBusy(true);
    await clearCache();
    try {
      setCache(await call<CacheStats>("cache_stats"));
    } catch {
      setCache({ count: 0, bytes: 0 });
    }
    setBusy(false);
  };

  const openCache = () => {
    void call("open_cache_dir").catch(() => addToast("Не удалось открыть папку кэша", "error"));
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Настройки">
        <header className="modal-head">
          <div>
            <span className="eyebrow">VibeCast</span>
            <h2>Настройки</h2>
          </div>
          <button className="icon-button ghost modal-close-btn" onClick={close} title="Закрыть">
            <XIcon size={19} />
          </button>
        </header>

        <div className="modal-tabs-bar" role="tablist" aria-label="Разделы настроек">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`modal-tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div key={activeTab} className="modal-body settings-body settings-tab-enter">
          {(activeTab === "all" || activeTab === "general") && (
            <>
              <section className="settings-section">
                <div className="section-title">
                  <span>Воспроизведение и звук</span>
                  <span className="muted">Переходы треков</span>
                </div>
                <div className="setting-slider-item">
                  <div className="setting-toggle-info">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b>Плавный переход между треками (Crossfade)</b>
                      <span className="setting-badge">
                        {crossfadeDuration > 0 ? `${crossfadeDuration.toFixed(1)} сек` : "Выключен"}
                      </span>
                    </div>
                    <small>
                      Плавное нарастание громкости при переходе к следующей композиции для мягкого перехода без резких щелчков
                    </small>
                  </div>
                  <div className="crossfade-slider-wrap">
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={0.5}
                      value={crossfadeDuration}
                      onChange={(e) => void setCrossfadeDuration(Number(e.target.value))}
                      className="volume-range"
                      style={{ width: "100%", marginTop: 8 }}
                      aria-label="Длительность плавного перехода"
                    />
                    <div
                      className="slider-ticks"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        color: "var(--muted-2)",
                        marginTop: 4,
                      }}
                    >
                      <span>Выкл (0с)</span>
                      <span>1 сек</span>
                      <span>2 сек</span>
                      <span>3 сек</span>
                      <span>4 сек</span>
                      <span>5 сек</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="section-title">
                  <span>Окно и панель задач</span>
                  <span className="muted">Система</span>
                </div>
                <label className="toggle-switch-container">
                  <div className="setting-toggle-info">
                    <b>Сворачивать в трей около часов при закрытии</b>
                    <small>Окно прячется в область уведомлений Windows, плеер продолжает играть в фоне</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.minimizeToTray ?? true}
                    onChange={(e) => {
                      void setMinimizeToTray(e.target.checked);
                    }}
                  />
                </label>
              </section>

              <section className="settings-section">
                <div className="section-title">
                  <span>Плавающий виджет</span>
                  <span className="muted">HUD / Оверлей</span>
                </div>
                <label className="toggle-switch-container">
                  <div className="setting-toggle-info">
                    <b>Раскрывать виджет при нажатии горячих клавиш</b>
                    <small>Разворачивать компактный кружок в расширенную карточку плеера при управлении треками с клавиатуры</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.expandOnHotkey ?? true}
                    onChange={(e) => void setExpandOnHotkey(e.target.checked)}
                  />
                </label>
              </section>
            </>
          )}

          {(activeTab === "all" || activeTab === "equalizer") && (
            <section className="settings-section">
              <div className="section-title">
                <span>10-полосный эквалайзер</span>
                <span className="muted">аудиофильтр mpv</span>
              </div>

              <label className="toggle-switch-container" style={{ marginBottom: 14 }}>
                <div className="setting-toggle-info">
                  <b>Включить эквалайзер</b>
                  <small>Обработка звука в реальном времени с нулевой задержкой</small>
                </div>
                <input
                  type="checkbox"
                  checked={equalizer.enabled}
                  onChange={(e) => {
                    void setEqualizer({ ...equalizer, enabled: e.target.checked });
                  }}
                />
              </label>

              <div className={`equalizer-wrap ${!equalizer.enabled ? "disabled" : ""}`}>
                <div className="equalizer-presets-bar">
                  <span className="preset-label">Пресеты:</span>
                  <div className="preset-pills">
                    {Object.entries(EQUALIZER_PRESETS).map(([key, p]) => {
                      const isActive = equalizer.preset === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`preset-pill ${isActive ? "active" : ""}`}
                          onClick={() => {
                            void setEqualizer({
                              enabled: true,
                              preset: key,
                              gains: [...p.gains],
                            });
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact eq-reset-btn"
                    onClick={() => {
                      void setEqualizer({
                        enabled: equalizer.enabled,
                        preset: "flat",
                        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                      });
                    }}
                    title="Сбросить все полосы в 0 dB"
                  >
                    <RefreshIcon size={13} /> В ноль
                  </button>
                </div>

                <div className="equalizer-sliders-grid">
                  {EQUALIZER_FREQS.map((freq, idx) => {
                    const gain = equalizer.gains[idx] ?? 0;
                    return (
                      <EqBandSlider
                        key={freq}
                        freq={freq}
                        gain={gain}
                        disabled={!equalizer.enabled}
                        onChange={(val) => {
                          const nextGains = [...equalizer.gains];
                          nextGains[idx] = val;
                          setEqualizer({
                            enabled: true,
                            preset: "custom",
                            gains: nextGains,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {(activeTab === "all" || activeTab === "theme") && (
            <section className="settings-section">
              <div className="section-title">
                <span>Тема оформления</span>
                <span className="muted">без перезапуска</span>
              </div>
              <div className="theme-grid">
                {Object.entries(THEMES).map(([id, t]) => {
                  const isSelected = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`theme-card ${isSelected ? "selected" : ""}`}
                      onClick={() => void setTheme(id)}
                    >
                      <div className="theme-preview" style={{ background: t.tokens.bg_primary }}>
                        <div className="preview-card" style={{ background: t.tokens.bg_card, borderColor: t.tokens.border }}>
                          <span className="preview-accent" style={{ background: t.tokens.accent }} />
                          <span className="preview-line" style={{ background: t.tokens.text_muted }} />
                        </div>
                      </div>
                      <div className="theme-info">
                        <span className="theme-name">{t.name}</span>
                        {isSelected && <span className="theme-active-tag"><CheckIcon size={12} /> Активна</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {(activeTab === "all" || activeTab === "cache") && (
            <>
              <section className="settings-section">
                <div className="section-title">
                  <span>Локальный кэш</span>
                  <span className="muted">{formatBytes(cache.bytes)}</span>
                </div>

                <div className="cache-mode-box">
                  <span className="cache-mode-label">Режим сохранения в кэш:</span>
                  <div className="cache-mode-options">
                    <label className={`cache-option ${(settings.cacheMode ?? "auto") === "auto" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="cacheMode"
                        value="auto"
                        checked={(settings.cacheMode ?? "auto") === "auto"}
                        onChange={() => void setCacheMode("auto")}
                      />
                      <div>
                        <b>Всегда при воспроизведении</b>
                        <small>Автоматически кэшировать треки на диск при прослушивании</small>
                      </div>
                    </label>
                    <label className={`cache-option ${(settings.cacheMode ?? "auto") === "manual" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="cacheMode"
                        value="manual"
                        checked={(settings.cacheMode ?? "auto") === "manual"}
                        onChange={() => void setCacheMode("manual")}
                      />
                      <div>
                        <b>Только вручную</b>
                        <small>Сохранять в кэш только по клику на кнопку скачивания</small>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="cache-summary">
                  <span className="cache-big-icon">
                    <DownloadIcon size={21} />
                  </span>
                  <div>
                    <b>{formatCount(cache.count, "трек", "трека", "треков")}</b>
                    <small>Скачанные треки играют без участия телефона и переживают перезапуск.</small>
                  </div>
                </div>
                <div className="inline-actions">
                  <button className="secondary-button compact" onClick={openCache}>
                    <FolderIcon size={15} /> Открыть папку
                  </button>
                  <button className="danger-button compact" onClick={() => void clear()} disabled={busy || cache.count === 0}>
                    <TrashIcon size={15} /> Очистить весь кэш
                  </button>
                </div>
              </section>
            </>
          )}

          {(activeTab === "all" || activeTab === "hotkeys") && (
            <section className="settings-section">
              <div className="section-title">
                <span>Горячие клавиши (в игре и в фоне)</span>
                <span className="muted">{hotkeysEnabled ? "активны" : "отключены"}</span>
              </div>

              <label className="toggle-switch-container" style={{ marginBottom: 12 }}>
                <div className="setting-toggle-info">
                  <b>Глобальные горячие клавиши для управления</b>
                  <small>Перехватывать клавиши для управления воспроизведением и громкостью в других окнах и играх</small>
                </div>
                <input
                  type="checkbox"
                  checked={hotkeysEnabled}
                  onChange={(e) => {
                    const currentConfig = settings.hotkeys || DEFAULT_HOTKEYS;
                    void saveHotkeys({ ...currentConfig, enabled: e.target.checked });
                  }}
                />
              </label>

              <div className={`hotkeys-list ${!hotkeysEnabled ? "disabled-hotkeys" : ""}`}>
                {HOTKEY_ITEMS.map((item) => {
                  const currentConfig = settings.hotkeys || DEFAULT_HOTKEYS;
                  const combo = String(currentConfig[item.key] || DEFAULT_HOTKEYS[item.key]);
                  const isRecording = recordingAction === item.key;

                  return (
                    <div key={item.key} className="hotkey-item">
                      <span>{item.label}</span>
                      <button
                        type="button"
                        className={`hotkey-button ${isRecording ? "recording" : ""}`}
                        onClick={() => setRecordingAction(isRecording ? null : item.key)}
                        title={isRecording ? "Нажмите Esc для отмены" : "Нажмите, чтобы назначить свои клавиши"}
                      >
                        {isRecording ? (
                          <span>Нажмите сочетание... (Esc)</span>
                        ) : (
                          <>
                            {renderKbdCombo(combo)}
                            {item.extraHint && <span className="hotkey-extra-hint"> / {item.extraHint}</span>}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="inline-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => void saveHotkeys(DEFAULT_HOTKEYS)}
                  title="Сбросить все сочетания клавиш к стандартным"
                >
                  <RefreshIcon size={14} /> Сбросить по умолчанию
                </button>
              </div>
            </section>
          )}

          {(activeTab === "all" || activeTab === "connection") && (
            <section className="settings-section">
              <div className="section-title">
                <span>Телефон</span>
                <span className="muted">протокол {server?.protocol ?? "—"}</span>
              </div>
              {server ? (
                <>
                  <div className="server-detail">
                    <span className="device-icon">
                      <ServerIcon size={19} />
                    </span>
                    <div>
                      <b>{server.deviceName}</b>
                      <small>{server.baseUrl}</small>
                    </div>
                    <span className={`status-dot ${server.online ? "live" : "idle"}`} />
                  </div>
                  <div className="server-facts">
                    <span>
                      <small>Каталог</small>
                      <b>{formatCount(server.trackCount, "трек", "трека", "треков")}</b>
                    </span>
                    <span>
                      <small>Версия</small>
                      <b>v{server.version}</b>
                    </span>
                    <span>
                      <small>Статус</small>
                      <b className={server.online ? "ok" : "bad"}>{server.online ? "на связи" : "недоступен"}</b>
                    </span>
                  </div>
                  {confirming ? (
                    <div className="confirm-row">
                      <span>Отключить телефон и очистить каталог?</span>
                      <button className="danger-button compact" onClick={() => void disconnect()}>
                        Да, отключить
                      </button>
                      <button className="secondary-button compact" onClick={() => setConfirming(false)}>
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button className="danger-text" onClick={() => setConfirming(true)}>
                      Отключить телефон
                    </button>
                  )}
                </>
              ) : (
                <p className="muted">Телефон не подключён. Нажмите «Подключить» на верхней панели.</p>
              )}
            </section>
          )}

          {(activeTab === "all" || activeTab === "updates") && (
            <>
              <section className="settings-section">
                <div className="section-title">
                  <span>Обновления</span>
                  <span className="muted">v0.2.9</span>
                </div>
                <div className="update-box">
                  <div className="update-status-row">
                    <div>
                      <b>Версия приложения: v0.2.9</b>
                      <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 13 }}>
                        Автоматическая проверка свежих релизов с GitHub
                      </p>
                    </div>
                    <button
                      className="primary-button compact"
                      disabled={checkingUpdate}
                      onClick={async () => {
                        setCheckingUpdate(true);
                        setUpdateError(null);
                        try {
                          const res = await call<UpdateInfo>("check_for_updates");
                          setUpdateResult(res);
                        } catch (err: any) {
                          setUpdateError(String(err));
                        } finally {
                          setCheckingUpdate(false);
                        }
                      }}
                    >
                      {checkingUpdate ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
                      <span>{checkingUpdate ? "Проверка…" : "Проверить"}</span>
                    </button>
                  </div>

                  {updateError && (
                    <div className="settings-alert error" style={{ marginTop: 10 }}>
                      {updateError}
                    </div>
                  )}

                  {updateResult && (
                    <div style={{ marginTop: 12 }}>
                      {updateResult.hasUpdate ? (
                        <div className="update-card-new" style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(74, 222, 128, 0.12)", border: "1px solid rgba(74, 222, 128, 0.3)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <b style={{ color: "var(--accent, #4ade80)" }}>
                              Доступна новая версия: v{updateResult.latestVersion}!
                            </b>
                            <a
                              className="primary-button compact"
                              href={updateResult.downloadUrl || updateResult.releaseUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: "none" }}
                            >
                              Скачать обновление
                            </a>
                          </div>
                          {updateResult.releaseNotes && (
                            <p className="muted" style={{ margin: "8px 0 0 0", fontSize: 12, whiteSpace: "pre-line" }}>
                              {updateResult.releaseNotes}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255, 255, 255, 0.05)", color: "var(--text-muted, #8b98a5)", fontSize: 13 }}>
                          ✓ У вас установлена актуальная версия VibeCast.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="settings-section about-section">
                <div>
                  <b>VibeCast 0.2.9</b>
                  <small>Android → Windows / Linux / macOS · HTTP в локальной сети</small>
                </div>
                <span className="about-badge">MVP</span>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


