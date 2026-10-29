import { useEffect } from "react";

import { artworkGradient, initials } from "../lib/format";
import { useStore } from "../store";

interface CoverProps {
  trackId: string;
  title: string;
  size?: number;
  className?: string;
}

export function Cover({ trackId, title, size = 40, className }: CoverProps) {
  const url = useStore((state) => state.covers[trackId]);
  const loadCover = useStore((state) => state.loadCover);

  useEffect(() => {
    loadCover(trackId);
  }, [loadCover, trackId]);

  const gradient = artworkGradient(`${title}:${trackId}`);

  return (
    <div
      className={`cover ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        background: gradient.background,
        color: gradient.color,
        borderRadius: Math.max(6, Math.round(size * 0.16)),
      }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} loading="lazy" />
      ) : (
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.3)) }}>{initials(title)}</span>
      )}
    </div>
  );
}
