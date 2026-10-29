import { listen } from "./api";
import type { CacheProgress, CacheStats, Device, LibraryStats, PlayerState, ServerView, ToastMessage } from "./types";
import { useStore } from "../store";

let bound = false;

export function bindEvents(): void {
  if (bound) return;
  bound = true;

  void listen<PlayerState>("player://state", (player) => {
    useStore.getState().onPlayerState(player);
  });

  void listen<{ trackId?: string }>("player://eof", (payload) => {
    useStore.getState().onEof(payload ?? {});
  });

  void listen<LibraryStats>("library://updated", (stats) => {
    useStore.getState().onLibraryUpdated(stats);
  });

  void listen<ServerView | null>("server://changed", (server) => {
    useStore.getState().onServerChanged(server);
  });

  void listen<Device[]>("discovery://devices", (devices) => {
    useStore.getState().onDevices(devices ?? []);
  });

  void listen<CacheProgress>("cache://progress", (progress) => {
    useStore.getState().onCacheProgress(progress);
  });

  void listen<CacheStats>("cache://cleared", (stats) => {
    useStore.getState().onCacheCleared(stats);
  });

  void listen<ToastMessage>("app://toast", (toast) => {
    if (toast?.message) useStore.getState().addToast(toast.message, toast.level ?? "info");
  });
}
