// Editor for a TrackFilter (smart playlists, SPEC 2.11). The library's advanced filters
// (SPEC 2.14) use the same conditions.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { playlistLabel } from "../../lib/playlistIcons";
import { Switch } from "../../components/Switch";
import { type Key, makeKey, type Notation } from "../../lib/keys";
import type { TrackFilter } from "../../lib/rpc.types";
import { useGenres } from "../library/api";
import { HarmonicWheel } from "../wheel/HarmonicWheel";
import { usePlaylistTree } from "./api";
import { EnergyRange } from "../../components/EnergyRange";
import { SHORT_WINDOW, useMediaQuery } from "../../lib/useMediaQuery";

type Status = NonNullable<TrackFilter["statuses"]>[number];
const STATUSES: readonly Status[] = ["pending", "ready", "error"];

const INPUT =
  "h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-label uppercase text-text-3">{label}</legend>
      {children}
    </fieldset>
  );
}

function parseBpm(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

export function FilterFields({
  value,
  onChange,
  notation,
  showPlaylist = false,
}: {
  value: TrackFilter;
  onChange: (next: TrackFilter) => void;
  notation: Notation;
  /** Offer "in playlist" (library filters; smart playlists build on it too). */
  showPlaylist?: boolean;
}) {
  const { t } = useTranslation();
  // A short window keeps Estado and Calidad in view under a smaller wheel.
  const short = useMediaQuery(SHORT_WINDOW);
  const genres = useGenres();
  const playlists = usePlaylistTree();
  const depth = (id: number | null): number => {
    const node = playlists.find((p) => p.id === id);
    return node ? 1 + depth(node.parentId) : 0;
  };
  const keys: Key[] = (value.keys ?? []).map((k) => makeKey(k.root, k.mode));
  const chosenGenres = new Set((value.genres ?? []).map((g) => g.toLowerCase()));
  const set = (patch: Partial<TrackFilter>) => onChange({ ...value, ...patch });

  const toggleKey = (key: Key) => {
    const present = keys.some((k) => k.root === key.root && k.mode === key.mode);
    set({
      keys: present
        ? keys.filter((k) => k.root !== key.root || k.mode !== key.mode)
        : [...keys, { root: key.root, mode: key.mode }],
    });
  };
  const toggleGenre = (name: string) =>
    set({
      genres: chosenGenres.has(name.toLowerCase())
        ? (value.genres ?? []).filter((g) => g.toLowerCase() !== name.toLowerCase())
        : [...(value.genres ?? []), name],
    });

  return (
    <div className="flex flex-col gap-5 short:gap-4">
      <Field label={t("filters.key")}>
        <div className="self-center">
          <HarmonicWheel
            current={null}
            selected={keys}
            notation={notation}
            onPick={toggleKey}
            size={short ? 184 : 240}
            highlightCompatibles={value.compatible ?? false}
            label={t("filters.key")}
          />
        </div>
        <Switch
          checked={value.compatible ?? false}
          onChange={(compatible) => set({ compatible })}
          label={t("filters.compatible")}
          disabled={keys.length === 0}
        />
      </Field>

      <div className="grid grid-cols-2 gap-5">
        <Field label={t("filters.bpm")}>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              aria-label={t("filters.bpmMin")}
              placeholder={t("filters.min")}
              defaultValue={value.bpmMin ?? ""}
              onChange={(e) => set({ bpmMin: parseBpm(e.target.value) })}
              className={`${INPUT} w-20`}
            />
            <span className="text-text-3">–</span>
            <input
              inputMode="decimal"
              aria-label={t("filters.bpmMax")}
              placeholder={t("filters.max")}
              defaultValue={value.bpmMax ?? ""}
              onChange={(e) => set({ bpmMax: parseBpm(e.target.value) })}
              className={`${INPUT} w-20`}
            />
          </div>
          <Switch
            checked={value.bpmHalfDouble ?? false}
            onChange={(bpmHalfDouble) => set({ bpmHalfDouble })}
            label={t("filters.halfDouble")}
          />
        </Field>

        <Field label={t("filters.energy")}>
          <EnergyRange value={value} onChange={set} className="w-full" />
        </Field>
      </div>

      {genres.length > 0 && (
        <Field label={t("filters.genres")}>
          <div className="flex flex-wrap gap-1.5">
            {genres.map((g) => {
              const on = chosenGenres.has(g.name.toLowerCase());
              return (
                <button
                  key={g.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleGenre(g.name)}
                  className={`h-7 rounded-pill border px-3 text-[12px] transition-colors duration-hover ${on ? "border-primary bg-primary-soft text-text" : "border-border bg-surface-3 text-text-2 hover:text-text"}`}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-5">
        <Field label={t("filters.status")}>
          <select
            aria-label={t("filters.status")}
            value={value.statuses?.[0] ?? ""}
            onChange={(e) => set({ statuses: e.target.value ? [e.target.value as Status] : [] })}
            className={`${INPUT} w-full min-w-0 font-sans`}
          >
            <option value="">{t("filters.any")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`filters.statuses.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("filters.quality")}>
          <select
            aria-label={t("filters.quality")}
            value={value.qualityIssues == null ? "" : value.qualityIssues ? "issues" : "clean"}
            onChange={(e) =>
              set({ qualityIssues: e.target.value ? e.target.value === "issues" : null })
            }
            className={`${INPUT} w-full min-w-0 font-sans`}
          >
            <option value="">{t("filters.any")}</option>
            <option value="issues">{t("filters.withIssues")}</option>
            <option value="clean">{t("filters.withoutIssues")}</option>
          </select>
        </Field>
      </div>

      {showPlaylist && (
        <Field label={t("filters.playlist")}>
          <select
            aria-label={t("filters.playlist")}
            value={value.playlistId ?? ""}
            onChange={(e) => set({ playlistId: e.target.value ? Number(e.target.value) : null })}
            className={`${INPUT} w-full min-w-0 font-sans`}
          >
            <option value="">{t("filters.any")}</option>
            {playlists
              .filter((p) => !p.isFolder && p.smart == null)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {"\u00a0\u00a0".repeat(depth(p.parentId))}
                  {playlistLabel(p)}
                </option>
              ))}
          </select>
        </Field>
      )}

      <Switch
        checked={value.favorites ?? false}
        onChange={(favorites) => set({ favorites })}
        label={t("filters.favorites")}
      />
    </div>
  );
}
