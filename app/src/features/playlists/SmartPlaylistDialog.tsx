import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import type { PlaylistNode, TrackFilter } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import { playlistApi, usePlaylistMutation } from "./api";
import { hasConditions } from "./filter";
import { EmojiPicker } from "./EmojiPicker";
import { FilterFields } from "./FilterFields";

/** Create a smart playlist (`editing` absent) or change one's name, emoji and query. */
export function SmartPlaylistDialog({
  editing,
  initialFilter,
  onClose,
  onSaved,
}: {
  editing?: PlaylistNode;
  /** Conditions to start from (e.g. the library's active filters). */
  initialFilter?: TrackFilter;
  onClose: () => void;
  onSaved?: (node: PlaylistNode) => void;
}) {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const [name, setName] = useState(editing?.name ?? "");
  const [emoji, setEmoji] = useState(editing?.emoji ?? "🔮");
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [filter, setFilter] = useState<TrackFilter>(editing?.smart ?? initialFilter ?? {});
  const create = usePlaylistMutation(playlistApi.create);
  const update = usePlaylistMutation(playlistApi.update);
  const valid = name.trim().length > 0 && hasConditions(filter);
  const pending = create.isPending || update.isPending;

  const save = () => {
    const done = { onSuccess: (node: PlaylistNode) => (onSaved?.(node), onClose()) };
    if (editing) {
      update.mutate(
        { playlistId: editing.id, name: name.trim(), emoji: emoji.trim(), smart: filter },
        done,
      );
    } else {
      create.mutate({ name: name.trim(), emoji: emoji.trim() || null, smart: filter }, done);
    }
  };

  const title = editing ? t("playlists.editSmart") : t("playlists.newSmart");
  return (
    <Modal label={title} onClose={onClose} width={600}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pending) save();
        }}
      >
        <header className="border-b border-border px-5 py-4">
          <h2 className="font-display text-title">{title}</h2>
          <p className="text-body text-text-2">{t("playlists.smartHint")}</p>
        </header>
        <div className="flex min-h-0 flex-col gap-5 overflow-auto px-5 py-4">
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={t("playlists.changeEmoji")}
              aria-haspopup="dialog"
              onClick={(e) => setPicker(e.currentTarget)}
              className="grid h-9 w-12 place-items-center rounded-sm border border-border bg-surface-3 text-text-2 hover:text-text focus:border-primary"
            >
              <PlaylistIcon emoji={emoji} smart size={18} />
            </button>
            {picker && (
              <EmojiPicker
                anchor={picker}
                current={emoji || null}
                onClose={() => setPicker(null)}
                onPick={(picked) => {
                  setEmoji(picked ?? "");
                  setPicker(null);
                }}
              />
            )}
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("playlists.name")}
              placeholder={t("playlists.name")}
              maxLength={200}
              className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-3 text-text outline-none focus:border-primary"
            />
          </div>
          <FilterFields value={filter} onChange={setFilter} notation={notation} showPlaylist />
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {!hasConditions(filter) && (
            <span className="mr-auto text-[12px] text-text-3">{t("playlists.needCondition")}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
          >
            {t("edit.cancel")}
          </button>
          <button
            type="submit"
            disabled={!valid || pending}
            className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("edit.save")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
