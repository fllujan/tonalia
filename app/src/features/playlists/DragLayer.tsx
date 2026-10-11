import { FolderClosed, ListMusic, Music } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchAllIds } from "../library/api";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import { playlistApi, usePlaylistMutation, usePlaylistTree } from "./api";
import { setDropHandler, useDragStore } from "./dragStore";
import { canDrop } from "./rules";
import { movePlan } from "./tree";

/** Ghost that follows the pointer while dragging, and the handler that applies drops. */
export function DragLayer() {
  const { t } = useTranslation();
  const tree = usePlaylistTree();
  const openPlaylist = useViewStore((s) => (s.view === "playlist" ? s.playlistId : null));
  const payload = useDragStore((s) => s.payload);
  const x = useDragStore((s) => s.x);
  const y = useDragStore((s) => s.y);
  const target = useDragStore((s) => s.target);
  const add = usePlaylistMutation(playlistApi.addTracks);
  const reorder = usePlaylistMutation(playlistApi.reorderTracks);
  const move = usePlaylistMutation(playlistApi.move);

  useEffect(() => {
    setDropHandler((dragged, at) => {
      if (!canDrop(dragged, at, tree)) return;
      if (dragged.kind === "tracks" && at.kind === "playlist") {
        const node = tree.find((n) => n.id === at.id);
        add.mutate(
          { playlistId: at.id, trackIds: dragged.trackIds },
          {
            onSuccess: (result) =>
              useToastStore.getState().push({
                title:
                  result.changed > 0
                    ? t("playlists.added", { count: result.changed, name: node?.name ?? "" })
                    : t("playlists.alreadyThere", { name: node?.name ?? "" }),
                tone: result.changed > 0 ? "success" : "neutral",
              }),
          },
        );
      } else if (dragged.kind === "tracks" && at.kind === "row" && openPlaylist != null) {
        const playlistId = openPlaylist;
        void fetchAllIds({ playlistId, sort: "position", descending: false, search: null }).then(
          (order) => {
            const moving = new Set(dragged.trackIds);
            const before = order.slice(0, at.index).filter((id) => moving.has(id)).length;
            reorder.mutate({ playlistId, trackIds: dragged.trackIds, index: at.index - before });
          },
        );
      } else if (dragged.kind === "playlist" && at.kind === "playlist") {
        const plan = movePlan(tree, dragged.id, at.id, at.zone);
        if (plan) move.mutate({ playlistId: dragged.id, ...plan });
      }
    });
    return () => setDropHandler(null);
  }, [tree, openPlaylist, add, reorder, move, t]);

  if (!payload) return null;
  const allowed = target != null && canDrop(payload, target, tree);
  const Icon = payload.kind === "tracks" ? Music : payload.isFolder ? FolderClosed : ListMusic;
  return (
    <div
      aria-hidden
      style={{ left: x + 14, top: y + 10 }}
      className={`pointer-events-none fixed z-[60] flex max-w-[260px] items-center gap-2 rounded-pill border bg-surface-1 px-3 py-1 text-[12px] shadow-overlay ${allowed ? "border-primary text-text" : "border-border text-text-2"}`}
    >
      <Icon size={14} strokeWidth={1.5} />
      <span className="truncate">{payload.label}</span>
    </div>
  );
}
