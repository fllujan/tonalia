// Playlist icons: playlists keep an emoji (SPEC 2.11; it is what the database, M3U names and
// other apps see), but the curated ones are drawn as line icons so the sidebar reads as one
// family (DESIGN 4: Lucide, 1.5 px stroke). An emoji typed by hand is shown as it is.
import { createElement } from "react";
import { FolderClosed, FolderOpen, ListMusic, WandSparkles } from "lucide-react";
import { iconFor } from "../lib/playlistIcons";

export function PlaylistIcon({
  emoji,
  isFolder = false,
  open = false,
  smart = false,
  size = 16,
  className = "",
}: {
  emoji: string | null | undefined;
  isFolder?: boolean;
  /** An open folder shows an open folder icon. */
  open?: boolean;
  smart?: boolean;
  size?: number;
  className?: string;
}) {
  let Icon = iconFor(emoji);
  if (emoji && !Icon)
    return (
      <span
        aria-hidden
        className={`inline-grid shrink-0 place-items-center leading-none ${className}`}
        style={{ width: size + 2, fontSize: size - 2 }}
      >
        {emoji}
      </span>
    );
  if (isFolder && (!Icon || Icon === FolderClosed)) Icon = open ? FolderOpen : FolderClosed;
  Icon ??= smart ? WandSparkles : ListMusic;
  return (
    <span
      aria-hidden
      data-icon={Icon.displayName}
      className={`inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size + 2 }}
    >
      {createElement(Icon, { size, strokeWidth: 1.5 })}
    </span>
  );
}
