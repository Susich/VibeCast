import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

import { mockInvoke, mockListen } from "./mock";

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, args);
  }
  return mockInvoke<T>(command, args);
}

export function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen<T>(event, (event) => handler(event.payload));
  }
  return Promise.resolve(mockListen(event, handler));
}
