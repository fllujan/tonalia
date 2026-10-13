// Pro mode studio (SPEC 2.15, DESIGN 6.9 and 6.10): deck A with the chosen track, deck B
// with the best idea for it (◀ ▶ walk the ideas, with score and reasons), the Mashup ↔
// DJ Mix switch, the idea filter, the key change of each deck, saving the combination as
// a favorite (or exporting it), and the full list of ideas. A favorite opened here pins its
// B on deck B until the arrows go back to the ideas.
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  Loader2,
  Play,
  Repeat,
  SlidersHorizontal,
  Square,
  Star,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "../../components/Popover";
import { Segmented } from "../../components/Segmented";
import { compatibility, type Key, makeKey, shift as shiftKey } from "../../lib/keys";
import type {
  FavoriteSaveParams,
  SuggestParams,
  Suggestion,
  TrackDetail,
} from "../../lib/rpc.types";
import { sameCombination, useFavoriteActions, useFavorites } from "../favorites/api";
import { useFavoritesStore } from "../favorites/favoritesStore";
import { Stars } from "../favorites/Stars";
import { useViewStore } from "../navigation/viewStore";
import { AddToPlaylist } from "../playlists/AddToPlaylist";
import { useToastStore } from "../toast/toastStore";
import { IdeaFilter } from "../suggestions/IdeaFilter";
import { GuideLink } from "../guides/GuideLink";
import { IdeaList } from "../suggestions/IdeaList";
import { reasonText } from "../suggestions/reasons";
import { ScrollArea } from "../../components/ScrollArea";
import { ScoreRing } from "../suggestions/ScoreRing";
import { deckFocus } from "./transition";
import { TransitionLane } from "./TransitionLane";
import { useSuggestions } from "../suggestions/api";
import { useTrackDetail } from "../track-detail/api";
import { Deck, type DeckChange, type DeckPitch } from "./Deck";
import { activeFilters, type PinnedB, type ProMode, useDecksStore } from "./decksStore";
import { adjustReasons, clampShift, deckBShift, rescore, SHIFT_LIMIT } from "./pitch";
import { CROSSFADE_BARS, type CrossfadeBars, type LoopLength } from "./segments";
import { player, usePlaybackStore } from "./syncPlayer";
import { TrackPicker } from "./TrackPicker";
import { directionUnmet } from "./direction";
import { useStudio } from "./useStudio";
import { errorMessage } from "../../lib/errors";
import { ownsKey } from "../../lib/keyboard";
import { EmptyState } from "../../components/EmptyState";
import { inkOf } from "../../lib/keyStyle";

const IDEAS = 100;
/** The loop E / I switch on: four bars, the usual phrase to try a mashup over. */
const SHORTCUT_LOOP: LoopLength = 4;
const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong";

function ChangeTrack() {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-expanded={anchor != null}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={BUTTON}
      >
        <Repeat size={14} strokeWidth={1.5} />
        {t("pro.changeTrack")}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={t("pro.changeTrack")} onClose={() => setAnchor(null)}>
          <div className="w-[480px] p-3">
            <TrackPicker
              autoFocus
              onPick={(id) => {
                useDecksStore.getState().loadA(id);
                setAnchor(null);
              }}
            />
          </div>
        </Popover>
      )}
    </>
  );
}

function IdeaNav({
  index,
  total,
  idea,
  score,
  pinned = false,
}: {
  index: number;
  total: number;
  idea: Suggestion | undefined;
  /** The idea's score with B's manual key change (the idea's own score otherwise). */
  score?: number | undefined;
  /** Deck B comes from a favorite: "next" goes to the first idea. */
  pinned?: boolean;
}) {
  const { t } = useTranslation();
  const setIdea = useDecksStore.getState().setIdea;
  if (pinned)
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t("pro.previousIdea")}
          disabled
          className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <span className="flex min-w-[96px] items-center justify-center gap-1 text-label uppercase text-accent">
          <Star aria-hidden size={12} strokeWidth={1.5} className="fill-accent" />
          {t("pro.favoriteIdea")}
        </span>
        <button
          type="button"
          aria-label={t("pro.nextIdea")}
          disabled={total === 0}
          onClick={() => setIdea(0)}
          className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={t("pro.previousIdea")}
        disabled={index <= 0}
        onClick={() => setIdea(index - 1)}
        className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
      >
        <ChevronLeft size={16} strokeWidth={1.5} />
      </button>
      <span
        aria-live="polite"
        className="min-w-[96px] text-center text-label uppercase text-text-2"
      >
        {t("pro.ideaCount", { n: index + 1, total })}
      </span>
      <button
        type="button"
        aria-label={t("pro.nextIdea")}
        disabled={index >= total - 1}
        onClick={() => setIdea(index + 1)}
        className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
      {idea && (
        <ScoreRing
          score={score ?? idea.score}
          from={idea.score}
          label={
            score != null && score !== idea.score
              ? t("pro.scoreChanged", { score, from: idea.score })
              : t("pro.score", { score: idea.score })
          }
        />
      )}
    </div>
  );
}

/** Deck B of a favorite as an idea: its key relation and shift, without a score. */
function pinnedIdea(
  pinned: PinnedB | null,
  detail: TrackDetail | undefined,
  keyA: Key | null,
): Suggestion | undefined {
  if (!pinned || !detail || detail.id !== pinned.trackId) return undefined;
  const original =
    detail.keyRoot != null && detail.keyMode ? makeKey(detail.keyRoot, detail.keyMode) : null;
  const keyB = original ? shiftKey(original, pinned.shiftB) : makeKey(0, "major");
  const relation = keyA && original ? compatibility(keyA, keyB).relation : "none";
  return {
    track: detail,
    score: 0,
    shiftB: pinned.shiftB,
    keyB: { root: keyB.root, mode: keyB.mode },
    relation,
    bpmFactor: pinned.bpmFactor,
    scores: { key: 0, bpm: 0, energy: 0, vocal: 0, genre: 0 },
    reasons: [
      { kind: "key", code: relation },
      ...(pinned.shiftB ? [{ kind: "shift" as const, code: "b", value: pinned.shiftB }] : []),
    ],
  };
}

function Studio({ trackA }: { trackA: number }) {
  const { t, i18n } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const filters = useDecksStore((s) => s.filters);
  const allowShift = useDecksStore((s) => s.allowShift);
  const direction = useDecksStore((s) => s.energyDirection);
  const idea = useDecksStore((s) => s.idea);
  const shifts = useDecksStore((s) => s.shifts);
  const history = useDecksStore((s) => s.history);
  const setShift = useDecksStore((s) => s.setShift);
  const a = useTrackDetail(trackA).data;
  const analysed = a != null && a.keyRoot != null && a.bpm != null;

  const params: SuggestParams | null = useMemo(
    () =>
      analysed
        ? {
            trackId: trackA,
            shiftA: shifts.a,
            allowShift,
            filters,
            limit: IDEAS,
            ...(history.length ? { exclude: history } : {}),
            ...(mode === "mix" ? { energyDirection: direction } : {}),
          }
        : null,
    [analysed, trackA, shifts.a, allowShift, filters, mode, direction, history],
  );
  const ideas = useSuggestions(mode, params);
  const items = useMemo(() => ideas.data?.items ?? [], [ideas.data]);
  const index = Math.min(idea, Math.max(0, items.length - 1));
  const pinned = useDecksStore((s) => s.pinnedB);
  const pinnedDetail = useTrackDetail(pinned?.trackId ?? -1, pinned != null).data;
  const keyAOriginal = a?.keyRoot != null && a.keyMode ? makeKey(a.keyRoot, a.keyMode) : null;
  const pinnedB = pinnedIdea(
    pinned,
    pinnedDetail,
    keyAOriginal ? shiftKey(keyAOriginal, shifts.a) : null,
  );
  const current = pinned ? pinnedB : items[index];
  const next = pinned ? items[0] : items[index + 1];

  // A new key for A keeps B on the same track when the new ideas still include it.
  const keepB = useDecksStore((s) => s.keepB);
  const fresh = ideas.data != null && !ideas.isPlaceholderData;
  useEffect(() => {
    if (keepB == null || !fresh) return;
    const found = items.findIndex((i) => i.track.id === keepB);
    useDecksStore.getState().settleIdea(Math.max(0, found));
  }, [keepB, fresh, items]);
  const shownB = keepB == null ? (current?.track.id ?? null) : null;
  useEffect(() => {
    if (shownB != null) useDecksStore.getState().setShownB(shownB);
  }, [shownB]);

  const keyA = keyAOriginal;
  const changeA: DeckChange | null =
    keyA && shifts.a !== 0
      ? { shift: shifts.a, key: shiftKey(keyA, shifts.a), bpm: null, factor: 1 }
      : null;
  const pitchA: DeckPitch = {
    value: shifts.a,
    min: -SHIFT_LIMIT,
    max: SHIFT_LIMIT,
    resettable: shifts.a !== 0,
    onChange: (value) => setShift("a", clampShift(value)),
    onReset: () => setShift("a", 0),
  };

  // B: the idea's shift plus the user's own change (the idea's key is already shifted).
  const shiftB = current ? deckBShift(current.shiftB, shifts.b) : 0;
  const ideaKeyB = current ? makeKey(current.keyB.root, current.keyB.mode) : null;
  const change: DeckChange | null =
    current && ideaKeyB && a?.bpm != null
      ? {
          shift: shiftB,
          key: shiftKey(ideaKeyB, shiftB - current.shiftB),
          bpm: a.bpm / current.bpmFactor,
          factor: current.bpmFactor,
        }
      : null;
  const pitchB: DeckPitch | undefined = current
    ? {
        value: shiftB,
        min: -SHIFT_LIMIT,
        max: SHIFT_LIMIT,
        resettable: shiftB !== current.shiftB,
        onChange: (value) => setShift("b", clampShift(value) - current.shiftB),
        onReset: () => setShift("b", 0),
      }
    : undefined;
  const reasons =
    current && keyA && ideaKeyB
      ? adjustReasons(
          current.reasons,
          shiftKey(keyA, shifts.a),
          shiftKey(ideaKeyB, -current.shiftB),
          shiftB,
          current.shiftB,
        )
      : [];
  // The score follows B's manual key change too (only the key part and the shift cost move).
  const score =
    current && keyA && ideaKeyB && ideas.data && !pinned
      ? rescore(
          current,
          shiftKey(keyA, shifts.a),
          shiftKey(ideaKeyB, -current.shiftB),
          shiftB,
          ideas.data,
        )
      : undefined;
  const studio = useStudio(trackA, current, next, changeA, change);
  const focus = studio.mix ? deckFocus(studio.mix) : null;

  // Shortcuts: space tries the mashup/mix (or stops it), ← → move through the ideas,
  // Q W / O P change each deck's key, E / I loop it, ⇧← ⇧→ move the crossfader and
  // M moves B to A (DJ Mix). Left hand for deck A, right hand for deck B.
  const live = {
    studio,
    mode,
    index,
    total: items.length,
    pinned: pinned != null,
    pitchA: a ? pitchA : undefined,
    pitchB,
    hasB: current != null,
    moveB: current ? { trackId: current.track.id, shift: shiftB } : null,
  };
  const keys = useRef(live);
  useEffect(() => {
    keys.current = live;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ownsKey(e)) return;
      const k = keys.current;
      const { setIdea } = useDecksStore.getState();
      if (e.key === " ") {
        e.preventDefault();
        if (usePlaybackStore.getState().status !== "idle") player.stop();
        else if (k.mode === "mashup") k.studio.tryMashup();
        else k.studio.tryMix();
      } else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const step = e.key === "ArrowRight" ? 0.1 : -0.1;
        const value = usePlaybackStore.getState().crossfader + step;
        player.setCrossfader(Math.round(value * 10) / 10);
      } else if (e.key === "ArrowRight" && k.total > 0) {
        e.preventDefault();
        setIdea(k.pinned ? 0 : Math.min(k.total - 1, k.index + 1));
      } else if (e.key === "ArrowLeft" && !k.pinned && k.index > 0) {
        e.preventDefault();
        setIdea(k.index - 1);
      } else if (!e.shiftKey) {
        const key = e.key.toLowerCase();
        const pitch = { q: [k.pitchA, -1], w: [k.pitchA, 1], o: [k.pitchB, -1], p: [k.pitchB, 1] }[
          key
        ] as [DeckPitch | undefined, number] | undefined;
        if (pitch?.[0]) {
          const [deck, step] = pitch;
          const value = deck.value + step;
          if (value >= deck.min && value <= deck.max) deck.onChange(value);
          e.preventDefault();
        } else if ((key === "e" && k.pitchA) || (key === "i" && k.hasB)) {
          const side = key === "e" ? "a" : "b";
          const { loops, setLoop } = useDecksStore.getState();
          setLoop(side, loops[side] == null ? SHORTCUT_LOOP : null);
          e.preventDefault();
        } else if (key === "m" && k.mode === "mix" && k.moveB) {
          const { stems, moveBToA } = useDecksStore.getState();
          moveBToA(k.moveB.trackId, k.moveB.shift, stems.b);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const stems = useDecksStore((s) => s.stems);
  const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;
  const combination: FavoriteSaveParams | null =
    current && studio.actionsA && studio.actionsB
      ? {
          trackA,
          trackB: current.track.id,
          mode,
          shiftA: shifts.a,
          shiftB,
          cueA: ms(studio.actionsA.anchor),
          cueB: ms(studio.actionsB.anchor),
          stemA: stems.a,
          stemB: stems.b,
          bpmFactor: current.bpmFactor,
        }
      : null;

  const deckB = !a ? null : pinned && !current ? (
    <Placeholder busy>{t("detail.loading")}</Placeholder>
  ) : !analysed ? (
    <Placeholder>{t("pro.notAnalysed")}</Placeholder>
  ) : ideas.isError ? (
    <Placeholder>
      {t("pro.ideasFailed", {
        error: errorMessage(ideas.error),
      })}
    </Placeholder>
  ) : ideas.isPending ? (
    <Placeholder busy>{t("pro.searching")}</Placeholder>
  ) : !current ? (
    <Placeholder>
      <span>{t("pro.noIdeas")}</span>
      {activeFilters(filters, allowShift) > 0 && (
        <button type="button" onClick={useDecksStore.getState().clearFilters} className={BUTTON}>
          {t("filters.clearAll")}
        </button>
      )}
    </Placeholder>
  ) : (
    <Deck
      key={current.track.id}
      side="b"
      trackId={current.track.id}
      change={change}
      {...(pitchB ? { pitch: pitchB } : {})}
      focus={focus?.b ?? null}
      {...(studio.actionsB ? { actions: studio.actionsB } : {})}
      header={
        <IdeaNav
          index={index}
          total={items.length}
          idea={current}
          score={score}
          pinned={pinned != null}
        />
      }
    />
  );

  const unmetDirection = directionUnmet(mode, direction, a?.energy ?? null, items);
  const energyStep =
    mode === "mix" && current && a?.energy != null && current.track.energy != null
      ? { from: a.energy, to: current.track.energy }
      : null;

  const why = current ? (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 self-start pt-1 text-label uppercase text-text-3">
        {t("pro.why")}
      </span>
      <ul aria-label={t("pro.why")} className="flex min-w-0 flex-wrap gap-1.5">
        {reasons.map((r) => (
          <li
            key={`${r.kind}-${r.code}`}
            className="flex h-6 shrink-0 items-center whitespace-nowrap rounded-pill border border-border bg-surface-3 px-2.5 text-[12px]"
          >
            {reasonText(t, r, i18n.language)}
          </li>
        ))}
        <li className="flex">
          <GuideLink guide="harmonic" />
        </li>
      </ul>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Near the minimum height the ideas keep at least three rows and the decks above
          scroll on their own (a shade says there is more): the window itself never does,
          and the reasons and actions below stay in view (DESIGN, Layout). */}
      <ScrollArea frameClassName="shrink" className="min-h-0 overflow-y-auto">
        <div className="grid shrink-0 grid-cols-2 gap-4 px-5 pt-4 short:pt-3">
          <Deck
            key={trackA}
            side="a"
            trackId={trackA}
            header={<ChangeTrack />}
            change={changeA}
            pitch={pitchA}
            focus={focus?.a ?? null}
            {...(studio.actionsA ? { actions: studio.actionsA } : {})}
          />
          {deckB}
        </div>
      </ScrollArea>
      {/* The transport stays out of the scrolling decks: DJ Mix's transition diagram is
          that mode's main picture and must never be cut by the scroll edge. In Mashup its
          middle, empty otherwise, carries the reasons (one row less). */}
      <Transport
        ready={studio.ready}
        onTryMashup={studio.tryMashup}
        onTryMix={studio.tryMix}
        lane={
          studio.mix && current ? (
            <TransitionLane
              line={studio.mix}
              trackA={trackA}
              trackB={current.track.id}
              energyStep={energyStep}
            />
          ) : mode === "mashup" ? (
            why
          ) : null
        }
      />
      {/* Outside the scrolling decks, so the actions (and DJ Mix's reasons) never leave the
          view. The reasons wrap to a second line rather than being cut. */}
      <div className="flex min-h-12 shrink-0 items-center gap-2 px-5 py-2.5 short:py-2">
        {mode === "mix" && why ? why : <span className="flex-1" />}
        {combination && (
          <div className="shrink-0">
            <ComboActions combination={combination} bpmA={a?.bpm ?? null} />
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="flex min-h-[172px] flex-1 flex-col border-t border-border">
          <div className="flex h-9 shrink-0 items-center gap-3 px-5 text-label uppercase text-text-3">
            <span>{t("pro.ideas")}</span>
            {/* DJ Mix asked to raise, keep or lower the energy, and no idea does: say so
                rather than let the best mixes look like the engine ignored the request. */}
            {unmetDirection && (
              <span className="flex min-w-0 items-center gap-1.5 truncate normal-case tracking-normal text-warning">
                <TriangleAlert aria-hidden size={12} strokeWidth={1.5} className="shrink-0" />
                {t(`pro.directionUnmet.${unmetDirection}`)}
              </span>
            )}
            <span className="flex-1" />
            {ideas.data && (
              <span
                className="normal-case tracking-normal"
                title={`${Math.round(ideas.data.elapsedMs)} ms`}
              >
                {t("pro.candidates", {
                  count: ideas.data.candidates,
                  ms: Math.round(ideas.data.elapsedMs),
                })}
              </span>
            )}
          </div>
          {/* A favorite's B is none of the ideas: nothing is selected until one is picked. */}
          <IdeaList
            items={items}
            current={pinned ? -1 : index}
            currentScore={score}
            currentReasons={pinned ? undefined : reasons}
            onPick={useDecksStore.getState().setIdea}
          />
        </div>
      )}
    </div>
  );
}

/**
 * "Save favorite" (then its stars), "Export stems", "Add to playlist" (A then B: a playlist
 * never repeats a track, so moving B to A and adding again builds the set in order) and, in
 * DJ Mix, "Move B → A".
 */
function ComboActions({
  combination,
  bpmA,
}: {
  combination: FavoriteSaveParams;
  bpmA: number | null;
}) {
  const { t } = useTranslation();
  const favorites = useFavorites().data ?? [];
  const actions = useFavoriteActions();
  const push = useToastStore((s) => s.push);
  const saved = favorites.find((f) => sameCombination(f, combination));
  // Counts the saves made here, so the star pops on each one but not when an already
  // saved combination is loaded.
  const [saves, setSaves] = useState(0);
  const save = async () => {
    try {
      // Saving again updates the cues and keeps the rating and the notes.
      await actions.save({ ...combination, rating: saved?.rating ?? 0 });
      setSaves((n) => n + 1);
      push({
        title: t("favorites.saved"),
        tone: "success",
        action: {
          label: t("favorites.view"),
          run: () => useViewStore.getState().show("favorites"),
        },
        leadsTo: "favorites",
      });
    } catch (err) {
      push({
        title: t("favorites.saveFailed", {
          error: errorMessage(err),
        }),
        tone: "danger",
      });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void save()}
        className={`${BUTTON} ${saved ? "text-accent" : ""}`}
      >
        <Star
          key={saves}
          aria-hidden
          size={14}
          strokeWidth={1.5}
          className={`${saved ? "fill-accent text-accent" : "text-accent"} ${saves ? "motion-safe:animate-[star-pop_220ms_var(--ease-out)]" : ""}`}
        />
        {t(saved ? "favorites.inFavorites" : "favorites.save")}
      </button>
      {saved && (
        <Stars
          value={saved.rating}
          onChange={(rating) => void actions.update({ favoriteId: saved.id, rating })}
        />
      )}
      <button
        type="button"
        onClick={() => useFavoritesStore.getState().openExport({ ...combination, bpmA })}
        className={BUTTON}
      >
        <Download aria-hidden size={14} strokeWidth={1.5} />
        {t("favorites.exportStems")}
      </button>
      <AddToPlaylist trackIds={[combination.trackA, combination.trackB]} />
      {combination.mode === "mix" && (
        <button
          type="button"
          onClick={() =>
            useDecksStore
              .getState()
              .moveBToA(combination.trackB, combination.shiftB ?? 0, combination.stemB ?? "mix")
          }
          aria-keyshortcuts="M"
          title={t("pro.moveBToAHint")}
          className={BUTTON}
        >
          <ArrowLeftRight aria-hidden size={14} strokeWidth={1.5} />
          {t("pro.moveBToA")}
        </button>
      )}
    </div>
  );
}

function Transport({
  ready,
  onTryMashup,
  onTryMix,
  lane,
}: {
  ready: boolean;
  onTryMashup: () => void;
  onTryMix: () => void;
  /** The middle of the strip: DJ Mix's transition lane, or Mashup's reasons. */
  lane: React.ReactNode;
}) {
  const { t } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const crossfadeBars = useDecksStore((s) => s.crossfadeBars);
  const status = usePlaybackStore((s) => s.status);
  const kind = usePlaybackStore((s) => s.kind);
  const crossfader = usePlaybackStore((s) => s.crossfader);
  const error = usePlaybackStore((s) => s.error);
  const busy = status !== "idle" && (kind === "mashup" || kind === "mix");
  const label = mode === "mashup" ? t("pro.tryMashup") : t("pro.tryMix");
  return (
    <div className="mx-5 mt-3 flex shrink-0 flex-wrap items-center gap-4 rounded-md border border-border bg-surface-1 px-4 py-2.5 short:mt-2 short:py-1.5">
      <div className={mode === "mix" ? "flex shrink-0 flex-col gap-2" : "contents"}>
        {mode === "mix" && (
          <Segmented
            size="sm"
            label={t("pro.crossfadeLength")}
            value={String(crossfadeBars)}
            onChange={(v) => useDecksStore.getState().setCrossfadeBars(Number(v) as CrossfadeBars)}
            options={CROSSFADE_BARS.map((bars) => ({
              value: String(bars),
              label: t("pro.bars", { count: bars }),
            }))}
          />
        )}
        <label className="flex items-center gap-2 font-mono text-[12px]">
          <span style={{ color: inkOf("var(--color-deck-a)") }}>A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={crossfader}
            onChange={(e) => player.setCrossfader(Number(e.target.value))}
            onDoubleClick={() => player.setCrossfader(0.5)}
            aria-label={t("pro.crossfader")}
            className="crossfader w-44"
          />
          <span style={{ color: inkOf("var(--color-deck-b)") }}>B</span>
        </label>
      </div>
      {lane ?? <div className="flex-1" />}
      {status === "loading" && busy && (
        <span role="status" className="flex items-center gap-1.5 text-[12px] text-text-2">
          <Loader2 aria-hidden size={14} strokeWidth={1.5} className="animate-spin" />
          {t("pro.preparing")}
        </span>
      )}
      {error && (
        <span
          role="alert"
          className="max-w-[360px] truncate text-[12px] text-warning"
          title={error}
        >
          {t("pro.playFailed", { error })}
        </span>
      )}
      {busy ? (
        <button type="button" onClick={() => player.stop()} className={BUTTON}>
          <Square size={12} strokeWidth={1.5} fill="currentColor" />
          {t("pro.stopAll")}
        </button>
      ) : (
        <button
          type="button"
          disabled={!ready}
          onClick={mode === "mashup" ? onTryMashup : onTryMix}
          className="flex h-9 items-center gap-2 rounded-pill bg-aurora px-5 font-semibold uppercase tracking-[0.04em] text-white shadow-overlay transition-opacity duration-hover hover:opacity-90 disabled:opacity-40"
        >
          <Play size={14} strokeWidth={2} fill="currentColor" />
          {label}
        </button>
      )}
    </div>
  );
}

function Placeholder({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div
      aria-busy={busy || undefined}
      className="relative flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-2 p-4 text-center text-text-3"
    >
      <span aria-hidden className="absolute inset-x-4 top-[-1px] h-0.5 rounded-b-pill bg-deck-b" />
      {children}
    </div>
  );
}

export function ProView() {
  const { t } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const trackA = useDecksStore((s) => s.trackA);
  const filtersOpen = useDecksStore((s) => s.filtersOpen);
  const count = activeFilters(
    useDecksStore((s) => s.filters),
    useDecksStore((s) => s.allowShift),
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("pro.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("pro.title")}</h1>
        <Segmented<ProMode>
          label={t("pro.mode")}
          value={mode}
          onChange={useDecksStore.getState().setMode}
          options={[
            { value: "mashup", label: t("pro.modes.mashup") },
            { value: "mix", label: t("pro.modes.mix") },
          ]}
        />
        <div className="flex-1" />
        {/* Same look as the library's Filtros: the violet veil and a count when it
            narrows the ideas; the chevron says whether the bar is open. */}
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-label={count > 0 ? t("pro.filter.buttonCount", { count }) : t("pro.filter.button")}
          onClick={useDecksStore.getState().toggleFilters}
          className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border px-3 text-text transition-colors duration-hover ${count > 0 ? "border-primary bg-primary-soft" : `border-border hover:border-border-strong ${filtersOpen ? "bg-surface-2" : "bg-surface-3"}`}`}
        >
          <SlidersHorizontal size={14} strokeWidth={1.5} />
          {t("pro.filter.button")}
          {count > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-primary px-1 font-mono text-[11px] text-white">
              {count}
            </span>
          )}
          <ChevronDown
            aria-hidden
            size={14}
            strokeWidth={1.5}
            className={`text-text-3 transition-transform duration-hover ${filtersOpen ? "rotate-180" : ""}`}
          />
        </button>
      </header>
      {filtersOpen && <IdeaFilter />}
      {trackA == null ? (
        <div className="flex flex-1 flex-col items-center overflow-auto px-5 pb-12">
          <EmptyState
            compact
            icon={Disc3}
            title={t("pro.emptyTitle")}
            text={t(`pro.emptyHint.${mode}`)}
          />
          <TrackPicker onPick={useDecksStore.getState().loadA} />
        </div>
      ) : (
        <Studio trackA={trackA} />
      )}
    </section>
  );
}
