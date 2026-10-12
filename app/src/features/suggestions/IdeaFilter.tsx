// "Idea filter" bar (SPEC 2.15, DESIGN 6.9): energy, tempo range, playlists and genres to
// narrow the ideas in big libraries, plus "allow key change (±2)" and, in DJ Mix, whether
// the next track keeps, raises or lowers the energy.
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import type { SuggestFilters } from "../../lib/rpc.types";
import { activeFilters, EMPTY_FILTERS, useDecksStore } from "../decks/decksStore";
import { useGenres } from "../library/api";
import { usePlaylistTree } from "../playlists/api";

const LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);
const INPUT =
  "h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text outline-none focus:border-primary";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1.5 text-label uppercase text-text-3">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </fieldset>
  );
}

function parseBpm(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

function Chip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="flex h-7 items-center gap-1 rounded-pill border border-primary bg-primary-soft pl-2.5 pr-1 text-[12px]">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="grid size-5 place-items-center rounded-pill text-text-2 hover:text-text"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </span>
  );
}

export function IdeaFilter() {
  const { t } = useTranslation();
  const mode = useDecksStore((s) => s.mode);
  const filters = useDecksStore((s) => s.filters);
  const allowShift = useDecksStore((s) => s.allowShift);
  const direction = useDecksStore((s) => s.energyDirection);
  const { setFilters, setAllowShift, setEnergyDirection } = useDecksStore.getState();
  const genres = useGenres();
  const playlists = usePlaylistTree().filter((p) => !p.isFolder);
  const set = (patch: Partial<SuggestFilters>) => setFilters({ ...filters, ...patch });
  const chosenGenres = filters.genres ?? [];
  const chosenPlaylists = filters.playlistIds ?? [];
  const playlistName = (id: number) => {
    const p = playlists.find((x) => x.id === id);
    return p ? `${p.emoji ? `${p.emoji} ` : ""}${p.name}` : String(id);
  };

  return (
    <div
      role="region"
      aria-label={t("pro.filter.title")}
      className="flex flex-wrap items-start gap-x-8 gap-y-4 border-b border-border bg-surface-1 px-5 py-4"
    >
      <Group label={t("filters.energy")}>
        {(["energyMin", "energyMax"] as const).map((field, i) => (
          <span key={field} className="contents">
            {i === 1 && <span className="text-text-3">–</span>}
            <select
              aria-label={t(field === "energyMin" ? "filters.energyMin" : "filters.energyMax")}
              value={filters[field] ?? ""}
              onChange={(e) => set({ [field]: e.target.value ? Number(e.target.value) : null })}
              className={`${INPUT} w-[72px]`}
            >
              <option value="">{t(i === 0 ? "filters.min" : "filters.max")}</option>
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </span>
        ))}
      </Group>

      <Group label={t("pro.filter.tempo")}>
        {(["bpmMin", "bpmMax"] as const).map((field, i) => (
          <span key={field} className="contents">
            {i === 1 && <span className="text-text-3">–</span>}
            <input
              inputMode="decimal"
              aria-label={t(field === "bpmMin" ? "filters.bpmMin" : "filters.bpmMax")}
              placeholder={t(i === 0 ? "filters.min" : "filters.max")}
              defaultValue={filters[field] ?? ""}
              key={`${field}-${filters[field] ?? ""}`}
              onBlur={(e) => {
                const next = parseBpm(e.target.value);
                if (next !== (filters[field] ?? null)) set({ [field]: next });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className={`${INPUT} w-[72px]`}
            />
          </span>
        ))}
      </Group>

      <Group label={t("pro.filter.playlists")}>
        {chosenPlaylists.map((id) => (
          <Chip
            key={id}
            label={playlistName(id)}
            removeLabel={t("filters.remove", { label: playlistName(id) })}
            onRemove={() => set({ playlistIds: chosenPlaylists.filter((x) => x !== id) })}
          />
        ))}
        <select
          aria-label={t("pro.filter.addPlaylist")}
          value=""
          onChange={(e) =>
            e.target.value && set({ playlistIds: [...chosenPlaylists, Number(e.target.value)] })
          }
          className={`${INPUT} max-w-[180px] font-sans`}
        >
          <option value="">{t("pro.filter.addPlaylist")}</option>
          {playlists
            .filter((p) => !chosenPlaylists.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {playlistName(p.id)}
              </option>
            ))}
        </select>
      </Group>

      <Group label={t("filters.genres")}>
        {chosenGenres.map((g) => (
          <Chip
            key={g}
            label={g}
            removeLabel={t("filters.remove", { label: g })}
            onRemove={() => set({ genres: chosenGenres.filter((x) => x !== g) })}
          />
        ))}
        <select
          aria-label={t("pro.filter.addGenre")}
          value=""
          onChange={(e) => e.target.value && set({ genres: [...chosenGenres, e.target.value] })}
          className={`${INPUT} max-w-[180px] font-sans`}
        >
          <option value="">{t("pro.filter.addGenre")}</option>
          {genres
            .filter((g) => !chosenGenres.some((c) => c.toLowerCase() === g.name.toLowerCase()))
            .map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
        </select>
      </Group>

      <div className="flex flex-col gap-3">
        <Switch checked={allowShift} onChange={setAllowShift} label={t("pro.filter.allowShift")} />
        {mode === "mix" && (
          <Segmented
            size="sm"
            label={t("pro.filter.direction")}
            value={direction}
            onChange={setEnergyDirection}
            options={(["keep", "up", "down"] as const).map((d) => ({
              value: d,
              label: t(`pro.filter.directions.${d}`),
            }))}
          />
        )}
      </div>

      {activeFilters(filters) > 0 && (
        <button
          type="button"
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="ml-auto h-8 self-end rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          {t("filters.clear")}
        </button>
      )}
    </div>
  );
}
