// Sidebar sections PLAYLISTS and INTELIGENTES (DESIGN 6, SPEC 2.11): nested folders and
// playlists with emoji, drag and drop, inline rename, M3U import/export.
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  FileDown,
  FileUp,
  FolderPlus,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Smile,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import { playlistLabel } from "../../lib/playlistIcons";
import { Popover } from "../../components/Popover";
import { formatCount } from "../../lib/format";
import type { PlaylistNode } from "../../lib/rpc.types";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import { playlistApi, usePlaylistMutation, usePlaylistTree } from "./api";
import { canDrop } from "./rules";
import { beginDrag, dropTargetProps, useDragStore } from "./dragStore";
import { EmojiPicker } from "./EmojiPicker";
import { SmartPlaylistDialog } from "./SmartPlaylistDialog";
import { buildTree, isWithin, type TreeNode, zoneFor } from "./tree";

const COLLAPSED_KEY = "tonalia.playlists.collapsed";
const M3U_FILTER = [{ name: "M3U", extensions: ["m3u8", "m3u"] }];

function loadCollapsed(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => typeof x === "number") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<number>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Not persisted; folders still open/close for this session.
  }
}

const ITEM =
  "flex h-[30px] w-full min-w-0 items-center gap-2 rounded-sm pr-1 text-left transition-colors duration-hover";

interface MenuItem {
  label: string;
  icon: typeof Pencil;
  run: () => void;
  danger?: boolean;
}

function Menu({
  anchor,
  label,
  items,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  items: MenuItem[];
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Popover anchor={anchor} label={label} onClose={onClose}>
      {children ?? (
        <div role="menu" aria-label={label} className="-m-1.5 flex min-w-[200px] flex-col">
          {items.map(({ label: text, icon: Icon, run, danger }) => (
            <button
              key={text}
              type="button"
              role="menuitem"
              onClick={run}
              className={`flex h-8 items-center gap-2.5 rounded-sm px-2 text-left hover:bg-surface-3 ${danger ? "text-danger" : "text-text"}`}
            >
              <Icon size={16} strokeWidth={1.5} />
              {text}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function PlaylistSections() {
  const { t, i18n } = useTranslation();
  const flat = usePlaylistTree();
  const view = useViewStore((s) => s.view);
  const openId = useViewStore((s) => s.playlistId);
  const dragging = useDragStore((s) => s.payload);
  const target = useDragStore((s) => s.target);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ node: PlaylistNode; anchor: HTMLElement } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emojiFor, setEmojiFor] = useState<{ node: PlaylistNode; anchor: HTMLElement } | null>(
    null,
  );
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const [smartDialog, setSmartDialog] = useState<{ editing?: PlaylistNode } | null>(null);

  const create = usePlaylistMutation(playlistApi.create);
  const update = usePlaylistMutation(playlistApi.update);
  const remove = usePlaylistMutation(playlistApi.remove);
  const importM3u = usePlaylistMutation(playlistApi.importM3u);
  const exportM3u = usePlaylistMutation(playlistApi.exportM3u);

  const openPlaylist = (id: number) => {
    useLibraryStore.getState().setSelected([]);
    useViewStore.getState().openPlaylist(id);
  };
  const toggleFolder = (id: number, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });

  const createNode = (isFolder: boolean, parentId: number | null = null) => {
    if (parentId != null) toggleFolder(parentId, true);
    create.mutate(
      {
        name: isFolder ? t("playlists.untitledFolder") : t("playlists.untitled"),
        isFolder,
        parentId,
      },
      { onSuccess: (node) => setRenaming(node.id) },
    );
  };

  const runImport = async (parentId: number | null = null) => {
    const picked = await open({
      multiple: false,
      filters: M3U_FILTER,
      title: t("playlists.import"),
    });
    if (typeof picked !== "string") return;
    if (parentId != null) toggleFolder(parentId, true);
    importM3u.mutate(
      { path: picked, parentId },
      {
        onSuccess: (result) => {
          useToastStore.getState().push({
            title: t("playlists.imported", {
              name: result.playlist.name,
              count: result.playlist.trackCount,
            }),
            ...(result.missing.length
              ? { detail: t("playlists.importMissing", { count: result.missing.length }) }
              : {}),
            tone: result.missing.length ? "warning" : "success",
          });
          openPlaylist(result.playlist.id);
        },
      },
    );
  };

  const runExport = async (node: PlaylistNode) => {
    const path = await save({
      defaultPath: `${node.name}.m3u8`,
      filters: M3U_FILTER,
      title: t("playlists.export"),
    });
    if (!path) return;
    exportM3u.mutate(
      { playlistId: node.id, path },
      {
        onSuccess: (result) =>
          useToastStore.getState().push({
            title: t("playlists.exported", { count: result.written }),
            detail: result.path,
            tone: "success",
          }),
      },
    );
  };

  const closeMenu = () => {
    setMenu(null);
    setConfirmDelete(false);
  };

  const commitRename = (node: PlaylistNode, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (name && name !== node.name) update.mutate({ playlistId: node.id, name });
  };

  const deleteNode = (node: PlaylistNode) => {
    closeMenu();
    remove.mutate(
      { playlistId: node.id },
      {
        onSuccess: () => {
          if (openId != null && isWithin(flat, node.id, openId))
            useViewStore.getState().show("library");
        },
      },
    );
  };

  const menuItems = (node: PlaylistNode): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: t("playlists.rename"),
        icon: Pencil,
        run: () => (closeMenu(), setRenaming(node.id)),
      },
      {
        label: t("playlists.changeEmoji"),
        icon: Smile,
        run: () => {
          const anchor = menu?.anchor;
          closeMenu();
          if (anchor) setEmojiFor({ node, anchor });
        },
      },
    ];
    if (node.smart) {
      items.push({
        label: t("playlists.editSmart"),
        icon: WandSparkles,
        run: () => (closeMenu(), setSmartDialog({ editing: node })),
      });
    }
    if (node.isFolder) {
      items.push(
        {
          label: t("playlists.newPlaylistInside"),
          icon: ListPlus,
          run: () => (closeMenu(), createNode(false, node.id)),
        },
        {
          label: t("playlists.newFolderInside"),
          icon: FolderPlus,
          run: () => (closeMenu(), createNode(true, node.id)),
        },
        {
          label: t("playlists.importInside"),
          icon: FileDown,
          run: () => (closeMenu(), void runImport(node.id)),
        },
      );
    } else {
      items.push({
        label: t("playlists.export"),
        icon: FileUp,
        run: () => (closeMenu(), void runExport(node)),
      });
    }
    items.push({
      label: t("playlists.delete"),
      icon: Trash2,
      danger: true,
      run: () => setConfirmDelete(true),
    });
    return items;
  };

  const renderItem = ({ node, depth, children }: TreeNode): ReactNode => {
    const active = view === "playlist" && openId === node.id;
    const expanded = node.isFolder && !collapsed.has(node.id);
    const over =
      dragging &&
      target?.kind === "playlist" &&
      target.id === node.id &&
      canDrop(dragging, target, flat)
        ? target.zone
        : null;
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-expanded={node.isFolder ? expanded : undefined}
        aria-selected={active}
      >
        <div
          {...dropTargetProps(dragging != null, (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            return {
              kind: "playlist",
              id: node.id,
              zone: zoneFor(node.isFolder, e.clientY - rect.top, rect.height),
            };
          })}
          data-drop={over ?? undefined}
          className={`group relative rounded-sm ${over === "inside" ? "bg-primary-soft ring-1 ring-inset ring-primary" : ""}`}
        >
          {over === "before" && (
            <span aria-hidden className="absolute inset-x-1 top-0 h-0.5 rounded-pill bg-primary" />
          )}
          {over === "after" && (
            <span
              aria-hidden
              className="absolute inset-x-1 bottom-0 h-0.5 rounded-pill bg-primary"
            />
          )}
          {renaming === node.id ? (
            <div className={ITEM} style={{ paddingLeft: 8 + depth * 14 }}>
              <PlaylistIcon
                emoji={node.emoji}
                isFolder={node.isFolder}
                open={expanded}
                smart={node.smart != null}
                className={`transition-colors duration-hover ${active ? "text-primary-ink" : "text-text-3 group-hover:text-text-2"}`}
              />
              <input
                autoFocus
                defaultValue={node.name}
                aria-label={t("playlists.name")}
                maxLength={200}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => commitRename(node, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
                className="h-6 min-w-0 flex-1 rounded-[4px] border border-primary bg-surface-3 px-1.5 text-text outline-none"
              />
            </div>
          ) : (
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onPointerDown={(e) =>
                beginDrag(e, () => ({
                  kind: "playlist",
                  id: node.id,
                  label: playlistLabel(node),
                  smart: node.smart != null,
                  isFolder: node.isFolder,
                }))
              }
              onClick={() => (node.isFolder ? toggleFolder(node.id) : openPlaylist(node.id))}
              onDoubleClick={() => setRenaming(node.id)}
              onKeyDown={(e) => {
                if (e.key === "F2") setRenaming(node.id);
                if (node.isFolder && e.key === "ArrowRight") toggleFolder(node.id, true);
                if (node.isFolder && e.key === "ArrowLeft") toggleFolder(node.id, false);
              }}
              className={`${ITEM} ${active ? "bg-primary-soft text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {node.isFolder ? (
                <ChevronRight
                  aria-hidden
                  size={12}
                  strokeWidth={1.5}
                  className={`-ml-1 shrink-0 text-text-3 transition-transform duration-hover ${expanded ? "rotate-90" : ""}`}
                />
              ) : null}
              <PlaylistIcon
                emoji={node.emoji}
                isFolder={node.isFolder}
                open={expanded}
                smart={node.smart != null}
                className={`transition-colors duration-hover ${active ? "text-primary-ink" : "text-text-3 group-hover:text-text-2"}`}
              />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {!node.isFolder && (
                <span className="font-mono text-[11px] text-text-3 tabular group-hover:invisible group-focus-within:invisible">
                  {formatCount(node.trackCount, i18n.language)}
                </span>
              )}
            </button>
          )}
          {renaming !== node.id && (
            <button
              type="button"
              aria-label={t("playlists.actions", { name: node.name })}
              aria-haspopup="menu"
              onClick={(e) => setMenu({ node, anchor: e.currentTarget })}
              className="hit-target absolute right-1 top-[5px] grid size-5 place-items-center rounded-sm text-text-3 opacity-0 hover:bg-surface-3 hover:text-text focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
        {expanded && children.length > 0 && <ul role="group">{children.map(renderItem)}</ul>}
      </li>
    );
  };

  const regular = buildTree(flat, (n) => n.smart == null);
  const smart = buildTree(flat, (n) => n.smart != null);
  const header = (label: string, action: ReactNode) => (
    <div className="flex items-center justify-between px-2 pb-1 pt-4">
      <span className="text-label uppercase text-text-3">{label}</span>
      {action}
    </div>
  );
  const iconButton =
    "hit-target relative grid size-5 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text";

  return (
    <>
      {header(
        t("nav.playlists"),
        <button
          type="button"
          aria-label={t("playlists.add")}
          aria-haspopup="menu"
          onClick={(e) => setAddMenu(e.currentTarget)}
          className={iconButton}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>,
      )}
      {regular.length ? (
        <ul role="tree" aria-label={t("nav.playlists")}>
          {regular.map(renderItem)}
        </ul>
      ) : (
        <p className="px-2 text-[12px] text-text-3">{t("playlists.empty")}</p>
      )}

      {header(
        t("nav.smart"),
        <button
          type="button"
          aria-label={t("playlists.newSmart")}
          onClick={() => setSmartDialog({})}
          className={iconButton}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>,
      )}
      {smart.length ? (
        <ul role="tree" aria-label={t("nav.smart")}>
          {smart.map(renderItem)}
        </ul>
      ) : (
        <p className="px-2 text-[12px] text-text-3">{t("playlists.smartEmpty")}</p>
      )}

      {addMenu && (
        <Menu
          anchor={addMenu}
          label={t("playlists.add")}
          onClose={() => setAddMenu(null)}
          items={[
            {
              label: t("playlists.newPlaylist"),
              icon: ListPlus,
              run: () => (setAddMenu(null), createNode(false)),
            },
            {
              label: t("playlists.newFolder"),
              icon: FolderPlus,
              run: () => (setAddMenu(null), createNode(true)),
            },
            {
              label: t("playlists.newSmart"),
              icon: WandSparkles,
              run: () => (setAddMenu(null), setSmartDialog({})),
            },
            {
              label: t("playlists.import"),
              icon: FileDown,
              run: () => (setAddMenu(null), void runImport()),
            },
          ]}
        />
      )}
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t("playlists.actions", { name: menu.node.name })}
          onClose={closeMenu}
          items={menuItems(menu.node)}
        >
          {confirmDelete ? (
            <div className="flex w-[240px] flex-col gap-3">
              <p className="text-body">
                {t(
                  menu.node.isFolder ? "playlists.confirmDeleteFolder" : "playlists.confirmDelete",
                  { name: menu.node.name },
                )}
              </p>
              <p className="text-[12px] text-text-3">{t("playlists.deleteKeepsFiles")}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeMenu}
                  className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
                >
                  {t("edit.cancel")}
                </button>
                <button
                  type="button"
                  data-autofocus
                  onClick={() => deleteNode(menu.node)}
                  className="h-8 rounded-sm bg-danger-fill px-3 font-semibold text-white"
                >
                  {t("playlists.delete")}
                </button>
              </div>
            </div>
          ) : undefined}
        </Menu>
      )}
      {emojiFor && (
        <EmojiPicker
          anchor={emojiFor.anchor}
          current={emojiFor.node.emoji}
          onClose={() => setEmojiFor(null)}
          onPick={(emoji) => {
            update.mutate({ playlistId: emojiFor.node.id, emoji: emoji ?? "" });
            setEmojiFor(null);
          }}
        />
      )}
      {smartDialog && (
        <SmartPlaylistDialog
          {...(smartDialog.editing ? { editing: smartDialog.editing } : {})}
          onClose={() => setSmartDialog(null)}
          onSaved={(node) => openPlaylist(node.id)}
        />
      )}
    </>
  );
}
