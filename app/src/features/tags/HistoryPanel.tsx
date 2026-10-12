// History tab of the tags screen: every batch that changed files (analysis results,
// cleaning, bulk edit, Serato cues), newest first, each undoable for as long as its
// backups exist — not only from the toast that follows the write (SPEC 2.9, rule 3).
import { Eraser, History, Disc3, PencilLine, Sparkles, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import type { TagBatchInfo } from "../../lib/rpc.types";
import { reportFailure } from "./reportFailure";
import { startTagUndo, useTagHistory } from "./api";
import { useTagJobStore } from "./tagJobStore";

const KIND_ICON: Record<string, typeof Sparkles> = {
  results: Sparkles,
  clean: Eraser,
  edit: PencilLine,
  serato: Disc3,
};

const KNOWN_KINDS = new Set(Object.keys(KIND_ICON));

export function HistoryPanel() {
  const { t } = useTranslation();
  const history = useTagHistory();
  const items = history.data?.items ?? [];

  if (history.isPending) {
    return <p className="p-5 text-text-3">{t("detail.loading")}</p>;
  }
  if (!items.length) {
    return (
      <div className="grid flex-1 place-items-center p-5">
        <EmptyState
          icon={History}
          title={t("tags.history.emptyTitle")}
          text={t("tags.history.empty")}
        />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <p className="mb-3 max-w-[520px] text-text-2">{t("tags.history.intro")}</p>
      <ul className="overflow-hidden rounded-md border border-border bg-surface-2">
        {items.map((item) => (
          <HistoryRow key={item.batchId} item={item} />
        ))}
      </ul>
    </div>
  );
}

function HistoryRow({ item: batch }: { item: TagBatchInfo }) {
  const { t, i18n } = useTranslation();
  const item = {
    ...batch,
    titles: batch.titles ?? [],
    fields: batch.fields ?? [],
    undoable: batch.undoable ?? 0,
  };
  const busy = useTagJobStore((s) => s.jobId !== null);
  const Icon = KIND_ICON[item.kind] ?? Sparkles;
  const kind = KNOWN_KINDS.has(item.kind) ? item.kind : "results";
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(item.createdAt));
  const more = item.written - item.titles.length;
  const titles =
    item.titles.join(", ") +
    (more > 0 ? ` ${t("tags.history.more", { count: more, formatted: number(more) })}` : "");
  const partial = !item.undoneAt && item.undoable > 0 && item.undoable < item.written;

  return (
    <li className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <Icon aria-hidden size={18} strokeWidth={1.5} className="shrink-0 text-text-3" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{t(`tags.history.kinds.${kind}`)}</span>
          <span className="text-[12px] text-text-3">
            <time dateTime={item.createdAt}>{when}</time>
            {" · "}
            {t("tags.history.tracks", { count: item.written, formatted: number(item.written) })}
          </span>
        </div>
        <p className="truncate text-[12px] text-text-2" title={titles}>
          {titles}
        </p>
        {item.fields.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={t("tags.history.fields")}>
            {item.fields.map((field) => (
              <li
                key={field}
                className="rounded-sm bg-surface-3 px-1.5 text-[11px] leading-[18px] text-text-2"
              >
                {t(`tags.fieldNames.${field}`, { defaultValue: field })}
              </li>
            ))}
          </ul>
        )}
      </div>
      {item.undoneAt ? (
        <span className="shrink-0 text-[12px] text-text-3">
          {t("tags.history.undone", {
            date: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(item.undoneAt)),
          })}
        </span>
      ) : item.undoable > 0 ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startTagUndo(item.batchId).catch(reportFailure(t))}
            className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
          >
            <Undo2 aria-hidden size={14} strokeWidth={1.5} />
            {t("tags.undo")}
          </button>
          {partial && (
            <span className="text-[11px] text-warning">
              {t("tags.history.partial", {
                count: item.undoable,
                formatted: number(item.undoable),
              })}
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}
