// Shared right-hand side of the tags screen: before -> after preview (component 16),
// backup reassurance and the write button.
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fileStem } from "../../lib/format";
import type { TagPreview } from "../../lib/rpc.types";
import { PREVIEW_LIMIT } from "./api";
import { useTagJobStore } from "./tagJobStore";
import { describeMessage } from "../../lib/errors";
import { useTagsTab } from "./tagsTab";
import { changedSpan, removedParts } from "./textDiff";

interface PreviewPaneProps {
  preview: TagPreview | undefined;
  fetching: boolean;
  total: number;
  /** Shown instead of the list (e.g. "choose a field to edit"). */
  placeholder?: string | null;
  onWrite: () => void;
  /** The button's verb: cleaning says so, the other tabs write. */
  verb?: "write" | "clean";
}

export function PreviewPane({
  preview,
  fetching,
  total,
  placeholder,
  onWrite,
  verb = "write",
}: PreviewPaneProps) {
  const { t, i18n } = useTranslation();
  const jobRunning = useTagJobStore((s) => s.jobId !== null);
  const items = preview?.items ?? [];
  const count = new Intl.NumberFormat(i18n.language).format(total);
  const changing = items.filter((i) => i.changes.length > 0).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4" aria-busy={fetching}>
        <h2 className="mb-3 text-section">{t("tags.preview")}</h2>
        {placeholder ? (
          <p className="text-text-3">{placeholder}</p>
        ) : (
          <>
            {total > PREVIEW_LIMIT && (
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
                    <div className="text-[12px] text-danger">{describeMessage(item.error)}</div>
                  ) : item.changes.length === 0 ? (
                    <div className="text-[12px] text-text-3">{t("tags.noChanges")}</div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <tbody>
                        {item.changes.map((c) => (
                          <tr key={c.field}>
                            <th
                              scope="row"
                              className="w-24 py-0.5 text-left align-top font-normal text-text-3"
                            >
                              {t(`tags.fieldNames.${c.field}`)}
                            </th>
                            <td className="py-0.5">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {c.before ? (
                                  <BeforeValue before={c.before} after={c.after ?? ""} />
                                ) : (
                                  <span className="text-text-3">{t("tags.empty")}</span>
                                )}
                                <ArrowRight
                                  aria-label={t("tags.becomes")}
                                  size={12}
                                  strokeWidth={1.5}
                                  className="text-text-3"
                                />
                                {c.after ? (
                                  <AfterValue before={c.before ?? ""} after={c.after} />
                                ) : (
                                  <ins className="rounded-[4px] bg-success/15 px-1 text-text-2 no-underline">
                                    {t("tags.removed")}
                                  </ins>
                                )}
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
          </>
        )}
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-5 py-3">
        <p className="flex-1 text-[12px] text-text-2">
          🛟 {t("tags.reassurance")}{" "}
          <button
            type="button"
            onClick={() => useTagsTab.getState().setTab("history")}
            className="font-medium text-primary-ink underline-offset-2 hover:underline"
          >
            {t("tags.history.open")}
          </button>
        </p>
        {!placeholder && preview && total <= PREVIEW_LIMIT && (
          <span className="text-[12px] text-text-3">{t("tags.changing", { count: changing })}</span>
        )}
        <button
          type="button"
          onClick={onWrite}
          disabled={total === 0 || jobRunning || !!placeholder}
          className="h-8 rounded-sm bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {t(verb === "clean" ? "tags.cleanN" : "tags.write", { count: total, formatted: count })}
        </button>
      </footer>
    </div>
  );
}

/** The old value struck through, with what is dropped on the danger tint (a cleaned
 * "01 MIDNIGHT BLOOM (Promo)" shows "01 " and " (Promo)" as the parts that go). */
function BeforeValue({ before, after }: { before: string; after: string }) {
  const parts = after ? removedParts(before, after) : [];
  if (!parts.some((p) => p.removed)) return <del className="text-text-3">{before}</del>;
  return (
    <del className="text-text-3">
      {parts.map((p, i) =>
        p.removed ? (
          <span key={i} className="rounded-[4px] bg-danger/15 px-0.5 text-text-2">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </del>
  );
}

/** The new value in `text`, with only the part that changed on the success tint. */
function AfterValue({ before, after }: { before: string; after: string }) {
  const { prefix, changed, suffix } = changedSpan(before, after);
  return (
    <span className="text-text">
      {prefix}
      {changed && <ins className="rounded-[4px] bg-success/15 px-0.5 no-underline">{changed}</ins>}
      {suffix}
    </span>
  );
}
