import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatCount } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { ChevronRightIcon, DiscIcon, UsersIcon } from "./Icons";

export function ArtistsView() {
  const facets = useStore((state) => state.facets);
  const search = useStore((state) => state.search);
  const selectArtist = useStore((state) => state.selectArtist);
  const needle = search.trim().toLocaleLowerCase("ru");
  const artists = needle
    ? facets.artists.filter((item) => item.name.toLocaleLowerCase("ru").includes(needle))
    : facets.artists;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 8,
  });

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [needle]);

  if (!artists.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <UsersIcon size={30} />
        </div>
        <h3>{needle ? "Исполнители не найдены" : "Исполнителей пока нет"}</h3>
        <p>{needle ? "Измените поисковый запрос." : "Добавьте музыку на телефон и обновите каталог."}</p>
      </div>
    );
  }

  return (
    <div className="browse-scroll" ref={parentRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const artist = artists[item.index];
          if (!artist) return null;
          return (
            <button
              key={artist.name}
              className="browse-row"
              style={{
                transform: `translateY(${item.start}px)`,
                height: item.size - 8,
              }}
              onClick={() => selectArtist(artist.name)}
            >
              <span className="artist-avatar">{artist.name.slice(0, 1).toUpperCase()}</span>
              <span className="browse-copy">
                <b>{artist.name}</b>
                <small>{formatCount(artist.count, "трек", "трека", "треков")}</small>
              </span>
              <span className="browse-open">
                Открыть <ChevronRightIcon size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AlbumsView() {
  const facets = useStore((state) => state.facets);
  const search = useStore((state) => state.search);
  const selectAlbum = useStore((state) => state.selectAlbum);
  const needle = search.trim().toLocaleLowerCase("ru");
  const albums = needle
    ? facets.albums.filter((item) =>
        `${item.album} ${item.artist}`.toLocaleLowerCase("ru").includes(needle),
      )
    : facets.albums;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: albums.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 82,
    overscan: 8,
  });

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [needle]);

  if (!albums.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <DiscIcon size={30} />
        </div>
        <h3>{needle ? "Альбомы не найдены" : "Альбомов пока нет"}</h3>
        <p>{needle ? "Измените поисковый запрос." : "Добавьте музыку на телефон и обновите каталог."}</p>
      </div>
    );
  }

  return (
    <div className="browse-scroll" ref={parentRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const album = albums[item.index];
          if (!album) return null;
          return (
            <button
              key={`${album.artist}:${album.album}`}
              className="browse-row album-row"
              style={{
                transform: `translateY(${item.start}px)`,
                height: item.size - 8,
              }}
              onClick={() => selectAlbum(album.album, album.artist)}
            >
              {album.coverTrackId ? (
                <Cover trackId={album.coverTrackId} title={album.album} size={56} />
              ) : (
                <div className="cover cover-empty" style={{ width: 56, height: 56 }}>
                  <DiscIcon size={20} />
                </div>
              )}
              <span className="browse-copy">
                <b>{album.album}</b>
                <small>
                  {album.artist} · {formatCount(album.count, "трек", "трека", "треков")}
                </small>
              </span>
              <span className="browse-open">
                Открыть <ChevronRightIcon size={16} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
