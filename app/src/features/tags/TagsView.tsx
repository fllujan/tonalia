// Write analysis results into the files (DESIGN 6.7, "Escribir resultados"): options on
// the left, mandatory before -> after preview on the right, backup reassurance and the
// write button below. Every write can be undone from the toast that follows it.
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import { fileStem } from "../../lib/format";
import { NOTATIONS } from "../../lib/keys";
import { request } from "../../lib/rpc";
import type { TagOptions } from "../../lib/rpc.types";
import { JobBar } from "../library/JobBar";
import { DEFAULT_TAG_OPTIONS, useSettings, useUpdateSettings } from "../settings/api";
import { useToastStore } from "../toast/toastStore";
import { PREVIEW_LIMIT, startTagWrite, useTagPreview } from "./api";
import { useTagJobStore } from "./tagJobStore";

const VARIABLES = ["{key}", "{key_alt}", "{energy}", "{bpm}", "{comment_original}"] as const;
const POSITIONS = ["before", "after", "replace"] as const;

type Options = Required<TagOptions>;

export function TagsView({ trackIds, onBack }: { trackIds: number[]; onBack: () => void }) {
  const { t, i18n } = useTranslation();
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
  const job = useTagJobStore();
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

  const write = () =>
    startTagWrite(trackIds, options).catch((err: unknown) =>
      useToastStore.getState().push({
        title: t("tags.failed", { error: err instanceof Error ? err.message : String(err) }),
        tone: "danger",
      }),
    );

  const items = preview.data?.items ?? [];
  const count = new Intl.NumberFormat(i18n.language).format(trackIds.length);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("tags.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("detail.back")}
        </button>
        <h1 className="font-display text-title">{t("tags.title")}</h1>
        <span className="font-mono text-[12px] text-text-3">
          {t("library.count", { count: trackIds.length, formatted: count })}
        </span>
      </header>
      {job.jobId && (
        <JobBar
          label={t(job.kind === "undo" ? "tags.undoing" : "tags.writing", {
            done: job.done,
            total: job.total,
          })}
          percent={job.percent}
          onCancel={() => job.jobId && void request("job.cancel", { jobId: job.jobId })}
        />
      )}
      <div className="flex min-h-0 flex-1">
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
              className="mt-1 flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
            >
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
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-section">{t("settings.notation")}</span>
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
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4" aria-busy={preview.isFetching}>
            <h2 className="mb-3 text-section">{t("tags.preview")}</h2>
            {trackIds.length > PREVIEW_LIMIT && (
              <p className="mb-3 text-[12px] text-text-3">
                {t("tags.previewLimit", { shown: PREVIEW_LIMIT, total: count })}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.trackId} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="mb-1.5 truncate font-medium" title={item.path}>
                    {fileStem(item.path)}
                  </div>
                  {item.error ? (
                    <div className="text-[12px] text-danger">{item.error}</div>
                  ) : item.changes.length === 0 ? (
                    <div className="text-[12px] text-text-3">{t("tags.noChanges")}</div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <tbody>
                        {item.changes.map((c) => (
                          <tr key={c.field}>
                            <th
                              scope="row"
                              className="w-24 py-0.5 text-left font-normal text-text-3"
                            >
                              {t(`tags.fieldNames.${c.field}`)}
                            </th>
                            <td className="py-0.5">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {c.before ? (
                                  <del className="text-text-3">{c.before}</del>
                                ) : (
                                  <span className="text-text-3">{t("tags.empty")}</span>
                                )}
                                <ArrowRight
                                  aria-label={t("tags.becomes")}
                                  size={12}
                                  strokeWidth={1.5}
                                  className="text-text-3"
                                />
                                <ins className="rounded-[4px] bg-success/15 px-1 text-text no-underline">
                                  {c.after}
                                </ins>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <footer className="flex items-center gap-3 border-t border-border px-5 py-3">
            <p className="flex-1 text-[12px] text-text-2">🛟 {t("tags.reassurance")}</p>
            <button
              type="button"
              onClick={() => void write()}
              disabled={trackIds.length === 0 || job.jobId !== null}
              className="h-8 rounded-sm bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {t("tags.write", { count: trackIds.length, formatted: count })}
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}
