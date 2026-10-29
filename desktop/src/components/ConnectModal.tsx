import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { errorText } from "../lib/format";
import { useStore } from "../store";
import { CheckIcon, LinkIcon, RadioIcon, SmartphoneIcon, SpinnerIcon, XIcon } from "./Icons";

export function ConnectModal() {
  const open = useStore((state) => state.connectOpen);
  const close = useStore((state) => state.closeConnect);
  const connect = useStore((state) => state.connect);
  const connecting = useStore((state) => state.connecting);
  const connectError = useStore((state) => state.connectError);
  const devices = useStore((state) => state.devices);
  const server = useStore((state) => state.server);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(server?.baseUrl ?? "");
    setToken("");
    setReveal(false);
    setLocalError(null);
  }, [open, server?.baseUrl]);

  if (!open) return null;

  const onUrlChange = (value: string) => {
    const marker = value.indexOf("#token=");
    if (marker >= 0) {
      setUrl(value.slice(0, marker));
      try {
        setToken(decodeURIComponent(value.slice(marker + 7)));
      } catch {
        setToken(value.slice(marker + 7));
      }
      return;
    }
    setUrl(value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) {
      setLocalError("Укажите адрес телефона.");
      return;
    }
    if (!token.trim()) {
      setLocalError("Вставьте токен доступа с экрана телефона.");
      tokenRef.current?.focus();
      return;
    }
    setLocalError(null);
    void connect(url, token);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !connecting) close();
      }}
    >
      <div className="modal connect-modal" role="dialog" aria-modal="true" aria-label="Подключение телефона">
        <header className="modal-head">
          <div>
            <span className="eyebrow">Локальная сеть</span>
            <h2>Подключить телефон</h2>
          </div>
          <button className="icon-button ghost" onClick={close} disabled={connecting} title="Закрыть">
            <XIcon size={19} />
          </button>
        </header>

        <div className="modal-body">
          <section className="discovery-section">
            <div className="section-title">
              <span>Найдено в сети</span>
              <span className="live-pill">
                <span className="status-dot live" /> mDNS
              </span>
            </div>

            {devices.length > 0 ? (
              <div className="device-list">
                {devices.map((device) => (
                  <button
                    key={device.id}
                    className={`device-card ${server?.baseUrl === device.baseUrl ? "current" : ""}`}
                    onClick={() => {
                      setUrl(device.baseUrl);
                      setToken("");
                      setLocalError(null);
                      tokenRef.current?.focus();
                    }}
                  >
                    <span className="device-icon">
                      <SmartphoneIcon size={19} />
                    </span>
                    <span className="device-copy">
                      <b>{device.name}</b>
                      <small>
                        {device.host}:{device.port}
                        {device.tokenRequired ? " · нужен токен" : " · без токена"}
                      </small>
                    </span>
                    {server?.baseUrl === device.baseUrl ? (
                      <span className="device-current">
                        <CheckIcon size={14} /> подключён
                      </span>
                    ) : (
                      <span className="device-select">выбрать</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="radar-empty">
                <span className="radar">
                  <RadioIcon size={21} />
                  <i />
                  <i />
                </span>
                <div>
                  <b>Ищем VibeCast рядом</b>
                  <small>Убедитесь, что телефон и компьютер в одной Wi-Fi сети.</small>
                </div>
              </div>
            )}
          </section>

          <div className="divider">
            <span>или вручную</span>
          </div>

          <form onSubmit={submit} className="connect-form">
            <label className="field">
              <span>Адрес телефона</span>
              <div className="input-with-icon">
                <LinkIcon size={16} />
                <input
                  value={url}
                  onChange={(event) => onUrlChange(event.target.value)}
                  placeholder="192.168.1.42:8765"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <small>Можно вставить ссылку из QR-кода целиком — токен подхватится сам.</small>
            </label>

            <label className="field">
              <span>Токен доступа</span>
              <div className="input-with-icon">
                <input
                  ref={tokenRef}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="32-байтный токен"
                  type={reveal ? "text" : "password"}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="field-action"
                  onClick={() => setReveal(!reveal)}
                  title={reveal ? "Скрыть токен" : "Показать токен"}
                >
                  {reveal ? "скрыть" : "показать"}
                </button>
              </div>
              <small>Показан на телефоне под QR-кодом. Никогда не передаётся по сети открыто.</small>
            </label>

            {(localError || connectError) && (
              <div className="form-error">{localError ?? connectError ?? errorText(connectError)}</div>
            )}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={close} disabled={connecting}>
                Отмена
              </button>
              <button type="submit" className="primary-button" disabled={connecting}>
                {connecting ? (
                  <>
                    <SpinnerIcon size={16} /> Проверяем…
                  </>
                ) : (
                  "Подключиться"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
