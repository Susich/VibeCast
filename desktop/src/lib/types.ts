export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  durationMs: number;
  mime: string;
  size: number;
  trackNo?: number | null;
  year?: number | null;
  coverId?: number | null;
  dateModified: number;
}

export interface TrackRow extends Track {
  cached: boolean;
}

export interface ServerView {
  baseUrl: string;
  deviceName: string;
  online: boolean;
  version: number;
  trackCount: number;
  protocol: number;
  hasToken: boolean;
}

export interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  baseUrl: string;
  version: string | null;
  tokenRequired: boolean;
  token?: string | null;
  pingMs?: number | null;
  source?: string | null;
}

export interface PlayerState {
  currentTrackId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  source: "stream" | "cache" | null;
  loading: boolean;
  buffering: boolean;
  error: string | null;
}

export interface Settings {
  volume: number;
  mpvPath: string | null;
  theme?: string;
  cacheMode?: "auto" | "manual";
}

export interface OverlayState {
  isOverlay: boolean;
  x: number | null;
  y: number | null;
}

export interface AppConfig {
  theme: string;
  volume: number;
  mpvPath: string | null;
  overlay: OverlayState;
  cacheMode?: "auto" | "manual";
}

export interface LibraryStats {
  tracks: number;
  artists: number;
  albums: number;
  version: number;
  syncedAt: number;
}

export interface CacheStats {
  count: number;
  bytes: number;
}

export interface Bootstrap {
  server: ServerView | null;
  devices: Device[];
  player: PlayerState;
  settings: Settings;
  stats: LibraryStats;
  cachedCount: number;
}

export interface SearchQuery {
  query?: string;
  artist?: string;
  album?: string;
  sort?: SortKey;
  limit?: number;
  offset?: number;
  cachedOnly?: boolean;
}

export type SortKey = "title" | "artist" | "album" | "duration" | "added";

export interface SearchResult {
  tracks: TrackRow[];
  total: number;
}

export interface Facet {
  name: string;
  count: number;
}

export interface AlbumFacet {
  album: string;
  artist: string;
  count: number;
  coverTrackId: string | null;
}

export interface Facets {
  artists: Facet[];
  albums: AlbumFacet[];
}

export interface CacheProgress {
  trackId: string;
  received: number;
  total: number;
  done: boolean;
  error: string | null;
}

export interface ToastMessage {
  message: string;
  level: "info" | "success" | "error";
}

export interface RemoteCommand {
  action: "play" | "pause" | "toggle" | "next" | "prev" | "seek" | "volume" | "play_track";
  position?: number | null;
  volume?: number | null;
  trackId?: string | null;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  downloadUrl?: string | null;
  releaseNotes?: string | null;
}

export type ViewKind = "tracks" | "cached" | "artists" | "albums";

export const emptyStats: LibraryStats = {
  tracks: 0,
  artists: 0,
  albums: 0,
  version: 0,
  syncedAt: 0,
};

export const emptyPlayer = (volume = 80): PlayerState => ({
  currentTrackId: null,
  title: null,
  artist: null,
  album: null,
  position: 0,
  duration: 0,
  paused: true,
  volume,
  source: null,
  loading: false,
  buffering: false,
  error: null,
});
