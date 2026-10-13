// Search the analysed tracks and load one on deck A.
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import { Artwork } from "../../components/Artwork";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip, keyStates } from "../../components/KeyChip";
import { fileStem, formatBpm } from "../../lib/format";
import { trackKey } from "../../lib/keyStyle";
import { makeKey } from "../../lib/keys";
import { request } from "../../lib/rpc";
import { libraryKeys } from "../library/api";
import { useSettings } from "../settings/api";

const LIMIT = 30;

export function TrackPicker({
  onPick,
  autoFocus = false,
}: {
  onPick: (trackId: number) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const query = useQuery({
    queryKey: [...libraryKeys.all, "picker", deferred],
    placeholderData: (previous) => previous,
    queryFn: () =>
      request("library.list", {
        search: deferred || null,
        sort: "title",
        descending: false,
        filter: { statuses: ["ready"] },
        limit: LIMIT,
      }),
  });
  const items = query.data?.items ?? [];

  return (
    <div className="flex w-full max-w-[520px] flex-col gap-2">
      <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-surface-3 px-2.5 focus-within:border-primary">
        <Search aria-hidden size={16} strokeWidth={1.5} className="text-text-3" />
        <input
          type="search"
          autoFocus={autoFocus}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("pro.pickPlaceholder")}
          aria-label={t("pro.pickSearch")}
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
        />
      </label>
      <ul
        aria-label={t("pro.pickResults")}
        className="flex max-h-[320px] flex-col overflow-auto rounded-sm border border-border bg-surface-1"
      >
        {items.length === 0 && !query.isPending && (
          <li className="px-3 py-4 text-center text-text-3">{t("pro.pickNone")}</li>
        )}
        {items.map((track) => {
          const key =
            track.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
          const title = track.title ?? fileStem(track.path);
          return (
            <li key={track.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(track.id)}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-2"
              >
                <Artwork
                  path={track.artworkPath}
                  musicalKey={trackKey(track)}
                  size={32}
                  lazy
                  className="size-8 shrink-0 rounded-[4px]"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                  <span className="truncate">{title}</span>
                  <span className="truncate text-[12px] text-text-2">
                    {track.artist ?? t("library.unknownArtist")}
                  </span>
                </span>
                {key && (
                  <KeyChip musicalKey={key} notation={settings.notation} {...keyStates(track)} />
                )}
                <span className="w-14 text-right font-mono text-data tabular text-text-2">
                  {formatBpm(track.bpm, settings.bpmDecimals)}
                </span>
                {/* Energy too, so the first pick in Pro is an informed one. */}
                <span className="w-[60px] shrink-0">
                  {track.energy != null && <EnergyMeter level={track.energy} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
