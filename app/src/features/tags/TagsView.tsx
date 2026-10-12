// Tags screen (DESIGN 6.7): write analysis results, clean tags, edit in bulk. All three
// preview first, keep a backup and can be undone from the toast that follows.
import { SegmentThumb } from "../../components/SegmentThumb";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import { JobBar } from "../library/JobBar";
import { CleanPanel } from "./CleanPanel";
import { EditPanel } from "./EditPanel";
import { useTagJobStore } from "./tagJobStore";
import { WritePanel } from "./WritePanel";

const TABS = ["write", "clean", "edit"] as const;
type Tab = (typeof TABS)[number];

export function TagsView({ trackIds, onBack }: { trackIds: number[]; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("write");
  const job = useTagJobStore();
  const count = new Intl.NumberFormat(i18n.language).format(trackIds.length);

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
        <span className="font-mono text-[12px] text-text-3">
          {t("library.count", { count: trackIds.length, formatted: count })}
        </span>
        <div
          role="tablist"
          aria-label={t("tags.screen")}
          className="relative ml-4 flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
        >
          <SegmentThumb />
          {TABS.map((id) => (
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
      <div role="tabpanel" aria-label={t(`tags.tabs.${tab}`)} className="flex min-h-0 flex-1">
        {tab === "write" && <WritePanel trackIds={trackIds} />}
        {tab === "clean" && <CleanPanel trackIds={trackIds} />}
        {tab === "edit" && <EditPanel trackIds={trackIds} />}
      </div>
    </section>
  );
}
