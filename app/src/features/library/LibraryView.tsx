import { FolderPlus, Rows3, Rows4, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { cancelAnalysis, cancelImport, type ListParams, useLibraryTotal } from "./api";
import { useAnalysisStore } from "./analysisStore";
import { useImportStore } from "./importStore";
import { JobBar } from "./JobBar";
import { useLibraryStore } from "./store";
import { TrackTable } from "./TrackTable";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function SearchBox() {
  const { t } = useTranslation();
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="flex h-8 w-[260px] items-center gap-2 rounded-sm border border-border bg-surface-3 pl-2.5 pr-2 text-text-3 focus-within:border-primary">
      <Search aria-hidden size={16} strokeWidth={1.5} />
      <input
        ref={inputRef}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setSearch("")}
        placeholder={t("library.search")}
        aria-label={t("library.search")}
        className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
      />
      {search ? (
        <button
          type="button"
          aria-label={t("library.clearSearch")}
          onClick={() => setSearch("")}
          className="grid size-5 place-items-center rounded-sm hover:text-text"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      ) : (
        <kbd className="h-[18px] rounded-[4px] border border-border-strong px-1.5 font-mono text-[11px] leading-[16px]">
          {isMac ? "⌘F" : "Ctrl F"}
        </kbd>
      )}
    </label>
  );
}

function DensityToggle() {
  const { t } = useTranslation();
  const density = useLibraryStore((s) => s.density);
  const setDensity = useLibraryStore((s) => s.setDensity);
  const options = [
    { value: "comfortable", icon: Rows3, label: t("library.densityComfortable") },
    { value: "compact", icon: Rows4, label: t("library.densityCompact") },
  ] as const;
  return (
    <div role="radiogroup" className="flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={density === value}
          title={label}
          aria-label={label}
          onClick={() => setDensity(value)}
          className={`grid h-[26px] w-7 place-items-center rounded-[5px] transition-colors duration-hover ${density === value ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

function ImportBar() {
  const { t } = useTranslation();
  const { jobId, stage, done, total, percent } = useImportStore();
  if (!jobId) return null;
  const label =
    stage === "importing" && total > 0
      ? t("import.progress", { done, total })
      : t("import.scanning");
  return <JobBar label={label} percent={percent} onCancel={() => void cancelImport()} />;
}

function AnalysisBar() {
  const { t } = useTranslation();
  const { jobId, done, total, percent } = useAnalysisStore();
  if (!jobId) return null;
  const label = total > 0 ? t("analysis.progress", { done, total }) : t("analysis.starting");
  return <JobBar label={label} percent={percent} onCancel={() => void cancelAnalysis()} />;
}

export function LibraryView({ onAddMusic }: { onAddMusic: () => void }) {
  const { t, i18n } = useTranslation();
  const search = useLibraryStore((s) => s.search);
  const sort = useLibraryStore((s) => s.sort);
  const descending = useLibraryStore((s) => s.descending);
  const deferredSearch = useDeferredValue(search.trim());
  const params: ListParams = { search: deferredSearch || null, sort, descending };
  const { total } = useLibraryTotal(params);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("library.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5" data-tauri-drag-region>
          <h1 className="whitespace-nowrap font-display text-title">{t("library.title")}</h1>
          <span className="whitespace-nowrap font-mono text-[12px] text-text-3">
            {t("library.count", { count: total, formatted: formatCount(total, i18n.language) })}
          </span>
        </div>
        <SearchBox />
        <DensityToggle />
        <button
          type="button"
          onClick={onAddMusic}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          <FolderPlus size={16} strokeWidth={1.5} />
          {t("library.addMusic")}
        </button>
      </header>
      <ImportBar />
      <AnalysisBar />
      {total === 0 && deferredSearch ? (
        <div className="flex flex-col items-center gap-2.5 px-5 py-16 text-text-2">
          <div className="text-section text-text">{t("library.noResults")}</div>
          <button
            type="button"
            onClick={() => useLibraryStore.getState().setSearch("")}
            className="h-[30px] rounded-sm border border-border bg-surface-3 px-3 text-text"
          >
            {t("library.clearSearch")}
          </button>
        </div>
      ) : (
        <TrackTable params={params} total={total} />
      )}
    </section>
  );
}
