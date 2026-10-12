// Tags screen (DESIGN 6.7): write analysis results, clean tags, edit in bulk. All three
// preview first, keep a backup and can be undone from the toast that follows.
import { SegmentThumb } from "../../components/SegmentThumb";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import { JobBar } from "../library/JobBar";
import { CleanPanel } from "./CleanPanel";
import { EditPanel } from "./EditPanel";
import { useTagJobStore } from "./tagJobStore";
import { WritePanel } from "./WritePanel";
import { HistoryPanel } from "./HistoryPanel";
import { TAGS_TABS, useTagsTab } from "./tagsTab";
import { type TagScope, useViewStore } from "../navigation/viewStore";
import { useTrackDetail } from "../track-detail/api";
import { fileStem } from "../../lib/format";

export function TagsView({ trackIds, onBack }: { trackIds: number[]; onBack: () => void }) {
  const { t } = useTranslation();
  const { tab, setTab } = useTagsTab();
  const scope = useViewStore((s) => s.tagScope);
  // Each visit starts on the first tab; the history is one click away.
  useEffect(() => () => useTagsTab.getState().setTab("write"), []);
  const job = useTagJobStore();

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("tags.screen")}>
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
        <h1 className="font-display text-title">{t("tags.screen")}</h1>
        <div
          role="tablist"
          aria-label={t("tags.screen")}
          className="relative ml-4 flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
        >
          <SegmentThumb />
          {TAGS_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-[26px] rounded-[5px] px-3 text-control transition-colors duration-hover ${tab === id ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
            >
              {t(`tags.tabs.${id}`)}
            </button>
          ))}
        </div>
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
      {tab !== "history" && <ScopeBar trackIds={trackIds} scope={scope} onChange={onBack} />}
      <div role="tabpanel" aria-label={t(`tags.tabs.${tab}`)} className="flex min-h-0 flex-1">
        {tab === "write" && <WritePanel trackIds={trackIds} />}
        {tab === "clean" && <CleanPanel trackIds={trackIds} />}
        {tab === "edit" && <EditPanel trackIds={trackIds} />}
        {tab === "history" && <HistoryPanel />}
      </div>
    </section>
  );
}

/**
 * Which tracks the write, clean or edit applies to, said in words before the DJ acts:
 * the selection or every track of the view, with the first titles. "Change" goes back
 * to the library to pick others.
 */
function ScopeBar({
  trackIds,
  scope,
  onChange,
}: {
  trackIds: number[];
  scope: TagScope;
  onChange: () => void;
}) {
  const { t, i18n } = useTranslation();
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const first = useTrackTitle(trackIds[0]);
  const second = useTrackTitle(trackIds.length === 2 ? trackIds[1] : undefined);
  const more = trackIds.length - (trackIds.length === 2 ? 2 : 1);
  const names = [first, second].filter(Boolean).join(", ");
  return (
    <p className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-5 py-2 text-[12px] text-text-2">
      <span>
        {t("tags.scope.label")}{" "}
        <strong className="font-semibold text-text">
          {t(`tags.scope.${scope}`, { count: trackIds.length, formatted: number(trackIds.length) })}
        </strong>
        {names && (
          <>
            {": "}
            <span className="text-text">{names}</span>
            {more > 0 && ` ${t("tags.history.more", { count: more, formatted: number(more) })}`}
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onChange}
        className="font-medium text-primary-ink underline-offset-2 hover:underline"
      >
        {t("tags.scope.change")}
      </button>
    </p>
  );
}

function useTrackTitle(trackId: number | undefined): string | null {
  const detail = useTrackDetail(trackId ?? 0, trackId !== undefined).data;
  return detail ? (detail.title ?? fileStem(detail.path)) : null;
}
