// "Edit in bulk" tab (SPEC 2.10): set any field to the same value on N tracks at once.
import { useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditParams } from "../../lib/rpc.types";
import { startEdit, useEditPreview } from "./api";
import { PreviewPane } from "./PreviewPane";
import { reportFailure } from "./reportFailure";

type Field = keyof EditParams["values"];
const FIELDS: Field[] = [
  "title",
  "artist",
  "album",
  "genre",
  "year",
  "label",
  "comment",
  "grouping",
];

export function EditPanel({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<Partial<Record<Field, boolean>>>({});
  const [values, setValues] = useState<Partial<Record<Field, string>>>({});
  const chosen = Object.fromEntries(
    FIELDS.filter((f) => enabled[f]).map((f) => [f, values[f] ?? ""]),
  ) as EditParams["values"];
  const deferred = useDeferredValue(chosen);
  const preview = useEditPreview(trackIds, deferred);
  const empty = Object.keys(chosen).length === 0;

  return (
    <>
      <aside className="flex w-[360px] shrink-0 flex-col gap-3 overflow-auto border-r border-border p-5">
        <h2 className="text-section">{t("edit.bulkTitle")}</h2>
        <p className="text-[12px] text-text-3">{t("edit.bulkHint")}</p>
        {FIELDS.map((f) => (
          <div key={f} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`bulk-${f}`}
              checked={!!enabled[f]}
              onChange={(e) => setEnabled((s) => ({ ...s, [f]: e.target.checked }))}
              className="size-4 accent-[var(--color-primary)]"
            />
            <label htmlFor={`bulk-${f}`} className="w-24 text-body">
              {t(`tags.fieldNames.${f}`)}
            </label>
            <input
              aria-label={t("edit.bulkValue", { field: t(`tags.fieldNames.${f}`) })}
              disabled={!enabled[f]}
              value={values[f] ?? ""}
              maxLength={200}
              placeholder={enabled[f] ? t("edit.bulkEmpty") : ""}
              onChange={(e) => setValues((s) => ({ ...s, [f]: e.target.value }))}
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-2 text-control text-text outline-none focus:border-primary disabled:opacity-40"
            />
          </div>
        ))}
      </aside>
      <PreviewPane
        preview={empty ? undefined : preview.data}
        fetching={preview.isFetching}
        total={trackIds.length}
        placeholder={empty ? t("edit.bulkChoose") : null}
        onWrite={() => void startEdit(trackIds, chosen).catch(reportFailure(t))}
      />
    </>
  );
}
