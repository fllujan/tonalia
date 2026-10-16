// Advanced filters (SPEC 2.14, DESIGN 6.2–6.3): a popover anchored to "Filters" and a
// row of removable chips for the active conditions.
import { SlidersHorizontal, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Popover } from "../../components/Popover";
import { ScrollArea } from "../../components/ScrollArea";
import { displayKey, makeKey, type Notation } from "../../lib/keys";
import type { TrackFilter } from "../../lib/rpc.types";
import { usePlaylistTree } from "../playlists/api";
import {
  activeConditions,
  type FilterCondition,
  hasConditions,
  withoutCondition,
} from "../playlists/filter";
import { FilterFields } from "../playlists/FilterFields";
import { SmartPlaylistDialog } from "../playlists/SmartPlaylistDialog";
import { useSettings } from "../settings/api";
import { useLibraryStore } from "./store";

export function FiltersButton() {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<TrackFilter>({});
  const [generation, setGeneration] = useState(0);
  const count = activeConditions(filter).length;
  const label = count ? t("filters.buttonCount", { count }) : t("filters.button");

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={(e) => {
          setDraft(filter);
          setAnchor(e.currentTarget);
        }}
        className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-3 transition-colors duration-hover ${count ? "border-primary bg-primary-soft text-text" : "border-border bg-surface-3 text-text hover:border-border-strong"}`}
      >
        <SlidersHorizontal size={16} strokeWidth={1.5} />
        {/* With filters on, narrow windows keep the icon and the count (the title has
            priority); the accessible name still says "Filtros". */}
        <span className={count ? "hidden xl:inline" : undefined}>{t("filters.button")}</span>
        {count > 0 && (
          <span className="grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-primary px-1 font-mono text-[11px] text-white">
            {count}
          </span>
        )}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={t("filters.title")} onClose={() => setAnchor(null)}>
          {/* As tall as the window below the header allows: Estado and Calidad only scroll
              when the window is short (the short: wheel shrinks first). */}
          <form
            className="flex max-h-[calc(100vh-112px)] w-[420px] flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter(draft);
              setAnchor(null);
            }}
          >
            <ScrollArea frameClassName="-mx-3 -mt-3" className="min-h-0 overflow-auto p-3">
              <FilterFields
                key={generation}
                value={draft}
                onChange={setDraft}
                notation={notation}
                showPlaylist
              />
            </ScrollArea>
            <div className="-mx-3 -mb-3 flex justify-end gap-2 border-t border-border px-3 py-2.5">
              <button
                type="button"
                onClick={() => {
                  setDraft({});
                  setGeneration((g) => g + 1);
                }}
                className="mr-auto h-8 rounded-sm px-2 text-text-2 hover:bg-surface-3 hover:text-text"
              >
                {t("filters.clear")}
              </button>
              <button
                type="submit"
                className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
              >
                {t("filters.apply")}
              </button>
            </div>
          </form>
        </Popover>
      )}
    </>
  );
}

function chipLabel(
  condition: FilterCondition,
  f: TrackFilter,
  notation: Notation,
  t: TFunction,
  playlistName: (id: number) => string,
): string {
  const number = (n: number) => String(Number(n.toFixed(2)));
  switch (condition) {
    case "keys": {
      const keys = (f.keys ?? []).map((k) => displayKey(makeKey(k.root, k.mode), notation));
      return t(f.compatible ? "filters.chips.compatible" : "filters.chips.keys", {
        keys: keys.join(", "),
      });
    }
    case "bpm": {
      const range =
        f.bpmMin != null && f.bpmMax != null
          ? `${number(f.bpmMin)}–${number(f.bpmMax)}`
          : f.bpmMin != null
            ? `≥ ${number(f.bpmMin)}`
            : `≤ ${number(f.bpmMax ?? 0)}`;
      return `BPM ${range}${f.bpmHalfDouble ? " · ×2 / ÷2" : ""}`;
    }
    case "energy": {
      const range =
        f.energyMin != null && f.energyMax != null
          ? f.energyMin === f.energyMax
            ? `${f.energyMin}`
            : `${f.energyMin}–${f.energyMax}`
          : f.energyMin != null
            ? `≥ ${f.energyMin}`
            : `≤ ${f.energyMax ?? 10}`;
      return t("filters.chips.energy", { range });
    }
    case "genres":
      return t("filters.chips.genres", { genres: (f.genres ?? []).join(", ") });
    case "statuses":
      return t("filters.chips.status", {
        status: (f.statuses ?? []).map((s) => t(`filters.statuses.${s}`)).join(", "),
      });
    case "qualityIssues":
      return t(f.qualityIssues ? "filters.withIssues" : "filters.withoutIssues");
    case "favorites":
      return t("filters.chips.favorites");
    case "playlistId":
      return t("filters.chips.playlist", { name: playlistName(f.playlistId ?? -1) });
    case "played":
      return f.notPlayedDays != null
        ? t("filters.chips.notPlayed", { count: f.notPlayedDays })
        : t("filters.chips.playedRecently", { count: f.playedDays ?? 0 });
    case "minPlays":
      return t("filters.chips.minPlays", { count: f.minPlays ?? 0 });
  }
}

export function ActiveFilters() {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const playlists = usePlaylistTree();
  const [saving, setSaving] = useState(false);
  if (!hasConditions(filter)) return null;
  const playlistName = (id: number) => playlists.find((p) => p.id === id)?.name ?? "—";

  return (
    <div
      role="group"
      aria-label={t("filters.active")}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2"
    >
      {activeConditions(filter).map((condition) => {
        const label = chipLabel(condition, filter, notation, t, playlistName);
        return (
          <span
            key={condition}
            className="flex h-7 items-center gap-1 rounded-pill border border-primary bg-primary-soft pl-3 pr-1 text-[12px] text-text"
          >
            {label}
            <button
              type="button"
              aria-label={t("filters.remove", { label })}
              onClick={() => setFilter(withoutCondition(filter, condition))}
              className="hit-target relative grid size-5 place-items-center rounded-pill text-text-2 hover:bg-surface-3 hover:text-text"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={() => setFilter({})}
        className="h-7 rounded-sm px-2 text-[12px] text-text-2 hover:bg-surface-2 hover:text-text"
      >
        {t("filters.clearAll")}
      </button>
      <button
        type="button"
        onClick={() => setSaving(true)}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-text-2 hover:bg-surface-2 hover:text-text"
      >
        <WandSparkles size={14} strokeWidth={1.5} />
        {t("filters.saveSmart")}
      </button>
      {saving && <SmartPlaylistDialog initialFilter={filter} onClose={() => setSaving(false)} />}
    </div>
  );
}
