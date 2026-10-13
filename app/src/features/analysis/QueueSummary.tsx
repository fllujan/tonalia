// Live summary of the Analyse view (DESIGN 6.4): how the analysed tracks spread over the
// harmonic wheel (a heat map: the more tracks, the fuller the segment) and over the
// energy levels (a histogram in the energy colours). Both fill in as tracks finish.
// Counts are always written (labels, tooltips, the top keys), never colour alone.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { displayKey, makeKey, wheelLetter, wheelNumber } from "../../lib/keys";
import { keyColor } from "../../lib/keyStyle";
import type { LibraryStats } from "../../lib/rpc.types";
import { WorkersSetting } from "../settings/AnalysisSettingsExtra";
import { useSettings, useUpdateSettings } from "../settings/api";
import { polar, segmentAngle, segmentPath, WHEEL_KEYS } from "../wheel/geometry";
import { useLibraryStats } from "./api";
import { useAnalysisStore } from "../library/analysisStore";
import { useTrackDetail } from "../track-detail/api";
import { useViewStore } from "../navigation/viewStore";
import { KeyChip, keyStates } from "../../components/KeyChip";
import { fileStem, formatBpm } from "../../lib/format";
import type { AnalysisTrackDone } from "../../lib/rpc.types";

const VIEW = 200;
const C = VIEW / 2;
const RINGS = { B: { inner: 70, outer: 98 }, A: { inner: 40, outer: 68 } } as const;

export function QueueSummary() {
  const { t, i18n } = useTranslation();
  const stats = useLibraryStats().data;
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const n = (count: number) => formatCount(count, i18n.language);
  return (
    <aside
      aria-label={t("analysis.liveSummary")}
      className="flex w-[280px] shrink-0 flex-col gap-6 overflow-y-auto border-l border-border bg-surface-1 p-5"
    >
      <div>
        <h2 className="text-section">{t("analysis.liveSummary")}</h2>
        {stats && (
          <p className="mt-1 text-[12px] text-text-2">
            {t("analysis.analysedOf", {
              count: stats.total,
              analysed: n(stats.analysed),
              total: n(stats.total),
            })}
          </p>
        )}
      </div>
      {stats && stats.analysed > 0 ? (
        <>
          <KeyHeatMap stats={stats} />
          <EnergyHistogram stats={stats} />
        </>
      ) : (
        <p className="text-[12px] text-text-3">{t("analysis.noData")}</p>
      )}
      <RecentlyAnalysed />
      <div className="mt-auto border-t border-border pt-5">
        <WorkersSetting settings={settings} save={update.mutate} />
        <p className="mt-2 text-[12px] text-text-3">{t("analysis.workersNext")}</p>
      </div>
    </aside>
  );
}

function KeyHeatMap({ stats }: { stats: LibraryStats }) {
  const { t, i18n } = useTranslation();
  const notation = useSettings().notation;
  const counts = new Map(stats.keys.map((k) => [`${k.root}${k.mode}`, k.count]));
  const max = Math.max(1, ...stats.keys.map((k) => k.count));
  const name = (root: number, mode: "major" | "minor") => displayKey(makeKey(root, mode), notation);
  const line = (root: number, mode: "major" | "minor", count: number) =>
    t("analysis.keyCount", {
      key: name(root, mode),
      count,
      formatted: formatCount(count, i18n.language),
    });
  const top = stats.keys.slice(0, 3);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-label uppercase text-text-3">{t("analysis.keyMap")}</h3>
      <svg
        role="img"
        aria-label={`${t("analysis.keyMap")}: ${stats.keys.map((k) => line(k.root, k.mode, k.count)).join(", ")}`}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="mx-auto w-[200px]"
      >
        {WHEEL_KEYS.map((key) => {
          const ring = RINGS[wheelLetter(key)];
          const count = counts.get(`${key.root}${key.mode}`) ?? 0;
          const wheel = wheelNumber(key);
          const at = polar(C, C, (ring.inner + ring.outer) / 2, segmentAngle(wheel));
          return (
            <g key={`${key.root}${key.mode}`} style={{ "--seg": keyColor(key) } as CSSProperties}>
              <title>{line(key.root, key.mode, count)}</title>
              <path
                d={segmentPath(C, ring.inner, ring.outer, wheel, 2)}
                fill={count ? "var(--seg)" : "var(--color-surface-3)"}
                fillOpacity={count ? 0.2 + 0.8 * (count / max) : 1}
              />
              {/* Each segment names its key (not only colour and position), with the
                  count under it when there is one. */}
              <text
                x={at.x}
                y={count > 0 ? at.y - 5 : at.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={8}
                className="pointer-events-none font-mono"
                fill={
                  count / max >= 0.5
                    ? "var(--color-on-key)"
                    : count
                      ? "var(--color-text-2)"
                      : "var(--color-text-3)"
                }
              >
                {name(key.root, key.mode)}
              </text>
              {count > 0 && (
                <text
                  x={at.x}
                  y={at.y + 5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  className="pointer-events-none font-mono font-semibold"
                  fill={count / max >= 0.5 ? "var(--color-on-key)" : "var(--color-text)"}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {top.length > 0 && (
        // A chip per key so its name and its count never run together ("8A 2"). The label
        // sits above, so the three chips share one line in the 280 px panel.
        <div className="flex flex-col gap-1 text-[12px] text-text-2">
          <span className="text-text-3">{t("analysis.topKeys")}</span>
          <div className="flex items-center gap-x-3">
            {top.map((k) => (
              <span key={`${k.root}${k.mode}`} className="flex items-center gap-1">
                <KeyChip musicalKey={makeKey(k.root, k.mode)} notation={notation} />
                <span className="font-mono">{formatCount(k.count, i18n.language)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function EnergyHistogram({ stats }: { stats: LibraryStats }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...stats.energy);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-label uppercase text-text-3">{t("analysis.energyMap")}</h3>
      <ol aria-label={t("analysis.energyMap")} className="grid h-24 grid-cols-10 items-end gap-1">
        {stats.energy.map((count, i) => {
          const level = i + 1;
          const label = t("analysis.energyCount", {
            level,
            count,
            formatted: formatCount(count, i18n.language),
          });
          return (
            <li
              key={level}
              title={label}
              aria-label={label}
              className="flex h-full flex-col items-center justify-end gap-0.5"
            >
              {/* The count over its bar: the height alone is only a comparison. */}
              {count > 0 && (
                <span aria-hidden className="font-mono text-[10px] leading-3 text-text-2">
                  {formatCount(count, i18n.language)}
                </span>
              )}
              <span
                className="block w-full rounded-t-[2px] transition-[height] duration-panel"
                style={{
                  // Room for the count above the tallest bar.
                  height: count
                    ? `calc((100% - 14px) * ${Math.max(0.06, count / max).toFixed(3)})`
                    : "2px",
                  backgroundColor: count
                    ? `var(--color-energy-${level})`
                    : "var(--color-surface-3)",
                }}
              />
            </li>
          );
        })}
      </ol>
      <div
        aria-hidden
        className="-mt-2 grid grid-cols-10 gap-1 text-center font-mono text-[10px] text-text-3"
      >
        {stats.energy.map((_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
    </section>
  );
}

/** The last tracks that finished: they leave the list, so they stay findable here. */
function RecentlyAnalysed() {
  const { t } = useTranslation();
  const recent = useAnalysisStore((s) => s.recent);
  if (!recent.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-text-3">{t("analysis.recent")}</h3>
      <ul className="flex flex-col">
        {recent.map((r) => (
          <RecentRow key={r.trackId} done={r} />
        ))}
      </ul>
    </section>
  );
}

function RecentRow({ done }: { done: AnalysisTrackDone }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const track = useTrackDetail(done.trackId).data;
  const title = track ? (track.title ?? fileStem(track.path)) : "…";
  const key =
    track?.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => useViewStore.getState().openDetail(done.trackId)}
        className="-mx-2 flex h-8 w-[calc(100%+16px)] items-center gap-2 rounded-sm px-2 text-left transition-colors duration-hover hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 truncate text-control">{title}</span>
        {done.status === "error" ? (
          <span className="shrink-0 text-[12px] text-danger">{t("library.status.error")}</span>
        ) : (
          <>
            {key && track && (
              <KeyChip musicalKey={key} notation={settings.notation} {...keyStates(track)} />
            )}
            {track?.bpm != null && (
              <span className="shrink-0 font-mono text-[12px] text-text-2">
                {formatBpm(track.bpm, settings.bpmDecimals)}
              </span>
            )}
          </>
        )}
      </button>
    </li>
  );
}
