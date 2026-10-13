// "Write results" tab (DESIGN 6.7): key, BPM, energy and the comment template.
import { SegmentThumb } from "../../components/SegmentThumb";
import { useDeferredValue, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import { NOTATIONS } from "../../lib/keys";
import type { TagOptions } from "../../lib/rpc.types";
import { DEFAULT_TAG_OPTIONS, useSettings, useUpdateSettings } from "../settings/api";
import { startTagWrite, useTagPreview } from "./api";
import { PreviewPane } from "./PreviewPane";
import { reportFailure } from "./reportFailure";

const VARIABLES = ["{key}", "{key_alt}", "{energy}", "{bpm}", "{comment_original}"] as const;
const POSITIONS = ["before", "after", "replace"] as const;

type Options = Required<TagOptions>;

export function WritePanel({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const saveDefault = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const [options, setOptions] = useState<Options>(() => ({
    ...DEFAULT_TAG_OPTIONS,
    ...settings.tagOptions,
    notation: settings.tagOptions.notation ?? settings.notation,
    bpmDecimals: settings.tagOptions.bpmDecimals ?? settings.bpmDecimals,
  }));
  const deferred = useDeferredValue(options);
  const preview = useTagPreview(trackIds, deferred);
  const template = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  const insert = (variable: string) => {
    const el = template.current;
    const text = options.commentTemplate;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    set("commentTemplate", text.slice(0, start) + variable + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  return (
    <>
      <aside className="flex w-[360px] shrink-0 flex-col gap-5 overflow-auto border-r border-border p-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-section">{t("tags.fields")}</legend>
          <Switch
            label={t("tags.writeKey")}
            checked={options.writeKey}
            onChange={(v) => set("writeKey", v)}
          />
          <Switch
            label={t("tags.writeBpm")}
            checked={options.writeBpm}
            onChange={(v) => set("writeBpm", v)}
          />
          <Switch
            label={t("tags.writeComment")}
            checked={options.writeComment}
            onChange={(v) => set("writeComment", v)}
          />
          <Switch
            label={t("tags.energyInGrouping")}
            checked={options.energyInGrouping}
            onChange={(v) => set("energyInGrouping", v)}
          />
          <Switch
            label={t("tags.energyInRating")}
            checked={options.energyInRating}
            onChange={(v) => set("energyInRating", v)}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={!options.writeComment}>
          <legend className="mb-2 text-section">{t("tags.template")}</legend>
          <input
            ref={template}
            aria-label={t("tags.template")}
            value={options.commentTemplate}
            maxLength={200}
            onChange={(e) => set("commentTemplate", e.target.value)}
            onDrop={(e) => {
              const v = e.dataTransfer.getData("text/plain");
              if (VARIABLES.includes(v as (typeof VARIABLES)[number])) {
                e.preventDefault();
                insert(v);
              }
            }}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-data text-text outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("tags.variables")}>
            {VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", v)}
                onClick={() => insert(v)}
                className="h-6 rounded-pill border border-border bg-surface-2 px-2 font-mono text-[12px] text-text-2 hover:border-primary hover:text-text"
              >
                {v}
              </button>
            ))}
          </div>
          <div
            role="radiogroup"
            aria-label={t("tags.position")}
            className="relative mt-1 flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
          >
            <SegmentThumb />
            {POSITIONS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={options.commentPosition === p}
                onClick={() => set("commentPosition", p)}
                className={`h-[26px] flex-1 rounded-[5px] text-control transition-colors duration-hover ${options.commentPosition === p ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
              >
                {t(`tags.positions.${p}`)}
              </button>
            ))}
          </div>
          {/* How the template meets the comment already there, " | " included. */}
          <p className="whitespace-pre-wrap text-[12px] text-text-3">
            {t(`tags.positionHint.${options.commentPosition}`, {
              template: options.commentTemplate,
            })}
          </p>
        </fieldset>
        {/* Not the screen's notation (Ajustes): how the key is written into the files,
            which may differ (e.g. a DJ program that reads the classical names). */}
        <label className="flex flex-col gap-1.5">
          <span className="text-section">{t("tags.fileNotation")}</span>
          <span className="text-[12px] text-text-3">{t("tags.fileNotationHint")}</span>
          <select
            value={options.notation ?? "alphanumeric"}
            onChange={(e) => set("notation", e.target.value as Options["notation"])}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
          >
            {NOTATIONS.map((n) => (
              <option key={n} value={n}>
                {t(`settings.notations.${n}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => saveDefault.mutate({ tagOptions: options })}
          className="h-8 self-start rounded-sm border border-border bg-surface-3 px-3 text-control text-text"
        >
          {t("tags.saveDefault")}
        </button>
      </aside>
      <PreviewPane
        preview={preview.data}
        fetching={preview.isFetching}
        total={trackIds.length}
        onWrite={() => void startTagWrite(trackIds, options).catch(reportFailure(t))}
      />
    </>
  );
}
