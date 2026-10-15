// Ratings already in the tags (SPEC 12.2): levels the DJ wrote in comments, grouping or the
// rating field ("Energy 7", "E7", "7 - …"). Nothing is stored before the preview, and the
// levels Tonalia wrote itself are left out (they are its estimate, not the DJ's opinion).
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { formatCount } from "../../lib/format";
import type { EnergyImportItem, EnergyImportPreview } from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { DEFAULT_PATTERNS, useImportPreview, useImportRatings } from "./api";

type EnergyImportField = EnergyImportItem["field"];
const FIELDS: EnergyImportField[] = ["comment", "grouping", "rating"];

export function ImportPanel() {
  const { t, i18n } = useTranslation();
  const n = (count: number) => formatCount(count, i18n.language);
  const push = useToastStore((s) => s.push);
  const [patterns, setPatterns] = useState(DEFAULT_PATTERNS);
  const [draft, setDraft] = useState("");
  const [fields, setFields] = useState<EnergyImportField[]>(["comment", "grouping"]);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<EnergyImportPreview | null>(null);
  const find = useImportPreview();
  const store = useImportRatings();
  const draftValid = draft.trim() !== "" && draft.split("{n}").length === 2;

  const addPattern = () => {
    if (!draftValid || patterns.includes(draft)) return;
    setPatterns([...patterns, draft]);
    setDraft("");
    setPreview(null);
  };
  const toggleField = (field: EnergyImportField) => {
    setFields(fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field]);
    setPreview(null);
  };
  const search = () =>
    find.mutate(
      { patterns, fields },
      {
        onSuccess: setPreview,
        onError: (e) =>
          push({ tone: "danger", title: t("energyCal.import.failed"), detail: errorMessage(e) }),
      },
    );
  const importAll = () => {
    if (!preview) return;
    store.mutate(
      { items: preview.items.map((i) => ({ trackId: i.trackId, rating: i.rating })), overwrite },
      {
        onSuccess: (r) => {
          setPreview(null);
          push({
            tone: "success",
            title: t("energyCal.import.done", { count: r.stored, n: n(r.stored) }),
          });
        },
        onError: (e) =>
          push({ tone: "danger", title: t("energyCal.import.failed"), detail: errorMessage(e) }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-text-2">{t("energyCal.import.intro")}</p>

      <div className="flex flex-col gap-2">
        <h2 className="text-section">{t("energyCal.import.patterns")}</h2>
        <p className="text-[12px] text-text-3">{t("energyCal.import.patternsHint")}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label={t("energyCal.import.patterns")}>
          {patterns.map((p) => (
            <li
              key={p}
              className="flex h-7 items-center gap-1 rounded-pill border border-border bg-surface-3 pl-3 pr-1 font-mono text-data"
            >
              <span className="whitespace-pre">{p}</span>
              <button
                type="button"
                aria-label={t("energyCal.import.removePattern", { pattern: p })}
                disabled={patterns.length === 1}
                onClick={() => {
                  setPatterns(patterns.filter((x) => x !== p));
                  setPreview(null);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-pill text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPattern()}
            placeholder={t("energyCal.import.patternPlaceholder")}
            aria-label={t("energyCal.import.newPattern")}
            aria-invalid={draft !== "" && !draftValid}
            maxLength={40}
            className="h-8 w-56 rounded-sm border border-border bg-surface-3 px-2 font-mono text-data text-text placeholder:font-sans placeholder:text-text-3 aria-[invalid=true]:border-danger"
          />
          <button
            type="button"
            onClick={addPattern}
            disabled={!draftValid}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong disabled:opacity-40"
          >
            <Plus size={14} strokeWidth={1.5} />
            {t("energyCal.import.addPattern")}
          </button>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-section">{t("energyCal.import.fields")}</legend>
        {FIELDS.map((field) => (
          <label key={field} className="flex items-start gap-2 text-control">
            <input
              type="checkbox"
              checked={fields.includes(field)}
              onChange={() => toggleField(field)}
              className="mt-0.5 accent-primary"
            />
            <span>
              {t(`tags.fieldNames.${field}`)}
              {field === "rating" && (
                <span className="block text-[12px] text-text-3">
                  {t("energyCal.import.ratingHint")}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <button
          type="button"
          onClick={search}
          disabled={find.isPending || fields.length === 0}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong disabled:opacity-40"
        >
          {find.isPending ? t("energyCal.import.searching") : t("energyCal.import.search")}
        </button>
      </div>

      {preview && (
        <div className="flex flex-col gap-3">
          <p className="text-control text-text-2">
            {t("energyCal.import.found", {
              count: preview.items.length,
              n: n(preview.items.length),
              scanned: n(preview.scanned),
            })}
            {preview.writtenByTonalia > 0 &&
              ` ${t("energyCal.import.ours", { count: preview.writtenByTonalia, n: n(preview.writtenByTonalia) })}`}
            {preview.unreadable > 0 &&
              ` ${t("energyCal.import.unreadable", { count: preview.unreadable, n: n(preview.unreadable) })}`}
          </p>
          {preview.items.length > 0 && (
            <>
              <div className="max-h-[320px] overflow-y-auto rounded-md border border-border bg-surface-2">
                <table className="w-full text-control">
                  <thead className="sticky top-0 bg-surface-2 text-left text-label uppercase text-text-3">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{t("library.columns.title")}</th>
                      <th className="px-3 py-2 font-semibold">{t("energyCal.import.field")}</th>
                      <th className="px-3 py-2 font-semibold">{t("energyCal.import.text")}</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        {t("library.columns.energy")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((i) => (
                      <tr key={i.trackId} className="border-t border-border">
                        <td
                          className="max-w-[220px] truncate px-3 py-1.5"
                          title={i.title ?? undefined}
                        >
                          {i.title || t("energyCal.import.untitled")}
                          {i.artist && <span className="text-text-2"> · {i.artist}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-text-2">
                          {t(`tags.fieldNames.${i.field}`)}
                        </td>
                        <td
                          className="max-w-[200px] truncate px-3 py-1.5 text-text-2"
                          title={i.text}
                        >
                          {i.text}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular">
                          {i.existing != null && i.existing !== i.rating ? (
                            <>
                              <span className="text-text-3 line-through">{i.existing}</span> →{" "}
                              {i.rating}
                            </>
                          ) : (
                            i.rating
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-control">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="accent-primary"
                />
                {t("energyCal.import.overwrite")}
              </label>
              {!overwrite && (
                <p className="text-[12px] text-text-3">{t("energyCal.import.kept")}</p>
              )}
              <div>
                <button
                  type="button"
                  onClick={importAll}
                  disabled={store.isPending}
                  className="h-8 rounded-sm bg-primary px-4 text-control font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
                >
                  {t("energyCal.import.apply", {
                    count: preview.items.length,
                    n: n(preview.items.length),
                  })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
