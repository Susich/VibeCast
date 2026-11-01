import type {
  AlbumFacet,
  Bootstrap,
  CacheProgress,
  CacheStats,
  Device,
  Facet,
  Facets,
  LibraryStats,
  PlayerState,
  SearchQuery,
  SearchResult,
  ServerView,
  Settings,
  Track,
  TrackRow,
} from "./types";

type MockListener = (payload: unknown) => void;

const listeners = new Map<string, Set<MockListener>>();

function emit(event: string, payload: unknown): void {
  for (const listener of listeners.get(event) ?? []) listener(payload);
}

export function mockListen<T>(event: string, handler: (payload: T) => void): () => void {
  const set = listeners.get(event) ?? new Set<MockListener>();
  const wrapped: MockListener = (payload) => handler(payload as T);
  set.add(wrapped);
  listeners.set(event, set);
  return () => set.delete(wrapped);
}

const albums: Array<{ album: string; artist: string; year: number; tracks: string[] }> = [
  {
    album: "Ночной эфир",
    artist: "Полярный круг",
    year: 2023,
    tracks: ["Первый снег", "Радиоволна", "Северный ветер", "Город спит"],
  },
  {
    album: "Midnight Signals",
    artist: "Neon Harbour",
    year: 2022,
    tracks: ["Midnight Signals", "Glass Avenue", "Slow Motion", "Afterglow"],
  },
  {
    album: "Тёплый бетон",
    artist: "Тихие дома",
    year: 2024,
    tracks: ["Тёплый бетон", "Пыль на подоконнике", "Кухня", "Двор"],
  },
  {
    album: "Paper Planets",
    artist: "June Atlas",
    year: 2021,
    tracks: ["Paper Planets", "Satellite Heart", "Northern Line", "Small Hours"],
  },
  {
    album: "Между этажами",
    artist: "Лена Ветер",
    year: 2023,
    tracks: ["Между этажами", "Лифт", "Тише", "Позвони"],
  },
  {
    album: "Analog Dreams",
    artist: "Coastal Static",
    year: 2020,
    tracks: ["Analog Dreams", "Cassette Girl", "Blue Motel", "Highway 9"],
  },
  {
    album: "Солнце в кармане",
    artist: "Мятный чай",
    year: 2024,
    tracks: ["Солнце в кармане", "Море внутри", "Летний дождь", "Провода"],
  },
  {
    album: "Static Bloom",
    artist: "Violet Hours",
    year: 2022,
    tracks: ["Static Bloom", "Soft Focus", "Parallel", "Waking Up"],
  },
  {
    album: "Дом у реки",
    artist: "Сосны",
    year: 2019,
    tracks: ["Дом у реки", "Лодка", "Туман", "Старое радио"],
  },
  {
    album: "Golden Static",
    artist: "The Long Way",
    year: 2023,
    tracks: ["Golden Static", "Open Roads", "Anywhere", "Coming Home"],
  },
  {
    album: "Поздние звонки",
    artist: "Март",
    year: 2025,
    tracks: ["Поздние звонки", "Не отвечай", "Этажи", "Рассвет"],
  },
  {
    album: "Low Light",
    artist: "Sable Coast",
    year: 2021,
    tracks: ["Low Light", "Saltwater", "Chrome", "Last Train"],
  },
];

const baseTime = Date.UTC(2025, 4, 12, 18, 0, 0);

function trackId(index: number): string {
  return (index + 1).toString(16).padStart(8, "0").repeat(5);
}

const allTracks: Track[] = albums.flatMap((album, albumIndex) =>
  album.tracks.map((title, trackIndex) => {
    const index = albumIndex * 4 + trackIndex;
    return {
      id: trackId(index),
      title,
      artist: album.artist,
      album: album.album,
      albumArtist: album.artist,
      durationMs: (168 + ((index * 37) % 143)) * 1000,
      mime: index % 7 === 0 ? "audio/flac" : "audio/mpeg",
      size: 4_200_000 + index * 173_000,
      trackNo: trackIndex + 1,
      year: album.year,
      coverId: 100 + albumIndex,
      dateModified: baseTime - index * 86_400_000,
    };
  }),
);

const cachedIds = new Set(allTracks.filter((_, index) => index % 4 === 2).map((track) => track.id));

let server: ServerView | null = {
  baseUrl: "http://192.168.1.42:8765",
  deviceName: "Pixel 8",
  online: true,
  version: 7,
  trackCount: allTracks.length,
  protocol: 1,
  hasToken: true,
};

let settings: Settings = { volume: 80, mpvPath: null };

let player: PlayerState = {
  currentTrackId: null,
  title: null,
  artist: null,
  album: null,
  position: 0,
  duration: 0,
  paused: true,
  volume: 80,
  source: null,
  loading: false,
  buffering: false,
  error: null,
};

let ticker: ReturnType<typeof setInterval> | null = null;
let eofSent = false;

function now(): number {
  return Date.now();
}

function row(track: Track): TrackRow {
  return { ...track, cached: cachedIds.has(track.id) };
}

function sortedTracks(sort = "title"): Track[] {
  const copy = [...allTracks];
  switch (sort) {
    case "artist":
      copy.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist, "ru") ||
          a.album.localeCompare(b.album, "ru") ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0),
      );
      break;
    case "album":
      copy.sort(
        (a, b) =>
          a.album.localeCompare(b.album, "ru") ||
          (a.trackNo ?? 0) - (b.trackNo ?? 0),
      );
      break;
    case "duration":
      copy.sort((a, b) => a.durationMs - b.durationMs);
      break;
    case "added":
      copy.sort((a, b) => b.dateModified - a.dateModified);
      break;
    default:
      copy.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }
  return copy;
}

function stats(): LibraryStats {
  return {
    tracks: allTracks.length,
    artists: new Set(allTracks.map((track) => track.artist)).size,
    albums: new Set(allTracks.map((track) => `${track.artist}\u0000${track.album}`)).size,
    version: server?.version ?? 0,
    syncedAt: now(),
  };
}

function search(query: SearchQuery): SearchResult {
  const needle = (query.query ?? "").trim().toLocaleLowerCase("ru");
  let result = sortedTracks(query.sort);
  if (needle) {
    result = result.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`
        .toLocaleLowerCase("ru")
        .includes(needle),
    );
  }
  if (query.artist) result = result.filter((track) => track.artist === query.artist);
  if (query.album) result = result.filter((track) => track.album === query.album);
  if (query.cachedOnly) result = result.filter((track) => cachedIds.has(track.id));
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, query.limit ?? 20000);
  return {
    total: result.length,
    tracks: result.slice(offset, offset + limit).map(row),
  };
}

function facets(): Facets {
  const artistMap = new Map<string, number>();
  const albumMap = new Map<string, AlbumFacet>();
  for (const track of allTracks) {
    artistMap.set(track.artist, (artistMap.get(track.artist) ?? 0) + 1);
    const key = `${track.artist}\u0000${track.album}`;
    const current = albumMap.get(key);
    if (current) {
      current.count += 1;
    } else {
      albumMap.set(key, {
        album: track.album,
        artist: track.artist,
        count: 1,
        coverTrackId: track.id,
      });
    }
  }
  const artists: Facet[] = [...artistMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const albumList = [...albumMap.values()].sort(
    (a, b) =>
      a.artist.localeCompare(b.artist, "ru") || a.album.localeCompare(b.album, "ru"),
  );
  return { artists, albums: albumList };
}

function cover(trackIdValue: string): string | null {
  const track = allTracks.find((item) => item.id === trackIdValue);
  if (!track) return null;
  const hue = (Number.parseInt(track.id.slice(0, 4), 16) * 7) % 360;
  const label = track.album
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},46%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 52) % 360},54%,14%)"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><circle cx="260" cy="62" r="88" fill="hsl(${hue},80%,70%)" opacity=".16"/><text x="34" y="266" font-family="Segoe UI, sans-serif" font-size="74" font-weight="700" fill="hsl(${hue},70%,90%)" opacity=".9">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function emitPlayer(): void {
  emit("player://state", player);
}

function ensureTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!player.currentTrackId || player.paused || player.loading) return;
    player = {
      ...player,
      position: Math.min(player.duration, player.position + 0.25),
    };
    if (player.duration > 0 && player.position >= player.duration - 0.05) {
      player = { ...player, paused: true };
      if (!eofSent) {
        eofSent = true;
        emit("player://eof", { trackId: player.currentTrackId });
      }
    }
    emitPlayer();
  }, 250);
}

function cacheStats(): CacheStats {
  let bytes = 0;
  for (const track of allTracks) {
    if (cachedIds.has(track.id)) bytes += track.size;
  }
  return { count: cachedIds.size, bytes };
}

function delay<T>(value: T, ms = 90): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function deviceList(): Device[] {
  return [
    {
      id: "mock-pixel",
      name: "Pixel 8",
      host: "192.168.1.42",
      port: 8765,
      baseUrl: "http://192.168.1.42:8765",
      version: "1",
      tokenRequired: true,
    },
    {
      id: "mock-galaxy",
      name: "Galaxy S23",
      host: "192.168.1.57",
      port: 8765,
      baseUrl: "http://192.168.1.57:8765",
      version: "1",
      tokenRequired: true,
    },
  ];
}

export async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const input = args ?? {};
  switch (command) {
    case "bootstrap": {
      const bootstrap: Bootstrap = {
        server,
        devices: deviceList(),
        player,
        settings,
        stats: stats(),
        cachedCount: cachedIds.size,
      };
      return delay(bootstrap, 80) as Promise<T>;
    }
    case "search_tracks":
      return delay(search((input.query ?? {}) as SearchQuery)) as Promise<T>;
    case "facets":
      return delay(facets(), 40) as Promise<T>;
    case "play_track": {
      const id = String(input.trackId ?? "");
      const track = allTracks.find((item) => item.id === id);
      if (!track) throw new Error("Трек не найден в локальном каталоге.");
      eofSent = false;
      player = {
        currentTrackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        position: 0,
        duration: track.durationMs / 1000,
        paused: false,
        volume: settings.volume,
        source: cachedIds.has(track.id) ? "cache" : "stream",
        loading: false,
        buffering: false,
        error: null,
      };
      ensureTicker();
      emitPlayer();
      return delay(player, 40) as Promise<T>;
    }
    case "toggle_pause": {
      player = { ...player, paused: !player.paused };
      emitPlayer();
      return delay(player, 30) as Promise<T>;
    }
    case "set_pause": {
      player = { ...player, paused: Boolean(input.paused) };
      emitPlayer();
      return delay(player, 30) as Promise<T>;
    }
    case "seek": {
      const position = Math.max(0, Math.min(player.duration, Number(input.position) || 0));
      player = { ...player, position };
      eofSent = false;
      emitPlayer();
      return delay(player, 30) as Promise<T>;
    }
    case "set_volume": {
      const volume = Math.max(0, Math.min(100, Number(input.volume) || 0));
      settings = { ...settings, volume };
      player = { ...player, volume };
      emitPlayer();
      return delay(player, 20) as Promise<T>;
    }
    case "get_player_state":
      return player as T;
    case "stop_playback": {
      player = {
        ...player,
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
        error: null,
      };
      eofSent = false;
      emitPlayer();
      return delay(undefined, 20) as Promise<T>;
    }
    case "get_cover":
      return delay(cover(String(input.trackId ?? "")), 30) as Promise<T>;
    case "cache_stats":
      return cacheStats() as T;
    case "clear_cache": {
      cachedIds.clear();
      const result = cacheStats();
      emit("cache://cleared", result);
      return result as T;
    }
    case "disconnect": {
      server = null;
      emit("server://changed", null);
      return undefined as T;
    }
    case "connect_saved": {
      const rawUrl = String(input.url ?? "").trim();
      let baseUrl = rawUrl.replace(/#.*$/, "") || "http://192.168.1.42:8765";
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      server = {
        baseUrl: baseUrl.replace(/\/$/, ""),
        deviceName: "Pixel 8",
        online: true,
        version: 8,
        trackCount: allTracks.length,
        protocol: 1,
        hasToken: true,
      };
      emit("server://changed", server);
      return delay(server, 150) as Promise<T>;
    }
    case "connect_manual": {
      const token = String(input.token ?? "").trim();
      if (token === "bad") {
        throw new Error("Телефон отклонил токен. Проверьте код на экране телефона.");
      }
      const rawUrl = String(input.url ?? "").trim();
      let baseUrl = rawUrl.replace(/#.*$/, "") || "http://192.168.1.42:8765";
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
      server = {
        baseUrl: baseUrl.replace(/\/$/, ""),
        deviceName: "Pixel 8",
        online: true,
        version: 8,
        trackCount: allTracks.length,
        protocol: 1,
        hasToken: Boolean(token),
      };
      emit("server://changed", server);
      return delay(server, 180) as Promise<T>;
    }
    case "resync":
      if (!server) throw new Error("Телефон не подключён.");
      return delay(stats(), 220) as Promise<T>;
    case "update_settings": {
      const mpvPath = String(input.mpvPath ?? "").trim() || null;
      settings = { ...settings, mpvPath };
      return delay(undefined, 40) as Promise<T>;
    }
    case "open_cache_dir":
      return undefined as T;
    default:
      throw new Error(`Неизвестная команда: ${command}`);
  }
}

export function mockCacheProgress(trackId: string): void {
  const total = allTracks.find((track) => track.id === trackId)?.size ?? 0;
  const progress: CacheProgress = { trackId, received: total, total, done: true, error: null };
  cachedIds.add(trackId);
  emit("cache://progress", progress);
}
