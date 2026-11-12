import { call, listen } from "./api";
import type {
  CacheProgress,
  CacheStats,
  Device,
  LibraryStats,
  PlayerState,
  RemoteCommand,
  ServerView,
  ToastMessage,
  TrackRow,
} from "./types";
import { useStore } from "../store";

let bound = false;

export function bindEvents(): void {
  if (bound) return;
  bound = true;

  void listen<PlayerState>("player://state", (player) => {
    useStore.getState().onPlayerState(player);
  });

  void listen<void>("window://restored", () => {
    window.dispatchEvent(new CustomEvent("vibecast-window-restored"));
  });

  void listen<void>("player://tray-next", () => {
    void useStore.getState().next();
  });

  void listen<RemoteCommand>("remote-control", async (cmd) => {
    if (!cmd?.action) return;
    const store = useStore.getState();
    window.dispatchEvent(new CustomEvent("vibecast-hotkey", { detail: { action: cmd.action } }));
    switch (cmd.action) {
      case "toggle":
        await store.toggle();
        break;
      case "play":
        if (store.player.paused) await store.toggle();
        break;
      case "pause":
        if (!store.player.paused) await store.toggle();
        break;
      case "next":
        await store.next();
        break;
      case "prev":
        await store.prev();
        break;
      case "seek":
        if (typeof cmd.position === "number") {
          await store.seek(cmd.position);
        }
        break;
      case "volume":
        if (typeof cmd.volume === "number") {
          store.setVolume(cmd.volume);
        }
        break;
      case "shuffle":
        store.toggleShuffle();
        break;
      case "play_track":
        if (cmd.trackId) {
          let customQueue: TrackRow[] | undefined;
          if (cmd.queueIds && cmd.queueIds.length > 0) {
            const trackMap = new Map(store.tracks.map((t) => [t.id, t]));
            const resolved = cmd.queueIds
              .map((id) => trackMap.get(id))
              .filter((t): t is TrackRow => Boolean(t));
            if (resolved.length > 0) {
              customQueue = resolved;
            }
          }
          const found =
            customQueue?.find((t) => t.id === cmd.trackId) ||
            store.tracks.find((t) => t.id === cmd.trackId) ||
            store.queue.find((t) => t.id === cmd.trackId);
          if (found) {
            store.playTrack(found, customQueue);
          } else {
            void call<PlayerState>("play_track", { trackId: cmd.trackId })
              .then((player) => store.onPlayerState(player))
              .catch(() => undefined);
          }
        }
        break;
    }
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

  void listen<{ trackId: string; stats: CacheStats }>("cache://track_deleted", (payload) => {
    useStore.getState().onTrackDeleted(payload.trackId, payload.stats);
  });

  void listen<{ action: string }>("global-hotkey", async (data) => {
    if (!data?.action) return;
    const store = useStore.getState();

    // If global hotkeys are disabled or user is currently recording a key combination, ignore
    if (store.settings.hotkeys?.enabled === false || store.isRecordingHotkey) {
      return;
    }

    // Signal UI to open/reveal HUD and refresh inactivity timer (for media actions only)
    if (data.action !== "toggle_overlay") {
      window.dispatchEvent(new CustomEvent("vibecast-hotkey", { detail: { action: data.action } }));
    }

    switch (data.action) {
      case "toggle":
        await store.toggle();
        break;
      case "next":
        await store.next();
        break;
      case "prev":
        await store.prev();
        break;
      case "volume_up": {
        const cur = store.player.volume;
        store.setVolume(Math.min(100, Math.round(cur + 3)));
        break;
      }
      case "volume_down": {
        const cur = store.player.volume;
        store.setVolume(Math.max(0, Math.round(cur - 3)));
        break;
      }
      case "toggle_overlay":
        if (document.hidden && !store.isOverlay) {
          break;
        }
        await store.toggleOverlay();
        break;
    }
  });

  void listen<ToastMessage>("app://toast", (toast) => {
    if (toast?.message) useStore.getState().addToast(toast.message, toast.level ?? "info");
  });
}
