// "Mashup favorites" (DESIGN 6.11): a grid of cards with both tracks (overlapping artwork,
// cyan and coral), keys with their shift, the common BPM, editable stars and notes, the
// mode, and ▶ / "Open in decks" / "Export". Sorted by date or rating, with a search.
import { useQueryClient } from "@tanstack/react-query";
import { Artwork } from "../../components/Artwork";
import { trackKey } from "../../lib/keyStyle";
import { ArrowRight, Download, Play, Search, Square, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyChip } from "../../components/KeyChip";
import { Segmented } from "../../components/Segmented";
import { fileStem, formatBpm, formatCount, formatSemitones } from "../../lib/format";
import { formatKey, makeKey, shift as shiftKey } from "../../lib/keys";
import type { Favorite, TrackSummary } from "../../lib/rpc.types";
import { useDecksStore } from "../decks/decksStore";
import { player, usePlaybackStore } from "../decks/syncPlayer";
import { useViewStore } from "../navigation/viewStore";
import { useSettings } from "../settings/api";
import { useToastStore } from "../toast/toastStore";
import { type FavoriteSort, saveParamsOf, useFavoriteActions, useFavorites } from "./api";
import { useFavoritesStore } from "./favoritesStore";
import { playFavorite } from "./play";
import { Stars } from "./Stars";
import { errorMessage } from "../../lib/errors";
import { EmptyState } from "../../components/EmptyState";

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const titleOf = (t: TrackSummary) => t.title ?? fileStem(t.path);

function matches(f: Favorite, query: string): boolean {
  if (!query) return true;
  const text = fold(
    [titleOf(f.a), f.a.artist, titleOf(f.b), f.b.artist, f.notes].filter(Boolean).join(" "),
  );
  return fold(query)
    .split(/\s+/)
    .every((word) => text.includes(word));
}

function DeckLine({
  track,
  shift,
  stem,
  side,
}: {
  track: TrackSummary;
  shift: number;
  stem: string;
  side: "a" | "b";
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const key = track.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-pill"
        style={{ backgroundColor: `var(--color-deck-${side})` }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-control font-medium" title={titleOf(track)}>
          {titleOf(track)}
        </span>
        <span className="truncate text-[12px] text-text-2">
          {track.artist ?? t("library.unknownArtist")}
        </span>
      </div>
      {stem !== "mix" && (
        <span
          className="rounded-pill px-2 text-[11px]"
          style={{
            color: `var(--color-stem-${stem})`,
            backgroundColor: `color-mix(in srgb, var(--color-stem-${stem}) 16%, transparent)`,
          }}
        >
          {t(`pro.stems.${stem}`)}
        </span>
      )}
      {key && (
        <span className="flex shrink-0 items-center gap-1">
          {/* "8A → 10A +2 st" as on the decks; the original stays plain text to fit a card. */}
          {shift !== 0 && (
            <>
              <span className="font-mono text-[11px] text-text-3">
                {formatKey(key, settings.notation)}
              </span>
              <ArrowRight
                aria-label={t("tags.becomes")}
                size={11}
                strokeWidth={1.5}
                className="text-text-3"
              />
            </>
          )}
          <KeyChip musicalKey={shift ? shiftKey(key, shift) : key} notation={settings.notation} />
          {shift !== 0 && (
            <span className="font-mono text-[11px] text-text-2">
              {t("pro.semitones", { value: formatSemitones(shift) })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function DeckArtwork({ track, side }: { track: TrackSummary; side: "a" | "b" }) {
  const style = { borderColor: `var(--color-deck-${side})` };
  return (
    <Artwork
      path={track.artworkPath}
      musicalKey={trackKey(track)}
      size={48}
      className="size-12 rounded-sm border-2"
      style={style}
    />
  );
}

/** Notes saved when the field loses focus (re-mounted when the saved notes change). */
function Notes({
  saved,
  onSave,
}: {
  saved: string | null;
  onSave: (notes: string | null) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(saved ?? "");
  return (
    <textarea
      aria-label={t("favorites.notes")}
      placeholder={t("favorites.notesPlaceholder")}
      value={notes}
      maxLength={2000}
      rows={2}
      onChange={(e) => setNotes(e.target.value)}
      onBlur={() => {
        const value = notes.trim() || null;
        if (value !== (saved ?? null)) onSave(value);
      }}
      className="resize-none rounded-sm border border-border bg-surface-3 px-2 py-1.5 text-body placeholder:text-text-3"
    />
  );
}

function FavoriteCard({ favorite: f }: { favorite: Favorite }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const qc = useQueryClient();
  const actions = useFavoriteActions();
  const push = useToastStore((s) => s.push);
  const playingId = useFavoritesStore((s) => s.playing);
  const status = usePlaybackStore((s) => s.status);
  const playing = playingId === f.id && status !== "idle";
  const label = `${titleOf(f.a)} + ${titleOf(f.b)}`;

  const play = () => {
    if (playing) {
      player.stop();
      return;
    }
    useFavoritesStore.getState().setPlaying(f.id);
    playFavorite(f, qc).catch((err: unknown) =>
      push({
        title: t("pro.playFailed", { error: errorMessage(err) }),
        tone: "danger",
      }),
    );
  };
  const open = () => {
    player.stop();
    useDecksStore.getState().openFavorite(f);
    useViewStore.getState().show("pro");
  };
  const remove = async () => {
    if (playing) player.stop();
    if (!(await actions.remove(f.id))) return;
    push({
      title: t("favorites.removed"),
      tone: "neutral",
      action: { label: t("favorites.undo"), run: () => void actions.save(saveParamsOf(f)) },
    });
  };

  return (
    <article
      aria-label={label}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-2 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex shrink-0">
          <DeckArtwork track={f.a} side="a" />
          <div className="-ml-4 mt-2">
            <DeckArtwork track={f.b} side="b" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <span className="rounded-pill border border-border bg-surface-3 px-2 text-[11px] text-text-2">
            {t(`pro.modes.${f.mode}`)}
          </span>
          {f.a.bpm != null && (
            <span className="font-mono text-[12px] text-text-2">
              {t("favorites.bpm", { bpm: formatBpm(f.a.bpm, settings.bpmDecimals) })}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t("favorites.remove")}
          title={t("favorites.remove")}
          onClick={() => void remove()}
          className="grid size-7 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-danger"
        >
          <Trash2 aria-hidden size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <DeckLine track={f.a} shift={f.shiftA ?? 0} stem={f.stemA ?? "mix"} side="a" />
        <DeckLine track={f.b} shift={f.shiftB ?? 0} stem={f.stemB ?? "mix"} side="b" />
      </div>
      <Stars
        value={f.rating}
        onChange={(rating) => void actions.update({ favoriteId: f.id, rating })}
      />
      <Notes
        key={f.notes ?? ""}
        saved={f.notes}
        onSave={(value) => void actions.update({ favoriteId: f.id, notes: value })}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={t(playing ? "favorites.stop" : "favorites.play")}
          onClick={play}
          className="grid size-8 place-items-center rounded-pill bg-accent-fill text-white"
        >
          {playing ? (
            <Square aria-hidden size={12} strokeWidth={1.5} fill="currentColor" />
          ) : (
            <Play aria-hidden size={14} strokeWidth={1.5} />
          )}
        </button>
        <button type="button" onClick={open} className={BUTTON}>
          {t("favorites.open")}
        </button>
        <button
          type="button"
          onClick={() =>
            useFavoritesStore.getState().openExport({ ...saveParamsOf(f), bpmA: f.a.bpm })
          }
          className={BUTTON}
        >
          <Download aria-hidden size={14} strokeWidth={1.5} />
          {t("favorites.export")}
        </button>
      </div>
    </article>
  );
}

export function FavoritesView() {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<FavoriteSort>("date");
  const [query, setQuery] = useState("");
  const favorites = useFavorites(sort);
  const items = useMemo(
    () => (favorites.data ?? []).filter((f) => matches(f, query.trim())),
    [favorites.data, query],
  );
  const total = favorites.data?.length ?? 0;

  // Whatever a card plays stops when leaving the screen.
  useEffect(
    () => () => {
      if (useFavoritesStore.getState().playing != null) player.stop();
      useFavoritesStore.getState().setPlaying(null);
    },
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("favorites.title")}</h1>
        <span className="text-text-3">
          {t("favorites.count", { count: total, formatted: formatCount(total, i18n.language) })}
        </span>
        <div className="flex-1" />
        <Segmented
          value={sort}
          options={(["date", "rating"] as const).map((v) => ({
            value: v,
            label: t(`favorites.sort.${v}`),
          }))}
          onChange={setSort}
          label={t("favorites.sortLabel")}
        />
        <label className="flex h-8 w-60 items-center gap-2 rounded-sm border border-border bg-surface-3 px-2">
          <Search aria-hidden size={14} strokeWidth={1.5} className="text-text-3" />
          <input
            type="search"
            aria-label={t("favorites.search")}
            placeholder={t("favorites.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-control outline-none placeholder:text-text-3"
          />
        </label>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {favorites.isPending ? (
          <p className="text-text-3">{t("detail.loading")}</p>
        ) : total === 0 ? (
          <EmptyState
            icon={Star}
            title={t("favorites.empty")}
            text={t("favorites.emptyHint")}
            action={
              <button
                type="button"
                onClick={() => useViewStore.getState().show("pro")}
                className="h-[30px] rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
              >
                {t("favorites.goToPro")}
              </button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={Search}
            title={t("favorites.noMatch")}
            action={
              <button
                type="button"
                onClick={() => setQuery("")}
                className="h-[30px] rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
              >
                {t("library.clearSearch")}
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {items.map((f) => (
              <FavoriteCard key={f.id} favorite={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
