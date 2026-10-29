import { create } from "zustand";

import { call } from "./lib/api";
import { errorText } from "./lib/format";
import type {
  Bootstrap,
  CacheProgress,
  CacheStats,
  Device,
  Facets,
  LibraryStats,
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

  init: () => Promise<void>;
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
  disconnect: () => Promise<void>;
  updateMpvPath: (path: string) => Promise<void>;
  clearCache: () => Promise<void>;
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
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let toastCounter = 0;

function updateRows(rows: TrackRow[], trackId: string, cached: boolean): TrackRow[] {
  return rows.map((row) => (row.id === trackId ? { ...row, cached } : row));
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

  async init() {
    if (get().booted || initializing) return;
    initializing = true;
    try {
      const boot = await call<Bootstrap>("bootstrap");
      set({
        server: boot.server,
        devices: boot.devices,
        player: boot.player,
        settings: boot.settings,
        stats: boot.stats,
        cachedCount: boot.cachedCount,
        booted: true,
      });
      await Promise.all([get().refreshLibrary(), get().refreshFacets()]);
    } catch (error) {
      set({ bootError: errorText(error), booted: true });
    } finally {
      initializing = false;
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
      limit: 20000,
      offset: 0,
    };
    set({ loading: true, libraryError: null });
    try {
      const result = await call<SearchResult>("search_tracks", { query });
      if (request !== libraryRequest) return;
      set({ tracks: result.tracks, total: result.total, loading: false });
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
    const { tracks, queue, queueIndex } = get();
    let nextQueue = queue;
    let nextIndex = queueIndex;
    if (nextQueue.length === 0 || !nextQueue.some((row) => row.id === track.id)) {
      nextQueue = tracks.some((row) => row.id === track.id) ? tracks : [track];
      nextIndex = nextQueue.findIndex((row) => row.id === track.id);
    } else {
      nextIndex = nextQueue.findIndex((row) => row.id === track.id);
    }
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
    set({ queueIndex: index });
    get().playTrack(queue[index]);
  },

  async next() {
    const { queue, queueIndex } = get();
    if (queueIndex + 1 < queue.length) {
      get().playQueueItem(queueIndex + 1);
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
    if (!player.currentTrackId) return;
    if (player.position > 3 || queueIndex <= 0) {
      await get().seek(0);
      return;
    }
    get().playQueueItem(queueIndex - 1);
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
    if (volumeTimer) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => {
      void call<PlayerState>("set_volume", { volume: clamped }).catch(() => undefined);
    }, 110);
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
        tracks: get().tracks.map((row) => ({ ...row, cached: false })),
        queue: get().queue.map((row) => ({ ...row, cached: false })),
        progress: {},
      });
      get().addToast("Кэш аудио очищен", "success");
    } catch (error) {
      get().addToast(errorText(error), "error");
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
      set({ covers: {}, coverLoading: {} });
      return;
    }
    if (previous?.online && !server.online) {
      get().addToast("Телефон недоступен — играет кэш", "error");
    }
    if (!previous || previous.baseUrl !== server.baseUrl) {
      set({ covers: {}, coverLoading: {} });
    }
  },

  onDevices(devices) {
    set({ devices });
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
      tracks: get().tracks.map((row) => ({ ...row, cached: false })),
      queue: get().queue.map((row) => ({ ...row, cached: false })),
    });
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
