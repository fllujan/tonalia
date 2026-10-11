// DESIGN 6.8 — export to DJ software. Every card can simulate first; real exports back
// up the destination before replacing it (SPEC 2.12).
import { save } from "@tauri-apps/plugin-dialog";
import { Disc3, FileOutput, LoaderCircle, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import type { ExportOptions, ExportResult, ExportWarning } from "../../lib/rpc.types";
import { useLibraryStore } from "../library/store";
import { useToastStore } from "../toast/toastStore";
import { startExport } from "./api";
import { type ExportOutcome, type ExportTarget, useExportStore } from "./exportStore";

type Flag = "cues" | "colors" | "beatgrid" | "key" | "includePlaylists" | "memoryCues";

const PATH_KEY = (target: ExportTarget) => `tonalia.export.${target}.path`;

function loadPath(target: ExportTarget): string | null {
  try {
    return localStorage.getItem(PATH_KEY(target));
  } catch {
    return null;
  }
}

function savePath(target: ExportTarget, path: string): void {
  try {
    localStorage.setItem(PATH_KEY(target), path);
  } catch {
    // Not remembered; the export still uses it.
  }
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

function groupWarnings(warnings: ExportWarning[]): [ExportWarning["code"], ExportWarning[]][] {
  const groups = new Map<ExportWarning["code"], ExportWarning[]>();
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w]);
  return [...groups];
}

function ResultPanel({ outcome }: { outcome: ExportOutcome }) {
  const { t, i18n } = useTranslation();
  if (outcome.status === "failed") {
    return (
      <div role="status" className="rounded-md border border-danger bg-surface-1 p-3 text-danger">
        {t("export.failed", { error: outcome.error })}
      </div>
    );
  }
  if (outcome.status === "cancelled") {
    return (
      <div role="status" className="text-text-2">
        {t("export.cancelled")}
      </div>
    );
  }
  const r: ExportResult = outcome.result;
  const n = (value: number) => formatCount(value, i18n.language);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3"
    >
      <div className="font-medium">
        {r.simulated ? t("export.simulatedTitle") : t("export.doneTitle")}
      </div>
      <div className="font-mono text-[12px] text-text-2">
        {t("export.summary", {
          tracks: n(r.tracks),
          cues: n(r.cues),
          playlists: n(r.playlists),
          warnings: n(r.warnings.length),
        })}
      </div>
      <div className="truncate font-mono text-[12px] text-text-3" title={r.path}>
        {r.path}
      </div>
      {r.backupPath && (
        <div className="truncate text-[12px] text-text-2" title={r.backupPath}>
          {t("export.backup", { path: r.backupPath })}
        </div>
      )}
      {r.warnings.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-warning">
            {t("export.warningsTitle", { count: r.warnings.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {groupWarnings(r.warnings).map(([code, items]) => (
              <li key={code}>
                <div className="flex items-center gap-1.5 text-text">
                  <TriangleAlert size={12} strokeWidth={1.5} className="text-warning" />
                  {t(`export.warnings.${code}`, { count: items.length })}
                </div>
                <ul className="ml-5 text-text-3">
                  {items.slice(0, 5).map((w, i) => (
                    <li key={i} className="truncate" title={w.path ?? undefined}>
                      {w.path ?? `#${w.trackId}`}
                    </li>
                  ))}
                  {items.length > 5 && <li>{t("export.more", { count: items.length - 5 })}</li>}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Card({
  target,
  title,
  description,
  flags,
  defaultFile,
  guide,
}: {
  target: "rekordbox";
  title: string;
  description: string;
  flags: Flag[];
  defaultFile: string;
  guide?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const selected = useLibraryStore((s) => s.selected);
  const running = useExportStore((s) => s.running);
  const outcome = useExportStore((s) => s.outcomes[target]);
  const [values, setValues] = useState<Record<Flag, boolean>>({
    cues: true,
    colors: true,
    beatgrid: true,
    key: true,
    includePlaylists: true,
    memoryCues: false,
  });
  const [onlySelection, setOnlySelection] = useState(false);
  const [path, setPath] = useState<string | null>(() => loadPath(target));
  const busy = running != null;

  const choosePath = async (): Promise<string | null> => {
    const picked = await save({
      defaultPath: path ?? defaultFile,
      filters: [{ name: "XML", extensions: ["xml"] }],
      title: t("export.choosePath"),
    });
    if (!picked) return null;
    setPath(picked);
    savePath(target, picked);
    return picked;
  };

  const run = async (simulate: boolean) => {
    const destination = path ?? (simulate ? null : await choosePath());
    if (!simulate && !destination) return;
    const options: ExportOptions = {
      ...values,
      simulate,
      path: destination,
      trackIds: onlySelection && selected.length ? selected : null,
      language: i18n.language.startsWith("es") ? "es" : "en",
    };
    try {
      await startExport(target, options);
    } catch (err) {
      useToastStore.getState().push({
        title: t("export.failed", { error: err instanceof Error ? err.message : String(err) }),
        tone: "danger",
      });
    }
  };

  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-md border border-border bg-surface-2 p-5"
    >
      <header className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-md bg-surface-3 text-text-2">
          <Disc3 size={20} strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <h2 className="text-section">{title}</h2>
          <p className="text-control text-text-2">{description}</p>
        </div>
      </header>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 text-label uppercase text-text-3">{t("export.what")}</legend>
        {flags.map((flag) => (
          <Check
            key={flag}
            checked={values[flag]}
            onChange={(checked) => setValues((v) => ({ ...v, [flag]: checked }))}
            label={t(`export.flags.${flag}`)}
          />
        ))}
      </fieldset>
      {selected.length > 0 && (
        <Check
          checked={onlySelection}
          onChange={setOnlySelection}
          label={t("export.onlySelection", { count: selected.length })}
        />
      )}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-text-3">{t("export.destination")}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-text-2" title={path ?? undefined}>
          {path ?? t("export.noDestination")}
        </span>
        <button
          type="button"
          onClick={() => void choosePath()}
          className="h-7 rounded-sm px-2 text-primary hover:bg-surface-3"
        >
          {t("export.change")}
        </button>
      </div>
      {guide}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(true)}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
        >
          {running?.target === target && running.simulate && (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          )}
          {t("export.simulate")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {running?.target === target && !running.simulate ? (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          ) : (
            <FileOutput size={14} strokeWidth={1.5} />
          )}
          {t("export.export")}
        </button>
      </div>
      {outcome && <ResultPanel outcome={outcome} />}
    </section>
  );
}

function RekordboxGuide() {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-1.5 rounded-md bg-surface-1 p-3 text-[12px] text-text-2">
      {[1, 2, 3].map((step) => (
        <li key={step} className="flex gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-primary-soft font-mono text-[11px] text-text">
            {step}
          </span>
          <span>{t(`export.rekordbox.step${step}`)}</span>
        </li>
      ))}
    </ol>
  );
}

export function ExportView() {
  const { t } = useTranslation();
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("export.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("export.title")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <p className="mb-4 max-w-[720px] text-body text-text-2">{t("export.intro")}</p>
        <div className="grid max-w-[1200px] grid-cols-1 gap-5 xl:grid-cols-2">
          <Card
            target="rekordbox"
            title="Rekordbox"
            description={t("export.rekordbox.description")}
            flags={["cues", "colors", "beatgrid", "key", "includePlaylists", "memoryCues"]}
            defaultFile="rekordbox.xml"
            guide={<RekordboxGuide />}
          />
        </div>
      </div>
    </section>
  );
}
