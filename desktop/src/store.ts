import { create } from "zustand";

import { call } from "./lib/api";
import { errorText } from "./lib/format";
import { applyTheme } from "./themes";
import type {
  Bootstrap,
  CacheProgress,
  CacheStats,
  Device,
  Facets,
  LibraryStats,
  OverlayState,
  PlayerState,
  SearchQuery,
  SearchResult,
  ServerView,
  Settings,
  SortKey,
  ToastMessage,
  TrackRow,
  ViewKind,
} from "./lib/types";
import { emptyPlayer, emptyStats } from "./lib/types";

interface ToastEntry extends ToastMessage {
  id: number;
}

interface Store {
  booted: boolean;
  bootError: string | null;
  server: ServerView | null;
  devices: Device[];
  stats: LibraryStats;
  settings: Settings;
  player: PlayerState;
  cachedCount: number;

  view: ViewKind;
  search: string;
  sort: SortKey;
  artist: string | null;
  album: string | null;
  tracks: TrackRow[];
  total: number;
  loading: boolean;
  libraryError: string | null;
  facets: Facets;
  facetsLoading: boolean;

  queue: TrackRow[];
  queueIndex: number;
  queueOpen: boolean;

  connectOpen: boolean;
  settingsOpen: boolean;
  connecting: boolean;
  connectError: string | null;

  covers: Record<string, string>;
  coverLoading: Record<string, boolean>;
  progress: Record<string, CacheProgress>;
  toasts: ToastEntry[];

  theme: string;
  isOverlay: boolean;

  init: () => Promise<void>;
  setTheme: (theme: string) => Promise<void>;
  toggleOverlay: (enable?: boolean) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshFacets: () => Promise<void>;
  navigate: (view: ViewKind) => void;
  selectArtist: (artist: string) => void;
  selectAlbum: (album: string, artist: string) => void;
  clearFilters: () => void;
  setSearch: (value: string) => void;
  setSort: (value: SortKey) => void;
  playTrack: (track: TrackRow) => void;
  playQueueItem: (index: number) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  toggle: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  setVolume: (volume: number) => void;
  onPlayerState: (player: PlayerState) => void;
  onEof: (payload: { trackId?: string }) => void;
  clearQueue: () => void;
  toggleQueue: () => void;
  openConnect: () => void;
  closeConnect: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  connect: (url: string, token: string) => Promise<void>;
  connectSaved: (url: string, silent?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  updateMpvPath: (path: string) => Promise<void>;
  clearCache: () => Promise<void>;
  setCacheMode: (mode: "auto" | "manual") => Promise<void>;
  deleteCachedTrack: (trackId: string) => Promise<void>;
  cacheTrack: (trackId: string) => Promise<void>;
  onTrackDeleted: (trackId: string, stats: CacheStats) => void;
  resync: () => Promise<void>;
  onLibraryUpdated: (stats: LibraryStats) => void;
  onServerChanged: (server: ServerView | null) => void;
  onDevices: (devices: Device[]) => void;
  onCacheProgress: (progress: CacheProgress) => void;
  onCacheCleared: (stats: CacheStats) => void;
  loadCover: (trackId: string) => void;
  addToast: (message: string, level?: ToastMessage["level"]) => void;
  removeToast: (id: number) => void;
}

let libraryRequest = 0;
let initializing = false;
let toastCounter = 0;

function updateRows(rows: TrackRow[], trackId: string, cached: boolean): TrackRow[] {
  return rows.map((row) => (row.id === trackId ? { ...row, cached } : row));
}

function sameDeviceName(saved: string, discovered: string): boolean {
  const a = saved.trim().toLowerCase();
  const b = discovered.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

let autoConnectAttempted = new Set<string>();
let discoveryPrompted = false;

function pickReconnect(
  server: ServerView | null,
  devices: Device[],
): Device | null {
  if (!server || server.online) return null;
  return (
    devices.find(
      (device) =>
        sameDeviceName(server.deviceName, device.name) &&
        device.baseUrl !== server.baseUrl &&
        !autoConnectAttempted.has(device.baseUrl),
    ) ?? null
  );
}

export const useStore = create<Store>()((set, get) => ({
  booted: false,
  bootError: null,
  server: null,
  devices: [],
  stats: emptyStats,
  settings: { volume: 80, mpvPath: null },
  player: emptyPlayer(),
  cachedCount: 0,

  view: "tracks",
  search: "",
  sort: "title",
  artist: null,
  album: null,
  tracks: [],
  total: 0,
  loading: false,
  libraryError: null,
  facets: { artists: [], albums: [] },
  facetsLoading: false,

  queue: [],
  queueIndex: -1,
  queueOpen: false,

  connectOpen: false,
  settingsOpen: false,
  connecting: false,
  connectError: null,

  covers: {},
  coverLoading: {},
  progress: {},
  toasts: [],
  theme: "cyberpunk",
  isOverlay: false,

  async init() {
    if (get().booted || initializing) return;
    initializing = true;
    try {
      const boot = await call<Bootstrap>("bootstrap");
      const initialTheme = boot.settings.theme || "cyberpunk";
      applyTheme(initialTheme);
      set({
        server: boot.server,
        devices: boot.devices,
        player: boot.player,
        settings: boot.settings,
        stats: boot.stats,
        cachedCount: boot.cachedCount,
        theme: initialTheme,
        isOverlay: false,
        booted: true,
      });
      await Promise.all([get().refreshLibrary(), get().refreshFacets()]);
      if (!get().server?.online && get().devices.length > 0) {
        const candidate = get().devices.find((d) => !autoConnectAttempted.has(d.baseUrl)) ?? get().devices[0];
        if (candidate && !autoConnectAttempted.has(candidate.baseUrl)) {
          autoConnectAttempted.add(candidate.baseUrl);
          void get().connect(candidate.baseUrl, candidate.token ?? "");
        }
      }
      const candidate = pickReconnect(get().server, get().devices);
      if (candidate) {
        autoConnectAttempted.add(candidate.baseUrl);
        void get().connectSaved(candidate.baseUrl, true);
      }
    } catch (error) {
      set({ bootError: errorText(error), booted: true });
    } finally {
      initializing = false;
    }
  },

  async setTheme(theme: string) {
    applyTheme(theme);
    set({
      theme,
      settings: { ...get().settings, theme },
    });
    try {
      await call("set_theme", { theme });
    } catch {
      // fallback
    }
  },

  async toggleOverlay(enable?: boolean) {
    const target = typeof enable === "boolean" ? enable : !get().isOverlay;
    set({ isOverlay: target });
    try {
      const res = await call<OverlayState>("set_overlay_mode", { enabled: target });
      set({ isOverlay: res.isOverlay });
    } catch (err) {
      get().addToast(`Ошибка переключения оверлея: ${errorText(err)}`, "error");
      set({ isOverlay: !target });
    }
  },

  async refreshLibrary() {
    const state = get();
    const request = ++libraryRequest;
    const query: SearchQuery = {
      query: state.search.trim() || undefined,
      artist: state.artist ?? undefined,
      album: state.album ?? undefined,
      sort: state.sort,
      cachedOnly: state.view === "cached" ? true : undefined,
      limit: 20000,
      offset: 0,
    };
    set({ loading: true, libraryError: null });
    try {
      const result = await call<SearchResult>("search_tracks", { query });
      if (request !== libraryRequest) return;

      const currentId = get().player.currentTrackId;
      const currentQueue = get().queue;
      let newQueue = currentQueue;
      let newQueueIndex = get().queueIndex;

      // When sorting/filters change:
      // If currently playing track exists in new results, synchronize queue with the new sorted view!
      if (currentId) {
        const idxInNewTracks = result.tracks.findIndex((t) => t.id === currentId);
        if (idxInNewTracks !== -1) {
          newQueue = [...result.tracks];
          newQueueIndex = idxInNewTracks;
        } else {
          // If current track is not in the new filter, preserve currentQueue and maintain accurate queueIndex
          const idxInCurrentQueue = currentQueue.findIndex((t) => t.id === currentId);
          if (idxInCurrentQueue !== -1) {
            newQueueIndex = idxInCurrentQueue;
          }
        }
      }

      set({
        tracks: result.tracks,
        total: result.total,
        queue: newQueue,
        queueIndex: newQueueIndex,
        loading: false,
      });
    } catch (error) {
      if (request !== libraryRequest) return;
      set({ loading: false, libraryError: errorText(error) });
    }
  },

  async refreshFacets() {
    set({ facetsLoading: true });
    try {
      const facets = await call<Facets>("facets");
      set({ facets, facetsLoading: false });
    } catch {
      set({ facetsLoading: false });
    }
  },

  navigate(view) {
    set({ view, artist: null, album: null, search: "" });
    void get().refreshLibrary();
  },

  selectArtist(artist) {
    set({ view: "tracks", artist, album: null, search: "" });
    void get().refreshLibrary();
  },

  selectAlbum(album, artist) {
    set({ view: "tracks", artist, album, search: "" });
    void get().refreshLibrary();
  },

  clearFilters() {
    set({ artist: null, album: null });
    void get().refreshLibrary();
  },

  setSearch(value) {
    set({ search: value });
  },

  setSort(value) {
    set({ sort: value });
    void get().refreshLibrary();
  },

  playTrack(track) {
    const { tracks } = get();
    // When clicking a track in the list, queue is formed from current view's tracks in their exact sort order
    const nextQueue = tracks.some((row) => row.id === track.id) ? [...tracks] : [track];
    const nextIndex = Math.max(0, nextQueue.findIndex((row) => row.id === track.id));

    set({
      queue: nextQueue,
      queueIndex: nextIndex,
      player: {
        ...get().player,
        currentTrackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        position: 0,
        duration: track.durationMs / 1000,
        paused: false,
        source: track.cached ? "cache" : "stream",
        loading: true,
        buffering: false,
        error: null,
      },
    });
    void call<PlayerState>("play_track", { trackId: track.id })
      .then((player) => set({ player }))
      .catch((error) => {
        const message = errorText(error);
        set({
          player: { ...get().player, loading: false, paused: true, error: message },
        });
        get().addToast(message, "error");
      });
  },

  playQueueItem(index) {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const track = queue[index];
    set({
      queueIndex: index,
      player: {
        ...get().player,
        currentTrackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        position: 0,
        duration: track.durationMs / 1000,
        paused: false,
        source: track.cached ? "cache" : "stream",
        loading: true,
        buffering: false,
        error: null,
      },
    });
    void call<PlayerState>("play_track", { trackId: track.id })
      .then((player) => set({ player }))
      .catch((error) => {
        const message = errorText(error);
        set({
          player: { ...get().player, loading: false, paused: true, error: message },
        });
        get().addToast(message, "error");
      });
  },

  async next() {
    const { queue, queueIndex, player } = get();
    if (queue.length === 0) return;

    // Resilient queueIndex alignment
    let currentIndex = queueIndex;
    if (player.currentTrackId && (currentIndex < 0 || currentIndex >= queue.length || queue[currentIndex]?.id !== player.currentTrackId)) {
      const found = queue.findIndex((t) => t.id === player.currentTrackId);
      if (found !== -1) currentIndex = found;
    }

    if (currentIndex + 1 < queue.length) {
      get().playQueueItem(currentIndex + 1);
      return;
    }
    try {
      await call("stop_playback");
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
    set({
      player: {
        ...get().player,
        currentTrackId: null,
        title: null,
        artist: null,
        album: null,
        position: 0,
        duration: 0,
        paused: true,
        source: null,
        loading: false,
        buffering: false,
      },
    });
  },

  async prev() {
    const { player, queue, queueIndex } = get();
    if (!player.currentTrackId || queue.length === 0) return;
    if (player.position > 3) {
      await get().seek(0);
      return;
    }

    let currentIndex = queueIndex;
    if (currentIndex < 0 || currentIndex >= queue.length || queue[currentIndex]?.id !== player.currentTrackId) {
      const found = queue.findIndex((t) => t.id === player.currentTrackId);
      if (found !== -1) currentIndex = found;
    }

    if (currentIndex > 0) {
      get().playQueueItem(currentIndex - 1);
    } else {
      await get().seek(0);
    }
  },

  async toggle() {
    if (!get().player.currentTrackId) {
      get().addToast("Сначала выберите трек", "info");
      return;
    }
    const paused = !get().player.paused;
    set({ player: { ...get().player, paused } });
    try {
      const player = await call<PlayerState>("toggle_pause");
      set({ player });
    } catch (error) {
      set({ player: { ...get().player, paused: !paused } });
      get().addToast(errorText(error), "error");
    }
  },

  async seek(position) {
    if (!get().player.currentTrackId) return;
    set({ player: { ...get().player, position } });
    try {
      const player = await call<PlayerState>("seek", { position });
      set({ player });
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
  },

  setVolume(volume) {
    const clamped = Math.max(0, Math.min(100, volume));
    set({
      player: { ...get().player, volume: clamped },
      settings: { ...get().settings, volume: clamped },
    });
    // Instant real-time update to backend atomic volume (zero debounce):
    void call<PlayerState>("set_volume", { volume: clamped }).catch(() => undefined);
  },

  onPlayerState(player) {
    set({ player });
  },

  onEof(payload) {
    const current = get().player.currentTrackId;
    if (!current || (payload.trackId && payload.trackId !== current)) return;
    void get().next();
  },

  clearQueue() {
    const current = get().queue[get().queueIndex];
    set({ queue: current ? [current] : [], queueIndex: current ? 0 : -1 });
  },

  toggleQueue() {
    set({ queueOpen: !get().queueOpen });
  },

  openConnect() {
    set({ connectOpen: true, connectError: null });
  },

  closeConnect() {
    set({ connectOpen: false, connectError: null });
  },

  openSettings() {
    set({ settingsOpen: true });
  },

  closeSettings() {
    set({ settingsOpen: false });
  },

  async connect(url, token) {
    set({ connecting: true, connectError: null });
    try {
      const server = await call<ServerView>("connect_manual", {
        url: url.trim(),
        token: token.trim() || null,
      });
      set({
        server,
        connecting: false,
        connectOpen: false,
        covers: {},
        coverLoading: {},
        progress: {},
        stats: {
          ...get().stats,
          version: server.version,
          tracks: server.trackCount,
        },
      });
      get().addToast(`Подключено: ${server.deviceName}`, "success");
      await Promise.all([get().refreshLibrary(), get().refreshFacets()]);
      try {
        const cache = await call<CacheStats>("cache_stats");
        set({ cachedCount: cache.count });
      } catch {
        /* cache stats are informational */
      }
    } catch (error) {
      set({ connecting: false, connectError: errorText(error) });
    }
  },

  async connectSaved(url, silent = false) {
    set({ connecting: true, connectError: null });
    try {
      const server = await call<ServerView>("connect_saved", { url: url.trim() });
      set({
        server,
        connecting: false,
        connectOpen: false,
        covers: {},
        coverLoading: {},
        progress: {},
        stats: {
          ...get().stats,
          version: server.version,
          tracks: server.trackCount,
        },
      });
      get().addToast(`Подключено: ${server.deviceName}`, "success");
      await Promise.all([get().refreshLibrary(), get().refreshFacets()]);
      try {
        const cache = await call<CacheStats>("cache_stats");
        set({ cachedCount: cache.count });
      } catch {
        /* cache stats are informational */
      }
    } catch (error) {
      set({ connecting: false, connectError: errorText(error) });
      if (silent) {
        get().addToast(errorText(error), "error");
      }
    }
  },

  async disconnect() {
    try {
      await call("disconnect");
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
    set({
      server: null,
      stats: emptyStats,
      tracks: [],
      total: 0,
      facets: { artists: [], albums: [] },
      queue: [],
      queueIndex: -1,
      covers: {},
      coverLoading: {},
      progress: {},
      cachedCount: 0,
      player: emptyPlayer(get().settings.volume),
      settingsOpen: false,
    });
    get().addToast("Телефон отключён", "info");
  },

  async updateMpvPath(path) {
    try {
      await call("update_settings", { mpvPath: path.trim() || null });
      set({
        settings: {
          ...get().settings,
          mpvPath: path.trim() || null,
        },
      });
      get().addToast("Настройки сохранены", "success");
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
  },

  async clearCache() {
    try {
      const stats = await call<CacheStats>("clear_cache");
      set({
        cachedCount: stats.count,
        tracks: get().view === "cached" ? [] : get().tracks.map((row) => ({ ...row, cached: false })),
        queue: get().queue.map((row) => ({ ...row, cached: false })),
        progress: {},
      });
      if (get().view === "cached") {
        set({ total: 0 });
      }
      get().addToast("Кэш аудио очищен", "success");
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
  },

  async setCacheMode(mode: "auto" | "manual") {
    set({
      settings: { ...get().settings, cacheMode: mode },
    });
    try {
      await call("set_cache_mode", { mode });
      get().addToast(
        mode === "auto"
          ? "Кэширование: всегда при воспроизведении"
          : "Кэширование: только вручную",
        "info"
      );
    } catch {
      // fallback
    }
  },

  async cacheTrack(trackId: string) {
    try {
      await call("cache_track", { trackId });
      get().addToast("Скачивание в кэш начато...", "info");
    } catch (err) {
      get().addToast(`Ошибка скачивания в кэш: ${errorText(err)}`, "error");
    }
  },

  async deleteCachedTrack(trackId: string) {
    try {
      const stats = await call<CacheStats>("delete_cached_track", { trackId });
      get().onTrackDeleted(trackId, stats);
      get().addToast("Трек удалён из кэша", "info");
    } catch (err) {
      get().addToast(`Не удалось удалить из кэша: ${errorText(err)}`, "error");
    }
  },

  async resync() {
    try {
      const stats = await call<LibraryStats>("resync");
      set({ stats });
      await Promise.all([get().refreshLibrary(), get().refreshFacets()]);
      get().addToast("Каталог обновлён", "success");
    } catch (error) {
      get().addToast(errorText(error), "error");
    }
  },

  onLibraryUpdated(stats) {
    set({
      stats,
      server: get().server
        ? {
            ...get().server!,
            version: stats.version,
            trackCount: stats.tracks,
          }
        : null,
    });
    void get().refreshLibrary();
    void get().refreshFacets();
  },

  onServerChanged(server) {
    const previous = get().server;
    set({ server });
    if (!server) {
      autoConnectAttempted.clear();
      set({ covers: {}, coverLoading: {} });
      return;
    }
    if (server.online) {
      autoConnectAttempted.clear();
    }
    if (!previous || previous.baseUrl !== server.baseUrl) {
      set({ covers: {}, coverLoading: {} });
    }
    if (server.online) return;
    const state = get();
    if (state.connecting) return;
    // Discovery may report the phone before SSE notices that the old address
    // died. Retry on the offline transition as well, otherwise that ordering
    // loses the automatic reconnect.
    const candidate = pickReconnect(server, state.devices);
    if (candidate) {
      autoConnectAttempted.add(candidate.baseUrl);
      void state.connectSaved(candidate.baseUrl, true);
      return;
    }
    if (previous?.online) {
      get().addToast("Телефон недоступен — играет кэш", "error");
    }
  },

  onDevices(devices) {
    set({ devices });
    const state = get();
    if (state.connecting) return;

    if ((!state.server || !state.server.online) && devices.length > 0) {
      const candidate = devices.find((d) => !autoConnectAttempted.has(d.baseUrl));
      if (candidate) {
        autoConnectAttempted.add(candidate.baseUrl);
        void state.connect(candidate.baseUrl, candidate.token ?? "");
        return;
      }
    }

    const candidate = pickReconnect(state.server, devices);
    if (!candidate) return;
    autoConnectAttempted.add(candidate.baseUrl);
    void state.connectSaved(candidate.baseUrl, true);
  },

  onCacheProgress(progress) {
    set({ progress: { ...get().progress, [progress.trackId]: progress } });
    if (progress.done && !progress.error) {
      set({
        tracks: updateRows(get().tracks, progress.trackId, true),
        queue: updateRows(get().queue, progress.trackId, true),
      });
      void call<CacheStats>("cache_stats")
        .then((stats) => set({ cachedCount: stats.count }))
        .catch(() => undefined);
    }
  },

  onCacheCleared(stats) {
    set({
      cachedCount: stats.count,
      progress: {},
      tracks: get().view === "cached" ? [] : get().tracks.map((row) => ({ ...row, cached: false })),
      queue: get().queue.map((row) => ({ ...row, cached: false })),
    });
    if (get().view === "cached") {
      set({ total: 0 });
    }
  },

  onTrackDeleted(trackId, stats) {
    const isCachedView = get().view === "cached";
    set({
      cachedCount: stats.count,
      tracks: isCachedView
        ? get().tracks.filter((row) => row.id !== trackId)
        : updateRows(get().tracks, trackId, false),
      queue: updateRows(get().queue, trackId, false),
    });
    if (isCachedView) {
      set({ total: Math.max(0, get().total - 1) });
    }
  },

  loadCover(trackId) {
    const state = get();
    if (state.covers[trackId] !== undefined || state.coverLoading[trackId]) return;
    set({ coverLoading: { ...state.coverLoading, [trackId]: true } });
    void call<string | null>("get_cover", { trackId })
      .then((url) => {
        set({
          covers: { ...get().covers, [trackId]: url ?? "" },
          coverLoading: { ...get().coverLoading, [trackId]: false },
        });
      })
      .catch(() => {
        set({
          covers: { ...get().covers, [trackId]: "" },
          coverLoading: { ...get().coverLoading, [trackId]: false },
        });
      });
  },

  addToast(message, level = "info") {
    const id = ++toastCounter;
    set({ toasts: [...get().toasts, { id, message, level }] });
    setTimeout(() => get().removeToast(id), 4200);
  },

  removeToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
}));
