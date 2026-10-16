// SPEC 13.2 — take the library from one DJ program to another, in Export. Choose where
// from and where to; "Review the trip" runs the import and the export on a copy and says
// what each step would do and what does not survive (nothing is written); the trip itself
// waits for a review of these same options. Afterwards: the export's result (backup,
// warnings) and Undo for what came into Tonalia.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowRight, CircleCheck, Info, LoaderCircle, TriangleAlert, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import { describeFailure, errorMessage } from "../../lib/errors";
import { formatCount } from "../../lib/format";
import { request } from "../../lib/rpc";
import type { ConvertLoss, ConvertOptions, ImportPolicy } from "../../lib/rpc.types";
import { IMPORT_SOURCES, type ImportSource, undoImport } from "../dj-import/importJobs";
import { useToastStore } from "../toast/toastStore";
import { type ConvertOutcome, sameConvert, startConvert, useConvertJobs } from "./convertJobs";
import { RekordboxGuide, ResultPanel } from "./ExportView";

type Wins = "take" | "fill";
const FIELDS = ["cues", "grid", "key", "bpm", "rating", "playCount", "comment"] as const;
const policyOf = (wins: Wins): ImportPolicy =>
  Object.fromEntries(FIELDS.map((f) => [f, wins])) as ImportPolicy;

const TITLE = Object.fromEntries(IMPORT_SOURCES.map((s) => [s.source, s.title])) as Record<
  ImportSource,
  string
>;
/** Targets whose collection cannot be written while the program is open. */
const STATUS_METHOD = {
  traktor: "export.traktorStatus",
  virtualdj: "export.virtualdjStatus",
  engine_dj: "export.engineDjStatus",
} as const;
type CollectionTarget = keyof typeof STATUS_METHOD;
const isCollection = (p: ImportSource): p is CollectionTarget => p in STATUS_METHOD;

const KEY = {
  source: "tonalia.convert.source",
  target: "tonalia.convert.target",
  sourcePath: (p: ImportSource) => `tonalia.convert.from.${p}`,
  targetPath: (p: ImportSource) => `tonalia.convert.to.${p}`,
};

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it is still used now.
  }
}

function loadProgram(key: string, fallback: ImportSource): ImportSource {
  const stored = load(key);
  return IMPORT_SOURCES.find((s) => s.source === stored)?.source ?? fallback;
}

function StatusLine({ tone, children }: { tone: "ok" | "warning"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 text-[12px] ${tone === "ok" ? "text-text-2" : "text-warning"}`}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        className={`mt-0.5 shrink-0 ${tone === "ok" ? "text-success" : ""}`}
      />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--color-primary)]"
      />
      <span className="flex flex-col">
        {label}
        <span className="text-[12px] text-text-3">{hint}</span>
      </span>
    </label>
  );
}

function ProgramSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ImportSource;
  onChange: (value: ImportSource) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label uppercase text-text-3">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as ImportSource)}
        className="h-8 w-[180px] rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
      >
        {IMPORT_SOURCES.map((s) => (
          <option key={s.source} value={s.source}>
            {s.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One line per collection: what Tonalia uses and Choose/Change. */
function PathRow({
  label,
  path,
  empty,
  onChoose,
}: {
  label: string;
  path: string | null;
  empty: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-[72px] shrink-0 text-text-3">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate ${path ? "font-mono text-text-2" : "text-text-3"}`}
        title={path ?? undefined}
      >
        {path ?? empty}
      </span>
      <button
        type="button"
        onClick={onChoose}
        className="h-7 shrink-0 rounded-sm px-2 text-primary-ink hover:bg-surface-3"
      >
        {t(path ? "djImport.change" : "djImport.choose")}
      </button>
    </div>
  );
}

function Loss({ loss, target }: { loss: ConvertLoss; target: string }) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => formatCount(v, i18n.language);
  // A note, not a loss: Serato reads key and BPM from the tags Tonalia writes in Tags.
  const note = loss.code === "key_bpm_tags" || loss.code === "cue_colors_palette";
  const Icon = note ? Info : TriangleAlert;
  return (
    <li className="flex items-start gap-2">
      <Icon
        aria-hidden
        size={14}
        strokeWidth={1.5}
        className={`mt-0.5 shrink-0 ${note ? "text-info" : "text-warning"}`}
      />
      <span>
        <span className="text-text">{t(`convert.losses.${loss.code}.title`)}</span>{" "}
        <span className="text-text-2">
          {t(`convert.losses.${loss.code}.text`, {
            count: loss.tracks,
            tracks: n(loss.tracks),
            items: n(loss.items ?? 0),
            name: target,
          })}
        </span>
      </span>
    </li>
  );
}

function Report({ outcome, pathPending }: { outcome: ConvertOutcome; pathPending: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [undone, setUndone] = useState<string | null>(null);
  if (outcome.status === "failed")
    return (
      <div role="status" className="rounded-md border border-danger bg-surface-1 p-3 text-danger">
        {t("convert.failed", { error: describeFailure(outcome) })}
      </div>
    );
  if (outcome.status === "cancelled")
    return (
      <div role="status" className="text-text-2">
        {t("convert.cancelled")}
      </div>
    );
  const r = outcome.result;
  const from = TITLE[r.source];
  const to = TITLE[r.target];
  const n = (v: number) => formatCount(v, i18n.language);
  const imp = r.importReport;
  const found = Object.values(imp.matched).reduce((a, b) => a + b, 0) + (imp.added ?? 0);
  const batchId = imp.batchId;
  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface-1 p-4">
      <div role="status" className="flex flex-col gap-1">
        <h3 className="font-medium">
          {r.simulated ? t("convert.plannedTitle") : t("convert.doneTitle", { name: to })}
        </h3>
        <ol className="flex flex-col gap-1 text-control text-text-2">
          <li className="flex gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-primary-soft font-mono text-[11px] text-text">
              1
            </span>
            <span>
              {t("convert.stepImport", {
                name: from,
                count: imp.tracks,
                tracks: n(imp.tracks),
                found: n(found),
              })}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-primary-soft font-mono text-[11px] text-text">
              2
            </span>
            <span>
              {t(r.simulated ? "convert.stepExportWould" : "convert.stepExport", {
                name: to,
                count: r.exportResult.tracks,
                tracks: n(r.exportResult.tracks),
                cues: n(r.exportResult.cues),
                playlists: n(r.exportResult.playlists),
              })}
            </span>
          </li>
        </ol>
      </div>
      <section aria-label={t("convert.lossesTitle", { name: to })} className="flex flex-col gap-2">
        <h4 className="text-label uppercase text-text-3">
          {t("convert.lossesTitle", { name: to })}
        </h4>
        {r.losses.length === 0 ? (
          <StatusLine tone="ok">{t("convert.nothingLost", { name: to })}</StatusLine>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {r.losses.map((loss) => (
              <Loss key={loss.code} loss={loss} target={to} />
            ))}
          </ul>
        )}
      </section>
      <ResultPanel
        outcome={{ status: "done", result: r.exportResult }}
        pathPending={pathPending}
        embedded
        pendingNote={t("convert.pathAtGo", { name: to })}
      />
      {!r.simulated && batchId && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-2">
          {undone === batchId ? (
            <span>{t("convert.undone", { name: to })}</span>
          ) : (
            <>
              <span>🛟 {t("convert.undoHint", { name: to })}</span>
              <button
                type="button"
                onClick={() =>
                  void undoImport(batchId, t, () => {
                    setUndone(batchId);
                    for (const key of [["library"], ["track"], ["playlists"], ["import"]])
                      void qc.invalidateQueries({ queryKey: key });
                  })
                }
                className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 text-text hover:border-border-strong"
              >
                <Undo2 size={14} strokeWidth={1.5} />
                {t("convert.undo")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function useTargetStatus(target: ImportSource) {
  return useQuery({
    queryKey: ["export", isCollection(target) ? STATUS_METHOD[target] : "none"],
    queryFn: () => (isCollection(target) ? request(STATUS_METHOD[target]) : null),
    enabled: isCollection(target),
    refetchInterval: 5000,
  });
}

export function ConvertPanel() {
  const { t, i18n } = useTranslation();
  const [source, setSourceState] = useState<ImportSource>(() =>
    loadProgram(KEY.source, "rekordbox"),
  );
  const [target, setTargetState] = useState<ImportSource>(() => {
    const stored = loadProgram(KEY.target, "traktor");
    return stored === source ? (source === "traktor" ? "rekordbox" : "traktor") : stored;
  });
  // Choosing the program on the other side swaps them (the two must differ).
  const setSource = (next: ImportSource) => {
    if (next === target) {
      setTargetState(source);
      store(KEY.target, source);
    }
    setSourceState(next);
    store(KEY.source, next);
  };
  const setTarget = (next: ImportSource) => {
    if (next === source) {
      setSourceState(target);
      store(KEY.source, target);
    }
    setTargetState(next);
    store(KEY.target, next);
  };
  const detected = useQuery({
    queryKey: ["import", "detect"],
    queryFn: () => request("import.detect"),
    refetchInterval: 5000,
  }).data?.sources.find((s) => s.source === source);
  const targetStatus = useTargetStatus(target).data ?? null;
  const [paths, setPaths] = useState<Record<string, string | null>>({});
  const chosenSource = paths[`from.${source}`] ?? load(KEY.sourcePath(source));
  const chosenTarget = paths[`to.${target}`] ?? load(KEY.targetPath(target));
  const sourcePath = chosenSource ?? detected?.path ?? null;
  const targetPath =
    target === "serato" ? null : (chosenTarget ?? targetStatus?.collectionPath ?? null);
  const [wins, setWins] = useState<Wins>("take");
  const [playlists, setPlaylists] = useState(true);
  const [addMissing, setAddMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const running = useConvertJobs((s) => s.running);
  const outcome = useConvertJobs((s) => s.outcome);
  const from = TITLE[source];
  const to = TITLE[target];

  const options: ConvertOptions = {
    source,
    target,
    sourcePath,
    targetPath,
    policy: policyOf(wins),
    pathMaps: null,
    playlists,
    addMissing,
    language: i18n.language.startsWith("es") ? "es" : "en",
  };
  const planned =
    outcome?.status === "done" && outcome.result.simulated && sameConvert(outcome.options, options);
  const done =
    outcome?.status === "done" &&
    !outcome.result.simulated &&
    sameConvert(outcome.options, options);
  const shown = outcome && (planned || done || (outcome.status !== "done" && !running));
  const targetOpen = isCollection(target) && (targetStatus?.running ?? false);
  const busy = running != null;

  const chooseSource = async () => {
    const picked = await open(
      source === "serato"
        ? { directory: true, title: t("djImport.chooseFolder") }
        : {
            multiple: false,
            title: t("djImport.chooseFile", { file: t(`djImport.${source}.file`) }),
            filters: [
              {
                name: t(`djImport.${source}.file`),
                extensions: [source === "traktor" ? "nml" : source === "engine_dj" ? "db" : "xml"],
              },
            ],
          },
    );
    if (typeof picked !== "string") return;
    setPaths((p) => ({ ...p, [`from.${source}`]: picked }));
    store(KEY.sourcePath(source), picked);
  };

  const chooseTarget = async (): Promise<string | null> => {
    const ext = target === "traktor" ? "nml" : target === "engine_dj" ? "db" : "xml";
    const file = target === "rekordbox" ? "rekordbox.xml" : t(`djImport.${target}.file`);
    const filters = [{ name: file, extensions: [ext] }];
    const picked =
      target === "rekordbox"
        ? await save({ defaultPath: targetPath ?? "rekordbox.xml", filters })
        : await open({ multiple: false, filters, title: t("export.chooseCollection", { file }) });
    if (typeof picked !== "string") return null;
    setPaths((p) => ({ ...p, [`to.${target}`]: picked }));
    store(KEY.targetPath(target), picked);
    return picked;
  };

  const run = async (simulate: boolean, withTarget: string | null = targetPath) => {
    try {
      await startConvert({ ...options, targetPath: withTarget }, simulate);
    } catch (err) {
      useToastStore.getState().push({
        title: t("convert.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };

  const go = async () => {
    if (isCollection(target)) {
      setConfirming(true);
      return;
    }
    // Rekordbox: a new rekordbox.xml, where the DJ says (asked once, like Export).
    if (target === "rekordbox" && !targetPath) {
      const picked = await chooseTarget();
      if (picked) void run(false, picked);
      return;
    }
    void run(false);
  };

  const whyId = "convert-why";
  const reason = !sourcePath
    ? t("convert.needSource", { name: from })
    : isCollection(target) && !targetPath
      ? t("convert.needTarget", { name: to })
      : targetOpen
        ? t("convert.targetOpen", { name: to })
        : planned
          ? null
          : t(done ? "convert.needPlanAgain" : "convert.needPlan");
  const canPlan = sourcePath != null && !(isCollection(target) && !targetPath);

  return (
    <section
      id="export-panel-convert"
      aria-label={t("convert.title")}
      className="flex max-w-[880px] flex-col gap-5 rounded-md border border-border bg-surface-2 p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-title">{t("convert.title")}</h2>
        <p className="text-body text-text-2">{t("convert.description")}</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <ProgramSelect label={t("convert.from")} value={source} onChange={setSource} />
        <ArrowRight aria-hidden size={16} strokeWidth={1.5} className="mb-2 text-text-3" />
        <ProgramSelect label={t("convert.to")} value={target} onChange={setTarget} />
      </div>
      <div className="flex flex-col gap-2">
        {detected?.running && (
          <StatusLine tone="warning">{t("djImport.running", { name: from })}</StatusLine>
        )}
        <PathRow
          label={from}
          path={sourcePath}
          empty={t("djImport.noPath")}
          onChoose={() => void chooseSource()}
        />
        {target === "serato" ? (
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-[72px] shrink-0 text-text-3">{to}</span>
            <span className="text-text-2">{t("convert.seratoTarget")}</span>
          </div>
        ) : (
          <PathRow
            label={to}
            path={targetPath}
            empty={t(target === "rekordbox" ? "convert.rekordboxTarget" : "export.noDestination")}
            onChoose={() => void chooseTarget()}
          />
        )}
        {targetOpen && (
          <StatusLine tone="warning">{t(`convert.running.${target}`, { name: to })}</StatusLine>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-label uppercase text-text-3">{t("convert.wins")}</span>
        <Segmented<Wins>
          size="sm"
          label={t("convert.wins")}
          value={wins}
          onChange={setWins}
          options={[
            { value: "take", label: t("convert.winsTake", { name: from }) },
            { value: "fill", label: t("convert.winsFill") },
          ]}
        />
        <p className="text-[12px] text-text-3">
          {t(wins === "take" ? "convert.winsTakeHint" : "convert.winsFillHint", { name: from })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Check
          checked={playlists}
          onChange={setPlaylists}
          label={t("convert.playlists")}
          hint={t(target === "rekordbox" ? "convert.playlistsHintXml" : "convert.playlistsHint", {
            name: to,
          })}
        />
        <Check
          checked={addMissing}
          onChange={setAddMissing}
          label={t("djImport.addMissing")}
          hint={t("djImport.addMissingHint")}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {reason && (
          <span id={whyId} className="mr-auto text-[12px] text-text-3">
            {reason}
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          aria-disabled={!canPlan || undefined}
          aria-describedby={!canPlan ? whyId : undefined}
          onClick={() => {
            if (canPlan) void run(true);
          }}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:border-border"
        >
          {running?.simulate && (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          )}
          {t("convert.plan")}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-disabled={reason != null || undefined}
          aria-describedby={reason ? whyId : undefined}
          onClick={() => {
            if (!reason) void go();
          }}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-primary"
        >
          {running && !running.simulate ? (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          ) : (
            <ArrowRight size={14} strokeWidth={1.5} />
          )}
          {t("convert.go", { name: to })}
        </button>
      </div>
      {shown && outcome && (
        <Report outcome={outcome} pathPending={target === "rekordbox" && !targetPath} />
      )}
      {outcome?.status === "done" && !planned && !done && !running && (
        <p className="text-[12px] text-text-3">{t("convert.stale")}</p>
      )}
      {target === "rekordbox" && done && <RekordboxGuide />}
      <p className="text-[12px] text-text-2">🛟 {t("convert.safety", { from, to })}</p>
      {confirming && targetPath && (
        <Modal
          label={t("export.confirmTitle", { name: to })}
          onClose={() => setConfirming(false)}
          width={460}
        >
          <div className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-title">{t("export.confirmTitle", { name: to })}</h2>
            <p className="text-body text-text-2">{t("export.confirmText", { name: to })}</p>
            <p className="break-all font-mono text-[12px] text-text-3">{targetPath}</p>
            <p className="text-body text-text-2">🛟 {t("export.confirmBackup")}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
              >
                {t("edit.cancel")}
              </button>
              <button
                type="button"
                data-autofocus
                onClick={() => {
                  setConfirming(false);
                  void run(false);
                }}
                className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
              >
                {t("convert.go", { name: to })}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
