import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import { Popover } from "../../components/Popover";
import { PLAYLIST_ICONS } from "../../lib/playlistIcons";

/** Graphemes in `text` (an emoji with modifiers counts as one). */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Segmenter) return [...text];
  return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    (s) => s.segment,
  );
}

export function EmojiPicker({
  anchor,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  current: string | null;
  /** `null` removes the emoji. */
  onPick: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");
  const typed = graphemes(custom.trim())[0];
  return (
    <Popover anchor={anchor} label={t("playlists.emoji")} onClose={onClose}>
      <div className="flex w-[300px] flex-col gap-2.5">
        <div className="grid grid-cols-8 gap-1" role="group" aria-label={t("playlists.emoji")}>
          {PLAYLIST_ICONS.map(([emoji]) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              title={emoji}
              aria-pressed={current === emoji}
              data-autofocus={current === emoji || undefined}
              onClick={() => onPick(emoji)}
              className={`grid size-8 place-items-center rounded-sm hover:bg-surface-3 hover:text-text ${current === emoji ? "bg-primary-soft text-primary-ink" : "text-text-2"}`}
            >
              <PlaylistIcon emoji={emoji} size={17} />
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed) onPick(typed);
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t("playlists.emojiCustom")}
            aria-label={t("playlists.emojiCustom")}
            className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-2 text-text outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!typed}
            className="h-8 rounded-sm bg-primary px-3 font-semibold text-white disabled:opacity-40"
          >
            {t("playlists.use")}
          </button>
        </form>
        {current && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="h-8 self-start rounded-sm px-2 text-text-2 hover:bg-surface-3 hover:text-text"
          >
            {t("playlists.removeEmoji")}
          </button>
        )}
      </div>
    </Popover>
  );
}
