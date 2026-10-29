import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

import { mockInvoke, mockListen } from "./mock";

export const isTauri = "__TAURI_INTERNALS__" in window;

// Демо-каталог доступен только при явном запуске UI в браузере с VITE_MOCK=1.
// В обычном браузере и в release-приложении никаких «стандартных» треков нет.
const useMock = !isTauri && import.meta.env.VITE_MOCK === "1";

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, args);
  }
  if (useMock) {
    return mockInvoke<T>(command, args);
  }
  throw new Error(
    "VibeCast запущен вне приложения Tauri. Откройте установленный VibeCast — каталог появится только после подключения телефона.",
  );
}

export function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen<T>(event, (event) => handler(event.payload));
  }
  if (useMock) {
    return Promise.resolve(mockListen(event, handler));
  }
  return Promise.resolve(() => {});
}
