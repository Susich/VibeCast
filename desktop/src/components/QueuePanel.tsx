import { useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatTime } from "../lib/format";
import { useStore } from "../store";
import { Cover } from "./Cover";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  ListMusicIcon,
  PlayIcon,
  ShuffleIcon,
  TrashIcon,
  XIcon,
} from "./Icons";

export function QueuePanel() {
  const open = useStore((state) => state.queueOpen);
  const queue = useStore((state) => state.queue);
  const queueIndex = useStore((state) => state.queueIndex);
  const currentId = useStore((state) => state.player.currentTrackId);
  const playing = useStore((state) => state.player.paused === false);
  const toggleQueue = useStore((state) => state.toggleQueue);
  const playQueueItem = useStore((state) => state.playQueueItem);
  const clearQueue = useStore((state) => state.clearQueue);
  const reorderQueue = useStore((state) => state.reorderQueue);
  const removeFromQueue = useStore((state) => state.removeFromQueue);
  const shuffle = useStore((state) => state.shuffle);
  const toggleShuffle = useStore((state) => state.toggleShuffle);

  const [dragState, setDragState] = useState<{
    fromIndex: number;
    toIndex: number;
  } | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 8,
  });

  const handleGripPointerDown = (index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const fromIdx = index;
    let targetIdx = index;
    setDragState({ fromIndex: fromIdx, toIndex: targetIdx });

    const handlePointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const elements = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (const el of elements) {
        const rawAttr = el.getAttribute("data-queue-index");
        if (rawAttr !== null) {
          const parsed = Number(rawAttr);
          if (!isNaN(parsed) && parsed !== targetIdx) {
            targetIdx = parsed;
            setDragState({ fromIndex: fromIdx, toIndex: targetIdx });
          }
          break;
        }
      }
    };

    const handlePointerUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      if (fromIdx !== targetIdx) {
        reorderQueue(fromIdx, targetIdx);
      }
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const handleDragStart = (index: number, e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
    setDragState({ fromIndex: index, toIndex: index });
  };

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!dragState || dragState.toIndex !== index) {
      setDragState((prev) =>
        prev ? { ...prev, toIndex: index } : { fromIndex: index, toIndex: index }
      );
    }
  };

  const handleDrop = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData("text/plain");
    const src = Number(raw);
    const tgt = index;
    if (!isNaN(src) && src !== tgt) {
      reorderQueue(src, tgt);
    } else if (dragState && dragState.fromIndex !== tgt) {
      reorderQueue(dragState.fromIndex, tgt);
    }
    setDragState(null);
  };

  if (!open) return null;

  return (
    <>
      <div className="queue-backdrop" onClick={toggleQueue} />
      <aside className={`queue-panel ${dragState ? "is-reordering" : ""}`}>
        <header className="queue-head">
          <div>
            <span className="eyebrow">Сейчас и далее</span>
            <h2>Очередь</h2>
          </div>
          <div className="queue-head-actions">
            {queue.length > 1 && (
              <button
                className={`icon-button ghost ${shuffle ? "active" : ""}`}
                onClick={toggleShuffle}
                title={shuffle ? "Перемешивание включено" : "Перемешать очередь"}
              >
                <ShuffleIcon size={16} />
              </button>
            )}
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
                const isDragging = dragState?.fromIndex === item.index;
                const isDropTarget =
                  dragState &&
                  dragState.toIndex === item.index &&
                  dragState.fromIndex !== item.index;

                const dropPositionClass = isDropTarget
                  ? item.index > dragState.fromIndex
                    ? "is-drop-target-after"
                    : "is-drop-target-before"
                  : "";

                return (
                  <div
                    key={`${track.id}:${item.index}`}
                    data-queue-index={item.index}
                    className={`queue-row ${active ? "active" : ""} ${
                      isDragging ? "is-dragging" : ""
                    } ${dropPositionClass}`}
                    style={{
                      transform: `translateY(${item.start}px)`,
                      height: item.size - 4,
                    }}
                    onDragOver={(e) => handleDragOver(item.index, e)}
                    onDrop={(e) => handleDrop(item.index, e)}
                    onClick={() => playQueueItem(item.index)}
                    role="button"
                    tabIndex={0}
                  >
                    <span
                      className="queue-drag-handle"
                      title="Зажмите и перетащите трек"
                      style={{ touchAction: "none" }}
                      draggable
                      onDragStart={(e) => handleDragStart(item.index, e)}
                      onDragEnd={() => setDragState(null)}
                      onPointerDown={(e) => handleGripPointerDown(item.index, e)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVerticalIcon size={14} />
                    </span>
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

                    <div
                      className="queue-row-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="queue-action-mini-btn"
                        title="Поднять выше"
                        disabled={item.index === 0}
                        onClick={() => {
                          if (item.index > 0) reorderQueue(item.index, item.index - 1);
                        }}
                      >
                        <ChevronUpIcon size={13} />
                      </button>
                      <button
                        className="queue-action-mini-btn"
                        title="Опустить ниже"
                        disabled={item.index === queue.length - 1}
                        onClick={() => {
                          if (item.index < queue.length - 1)
                            reorderQueue(item.index, item.index + 1);
                        }}
                      >
                        <ChevronDownIcon size={13} />
                      </button>
                      <button
                        className="queue-action-mini-btn delete"
                        title="Удалить из очереди"
                        onClick={() => removeFromQueue(item.index)}
                      >
                        <XIcon size={12} />
                      </button>
                    </div>

                    <span className="queue-time">{formatTime(track.durationMs / 1000)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {queue.length > 0 && (
          <footer className="queue-foot">
            {queueIndex + 1} из {queue.length} ·{" "}
            {formatTime(
              queue
                .slice(queueIndex + 1)
                .reduce((sum, track) => sum + track.durationMs / 1000, 0)
            )}{" "}
            осталось
          </footer>
        )}
      </aside>
    </>
  );
}
