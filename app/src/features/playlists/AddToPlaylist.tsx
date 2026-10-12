import { ListPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import { Popover } from "../../components/Popover";
import type { PlaylistNode } from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { playlistApi, usePlaylistMutation, usePlaylistTree } from "./api";
import { buildTree, type TreeNode } from "./tree";

/** "Add to playlist" menu for the selected tracks (keyboard alternative to dragging). */
export function AddToPlaylist({ trackIds }: { trackIds: [number, ...number[]] }) {
  const { t } = useTranslation();
  const flat = usePlaylistTree();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const add = usePlaylistMutation(playlistApi.addTracks);
  const create = usePlaylistMutation(playlistApi.create);

  const addTo = (node: PlaylistNode) => {
    setAnchor(null);
    add.mutate(
      { playlistId: node.id, trackIds },
      {
        onSuccess: (result) =>
          useToastStore.getState().push({
            title:
              result.changed > 0
                ? t("playlists.added", { count: result.changed, name: node.name })
                : t("playlists.alreadyThere", { name: node.name }),
            tone: result.changed > 0 ? "success" : "neutral",
          }),
      },
    );
  };

  const renderNode = ({ node, depth, children }: TreeNode): ReactNode => {
    const indent = { paddingLeft: 8 + depth * 14 };
    return (
      <li key={node.id}>
        {node.isFolder ? (
          <div className="flex h-7 items-center gap-2 px-2 text-[12px] text-text-3" style={indent}>
            <PlaylistIcon emoji={node.emoji} isFolder size={14} />
            <span className="truncate">{node.name}</span>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            onClick={() => addTo(node)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-text hover:bg-surface-3"
            style={indent}
          >
            <PlaylistIcon emoji={node.emoji} size={15} className="text-text-3" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          </button>
        )}
        {children.length > 0 && <ul>{children.map(renderNode)}</ul>}
      </li>
    );
  };

  // Smart playlists fill themselves; they are not offered here.
  const tree = buildTree(
    flat.filter((n) => n.smart == null),
    () => true,
  );

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => setAnchor(e.currentTarget)}
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
      >
        <ListPlus size={16} strokeWidth={1.5} />
        {t("playlists.addTo")}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={t("playlists.addTo")} onClose={() => setAnchor(null)}>
          <div role="menu" className="-m-1.5 flex max-h-[360px] w-[260px] flex-col overflow-auto">
            <ul>{tree.map(renderNode)}</ul>
            {tree.length > 0 && <div className="my-1 border-t border-border" />}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAnchor(null);
                create.mutate(
                  { name: t("playlists.untitled") },
                  { onSuccess: (node) => addTo(node) },
                );
              }}
              className="flex h-8 items-center gap-2 rounded-sm px-2 text-left text-primary-ink hover:bg-surface-3"
            >
              <ListPlus size={14} strokeWidth={1.5} />
              {t("playlists.newWithSelection")}
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
