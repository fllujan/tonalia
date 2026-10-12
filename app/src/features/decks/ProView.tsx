// Pro mode studio (SPEC 2.15, DESIGN 6.9 and 6.10): deck A with the chosen track, deck B
// with the best idea for it (◀ ▶ walk the ideas, with score and reasons), the Mashup ↔
// DJ Mix switch, the idea filter and the full list of ideas.
import { ChevronLeft, ChevronRight, Disc3, Repeat, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "../../components/Popover";
import { Segmented } from "../../components/Segmented";
import { makeKey } from "../../lib/keys";
import type { SuggestParams, Suggestion } from "../../lib/rpc.types";
import { IdeaFilter } from "../suggestions/IdeaFilter";
import { IdeaList } from "../suggestions/IdeaList";
import { reasonText } from "../suggestions/reasons";
import { ScoreRing } from "../suggestions/ScoreRing";
import { useSuggestions } from "../suggestions/api";
import { useTrackDetail } from "../track-detail/api";
import { Deck, type DeckChange } from "./Deck";
import { activeFilters, EMPTY_FILTERS, type ProMode, useDecksStore } from "./decksStore";
import { TrackPicker } from "./TrackPicker";

const IDEAS = 100;
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
}: {
  index: number;
  total: number;
  idea: Suggestion | undefined;
}) {
  const { t } = useTranslation();
  const setIdea = useDecksStore.getState().setIdea;
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
      {idea && <ScoreRing score={idea.score} label={t("pro.score", { score: idea.score })} />}
    </div>
  );
}

function Studio({ trackA }: { trackA: number }) {
  const { t, i18n } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const filters = useDecksStore((s) => s.filters);
  const allowShift = useDecksStore((s) => s.allowShift);
  const direction = useDecksStore((s) => s.energyDirection);
  const idea = useDecksStore((s) => s.idea);
  const a = useTrackDetail(trackA).data;
  const analysed = a != null && a.keyRoot != null && a.bpm != null;

  const params: SuggestParams | null = useMemo(
    () =>
      analysed
        ? {
            trackId: trackA,
            allowShift,
            filters,
            limit: IDEAS,
            ...(mode === "mix" ? { energyDirection: direction } : {}),
          }
        : null,
    [analysed, trackA, allowShift, filters, mode, direction],
  );
  const ideas = useSuggestions(mode, params);
  const items = ideas.data?.items ?? [];
  const index = Math.min(idea, Math.max(0, items.length - 1));
  const current = items[index];

  const change: DeckChange | null =
    current && a?.bpm != null
      ? {
          shift: current.shiftB,
          key: makeKey(current.keyB.root, current.keyB.mode),
          bpm: a.bpm / current.bpmFactor,
          factor: current.bpmFactor,
        }
      : null;

  const deckB = !a ? null : !analysed ? (
    <Placeholder>{t("pro.notAnalysed")}</Placeholder>
  ) : ideas.isError ? (
    <Placeholder>
      {t("pro.ideasFailed", {
        error: ideas.error instanceof Error ? ideas.error.message : String(ideas.error),
      })}
    </Placeholder>
  ) : ideas.isPending ? (
    <Placeholder busy>{t("pro.searching")}</Placeholder>
  ) : !current ? (
    <Placeholder>
      <span>{t("pro.noIdeas")}</span>
      {activeFilters(filters) > 0 && (
        <button
          type="button"
          onClick={() => useDecksStore.getState().setFilters(EMPTY_FILTERS)}
          className={BUTTON}
        >
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
      header={<IdeaNav index={index} total={items.length} idea={current} />}
    />
  );

  const energyStep =
    mode === "mix" && current && a?.energy != null && current.track.energy != null
      ? { from: a.energy, to: current.track.energy }
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-4 px-5 pt-4">
        <Deck key={trackA} side="a" trackId={trackA} header={<ChangeTrack />} />
        {deckB}
      </div>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-5 py-3">
        {current && (
          <>
            <span className="text-label uppercase text-text-3">{t("pro.why")}</span>
            <ul aria-label={t("pro.why")} className="flex flex-wrap gap-1.5">
              {current.reasons.map((r) => (
                <li
                  key={`${r.kind}-${r.code}`}
                  className="flex h-6 items-center rounded-pill border border-border bg-surface-3 px-2.5 text-[12px]"
                >
                  {reasonText(t, r, i18n.language)}
                </li>
              ))}
            </ul>
          </>
        )}
        {energyStep && (
          <span
            className="ml-auto font-mono text-data text-text-2"
            aria-label={t("pro.energyStep", energyStep)}
          >
            E{energyStep.from} → E{energyStep.to}{" "}
            {energyStep.to > energyStep.from ? "↑" : energyStep.to < energyStep.from ? "↓" : "="}
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="flex min-h-[160px] flex-1 flex-col border-t border-border">
          <div className="flex h-9 shrink-0 items-center justify-between px-5 text-label uppercase text-text-3">
            <span>{t("pro.ideas")}</span>
            {ideas.data && (
              <span className="normal-case tracking-normal">
                {t("pro.candidates", {
                  count: ideas.data.candidates,
                  ms: Math.round(ideas.data.elapsedMs),
                })}
              </span>
            )}
          </div>
          <IdeaList items={items} current={index} onPick={useDecksStore.getState().setIdea} />
        </div>
      )}
    </div>
  );
}

function Placeholder({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div
      aria-busy={busy || undefined}
      className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-md border border-border border-t-2 bg-surface-2 p-4 text-center text-text-3"
      style={{ borderTopColor: "var(--color-deck-b)" }}
    >
      {children}
    </div>
  );
}

export function ProView() {
  const { t } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const trackA = useDecksStore((s) => s.trackA);
  const filtersOpen = useDecksStore((s) => s.filtersOpen);
  const count = activeFilters(useDecksStore((s) => s.filters));

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
        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={useDecksStore.getState().toggleFilters}
          className={`${BUTTON} ${count > 0 ? "border-primary" : ""}`}
        >
          <SlidersHorizontal size={14} strokeWidth={1.5} />
          {count > 0 ? t("pro.filter.buttonCount", { count }) : t("pro.filter.button")}
        </button>
      </header>
      {filtersOpen && <IdeaFilter />}
      {trackA == null ? (
        <div className="flex flex-1 flex-col items-center gap-4 overflow-auto px-5 py-12">
          <Disc3 aria-hidden size={40} strokeWidth={1.25} className="text-deck-a" />
          <h2 className="text-section">{t("pro.emptyTitle")}</h2>
          <p className="max-w-[440px] text-center text-text-2">{t(`pro.emptyHint.${mode}`)}</p>
          <TrackPicker onPick={useDecksStore.getState().loadA} />
        </div>
      ) : (
        <Studio trackA={trackA} />
      )}
    </section>
  );
}
