import { useEffect, useState } from "react";

import { call } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { useStore } from "../store";
import type { CacheStats } from "../lib/types";
import { DownloadIcon, FolderIcon, ServerIcon, SpinnerIcon, TrashIcon, XIcon, CheckIcon } from "./Icons";

export function SettingsModal() {
  const open = useStore((state) => state.settingsOpen);
  const close = useStore((state) => state.closeSettings);
  const server = useStore((state) => state.server);
  const settings = useStore((state) => state.settings);
  const cachedCount = useStore((state) => state.cachedCount);
  const updateMpvPath = useStore((state) => state.updateMpvPath);
  const clearCache = useStore((state) => state.clearCache);
  const disconnect = useStore((state) => state.disconnect);
  const addToast = useStore((state) => state.addToast);

  const [mpvPath, setMpvPath] = useState("");
  const [cache, setCache] = useState<CacheStats>({ count: cachedCount, bytes: 0 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

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
                <TrashIcon size={15} /> Очистить
              </button>
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

          <section className="settings-section about-section">
            <div>
              <b>VibeCast 0.1.0</b>
              <small>Android → Windows / Linux / macOS · HTTP в локальной сети</small>
            </div>
            <span className="about-badge">MVP</span>
          </section>
        </div>
      </div>
    </div>
  );
}
