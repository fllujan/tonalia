// DESIGN 6.9 bottom: compact list of all the ideas for deck A (score, key after the shift,
// BPM, energy and the main reasons). Choosing one puts it on deck B.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { ShiftedKey } from "../../components/ShiftedKey";
import { fileStem, formatBpm } from "../../lib/format";
import { makeKey, shift as shiftKey } from "../../lib/keys";
import type { Suggestion } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import { reasonText } from "./reasons";
import { scoreTone } from "./score";

const GRID = "grid-cols-[32px_44px_minmax(0,2fr)_156px_64px_80px_minmax(0,3fr)]";

export function IdeaList({
  items,
  current,
  onPick,
}: {
  items: Suggestion[];
  current: number;
  onPick: (index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const list = useRef<HTMLUListElement>(null);

  // Keep deck B's idea in view when the arrows move through the list.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Column names (each option's accessible name already says it all). */}
      <div
        aria-hidden
        className={`grid h-7 shrink-0 ${GRID} items-center gap-3 border-b border-border px-5 text-label uppercase text-text-3`}
      >
        <span>#</span>
        <span>{t("pro.ideaScore")}</span>
        <span>{t("library.columns.title")}</span>
        <span>{t("library.columns.key")}</span>
        <span>{t("library.columns.bpm")}</span>
        <span>{t("library.columns.energy")}</span>
        <span>{t("pro.why")}</span>
      </div>
      <ul
        ref={list}
        role="listbox"
        aria-label={t("pro.ideas")}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {items.map((idea, i) => {
          const title = idea.track.title ?? fileStem(idea.track.path);
          const reasons = idea.reasons
            .filter((r) => r.kind !== "bpm" || r.code !== "same")
            .slice(0, 3)
            .map((r) => reasonText(t, r, i18n.language));
          return (
            <li
              key={idea.track.id}
              role="option"
              data-index={i}
              aria-selected={i === current}
              aria-label={t("pro.ideaOption", { n: i + 1, title, score: idea.score })}
              tabIndex={i === Math.max(0, current) ? 0 : -1}
              onClick={() => onPick(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(i);
                } else if (e.key === "ArrowDown" && i < items.length - 1) {
                  e.preventDefault();
                  onPick(i + 1);
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault();
                  onPick(i - 1);
                  (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                }
              }}
              className={`grid h-9 shrink-0 cursor-pointer ${GRID} items-center gap-3 border-b border-border px-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${i === current ? "bg-primary-soft" : "hover:bg-surface-2"}`}
            >
              <span className="font-mono text-[12px] text-text-3 tabular">{i + 1}</span>
              <span
                className="font-mono text-data font-semibold tabular"
                style={{ color: scoreTone(idea.score) }}
              >
                {idea.score}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">{title}</span>
                <span className="truncate text-[11px] text-text-2">
                  {idea.track.artist ?? t("library.unknownArtist")}
                </span>
              </span>
              <ShiftedKey
                original={shiftKey(makeKey(idea.keyB.root, idea.keyB.mode), -idea.shiftB)}
                shift={idea.shiftB}
                notation={settings.notation}
              />
              <span className="font-mono text-data tabular text-text-2">
                {formatBpm(idea.track.bpm, settings.bpmDecimals)}
              </span>
              <span>{idea.track.energy != null && <EnergyMeter level={idea.track.energy} />}</span>
              <span className="truncate text-[12px] text-text-2">{reasons.join(" · ")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
