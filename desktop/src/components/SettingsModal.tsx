import { useEffect, useState } from "react";

import { call } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";
import { THEMES } from "../themes";
import type { CacheStats, UpdateInfo } from "../lib/types";
import { DownloadIcon, FolderIcon, PaletteIcon, ServerIcon, SpinnerIcon, TrashIcon, XIcon, CheckIcon, RefreshIcon } from "./Icons";

export function SettingsModal() {
  const open = useStore((state) => state.settingsOpen);
  const close = useStore((state) => state.closeSettings);
  const server = useStore((state) => state.server);
  const settings = useStore((state) => state.settings);
  const theme = useStore((state) => state.theme);
  const setTheme = useStore((state) => state.setTheme);
  const cachedCount = useStore((state) => state.cachedCount);
  const updateMpvPath = useStore((state) => state.updateMpvPath);
  const clearCache = useStore((state) => state.clearCache);
  const setCacheMode = useStore((state) => state.setCacheMode);
  const disconnect = useStore((state) => state.disconnect);
  const addToast = useStore((state) => state.addToast);

  const [mpvPath, setMpvPath] = useState("");
  const [cache, setCache] = useState<CacheStats>({ count: cachedCount, bytes: 0 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMpvPath(settings.mpvPath ?? "");
    setConfirming(false);
    setSaved(false);
    void call<CacheStats>("cache_stats")
      .then(setCache)
      .catch(() => undefined);
  }, [open, settings.mpvPath]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    await updateMpvPath(mpvPath);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

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
          <button className="icon-button ghost" onClick={close} title="Закрыть">
            <XIcon size={19} />
          </button>
        </header>

        <div className="modal-body settings-body">
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

          <section className="settings-section">
            <div className="section-title">
              <span>Воспроизведение</span>
            </div>
            <label className="field">
              <span>Путь к mpv</span>
              <input
                value={mpvPath}
                onChange={(event) => setMpvPath(event.target.value)}
                placeholder="C:\tools\mpv\mpv.exe"
                spellCheck={false}
                autoComplete="off"
              />
              <small>
                Оставьте пустым, если mpv установлен в PATH. VibeCast также ищет mpv рядом с приложением.
                Изменение перезапустит плеер.
              </small>
            </label>
            <div className="inline-actions">
              <button className="secondary-button compact" onClick={() => void save()} disabled={busy}>
                {busy ? <SpinnerIcon size={15} /> : saved ? <CheckIcon size={15} /> : null}
                {saved ? "Сохранено" : "Сохранить путь"}
              </button>
            </div>
          </section>

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

          <section className="settings-section">
            <div className="section-title">
              <span>Горячие клавиши (в игре и в фоне)</span>
              <span className="muted">глобальные</span>
            </div>
            <div className="hotkeys-list">
              <div className="hotkey-item">
                <span>Воспроизведение / Пауза</span>
                <div className="hotkey-keys"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Space</kbd> / <kbd>Media Play</kbd></div>
              </div>
              <div className="hotkey-item">
                <span>Следующий трек</span>
                <div className="hotkey-keys"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>→</kbd> / <kbd>Media Next</kbd></div>
              </div>
              <div className="hotkey-item">
                <span>Предыдущий трек</span>
                <div className="hotkey-keys"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>Media Prev</kbd></div>
              </div>
              <div className="hotkey-item">
                <span>Громкость</span>
                <div className="hotkey-keys"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd></div>
              </div>
              <div className="hotkey-item">
                <span>Оверлей / Виджет HUD</span>
                <div className="hotkey-keys"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>W</kbd></div>
              </div>
            </div>
          </section>

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

          <section className="settings-section">
            <div className="section-title">
              <span>Обновления</span>
              <span className="muted">v0.2.5</span>
            </div>
            <div className="update-box">
              <div className="update-status-row">
                <div>
                  <b>Версия приложения: v0.2.5</b>
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
              <b>VibeCast 0.2.5</b>
              <small>Android → Windows / Linux / macOS · HTTP в локальной сети</small>
            </div>
            <span className="about-badge">MVP</span>
          </section>
        </div>
      </div>
    </div>
  );
}


