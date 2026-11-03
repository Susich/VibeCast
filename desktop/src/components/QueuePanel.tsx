import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatTime } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { ListMusicIcon, PlayIcon, TrashIcon, XIcon } from "./Icons";

export function QueuePanel() {
  const open = useStore((state) => state.queueOpen);
  const queue = useStore((state) => state.queue);
  const queueIndex = useStore((state) => state.queueIndex);
  const currentId = useStore((state) => state.player.currentTrackId);
  const playing = useStore((state) => state.player.paused === false);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const playQueueItem = useStore((state) => state.playQueueItem);
  const clearQueue = useStore((state) => state.clearQueue);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 8,
  });

  if (!open) return null;

  return (
    <>
      <div className="queue-backdrop" onClick={toggleQueue} />
      <aside className="queue-panel">
        <header className="queue-head">
          <div>
            <span className="eyebrow">Сейчас и далее</span>
            <h2>Очередь</h2>
          </div>
          <div className="queue-head-actions">
            {queue.length > 1 && (
              <button className="icon-button ghost" onClick={clearQueue} title="Очистить очередь">
                <TrashIcon size={17} />
              </button>
            )}
            <button className="icon-button ghost modal-close-btn" onClick={toggleQueue} title="Закрыть">
              <XIcon size={18} />
            </button>
          </div>
        </header>

        {queue.length === 0 ? (
          <div className="queue-panel-empty">
            <ListMusicIcon size={30} />
            <h3>Очередь пуста</h3>
            <p>Щёлкните любой трек — он и следующие из списка попадут сюда.</p>
          </div>
        ) : (
          <div className="queue-scroll" ref={parentRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const track = queue[item.index];
                if (!track) return null;
                const active = track.id === currentId;
                return (
                  <button
                    key={`${track.id}:${item.index}`}
                    className={`queue-row ${active ? "active" : ""}`}
                    style={{
                      transform: `translateY(${item.start}px)`,
                      height: item.size - 4,
                    }}
                    onClick={() => playQueueItem(item.index)}
                  >
                    <span className="queue-index">
                      {active ? (
                        playing ? (
                          <span className="equalizer small">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          <PlayIcon size={13} />
                        )
                      ) : (
                        item.index + 1
                      )}
                    </span>
                    <Cover trackId={track.id} title={track.album} size={38} />
                    <span className="queue-copy">
                      <b>{track.title}</b>
                      <small>{track.artist}</small>
                    </span>
                    <span className="queue-time">{formatTime(track.durationMs / 1000)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {queue.length > 0 && (
          <footer className="queue-foot">
            {queueIndex + 1} из {queue.length} · {formatTime(queue.slice(queueIndex + 1).reduce((sum, track) => sum + track.durationMs / 1000, 0))} осталось
          </footer>
        )}
      </aside>
    </>
  );
}
