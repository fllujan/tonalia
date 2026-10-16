// DESIGN 6.22 — play history (SPEC 13.4). The sessions each DJ program kept (imported on
// request, read-only) and the sets marked by hand, newest first; each opens as a
// read-only list in the order it was played. Shortcuts make the two smart playlists the
// SPEC asks for ("Not played in 30 days", "Most played").
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  Download,
  FolderOpen,
  History,
  LoaderCircle,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { errorMessage, describeFailure } from "../../lib/errors";
import { formatCount } from "../../lib/format";
import type { PlaySession } from "../../lib/rpc.types";
import type { ImportSource } from "../dj-import/importJobs";
import { IMPORT_SOURCES } from "../dj-import/importJobs";
import { useViewStore } from "../navigation/viewStore";
import { libraryKeys } from "../library/api";
import { playlistApi } from "../playlists/api";
import { useToastStore } from "../toast/toastStore";
import {
  deleteSession,
  invalidateHistory,
  startHistoryImport,
  useHistory,
  useHistoryImport,
  useHistorySources,
} from "./api";
import { sessionDate, sessionSource } from "./sessionText";

const PATH_KEY = (source: ImportSource) => `tonalia.history.path.${source}`;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered: the next import asks again.
  }
}

/** One program in the import dialog: where its history is, Choose… and Import. */
function SourceRow({
  source,
  title,
  found,
}: {
  source: ImportSource;
  title: string;
  found: string | null;
}) {
  const { t } = useTranslation();
  const running = useHistoryImport((s) => s.running);
  const [chosen, setChosen] = useState<string | null>(() => stored(PATH_KEY(source)));
  const path = chosen ?? found;
  const busy = running?.source === source;

  const choose = async () => {
    const picked = await open(
      source === "rekordbox"
        ? {
            multiple: false,
            title: t("history.chooseFile"),
            filters: [{ name: "rekordbox.xml", extensions: ["xml"] }],
          }
        : { directory: true, title: t(`history.chooseFolder.${source}`) },
    );
    if (typeof picked !== "string") return;
    setChosen(picked);
    store(PATH_KEY(source), picked);
  };
  const run = () =>
    void startHistoryImport(source, chosen).catch((err: unknown) =>
      useToastStore.getState().push({
        title: t("history.importFailed", { error: errorMessage(err) }),
        tone: "danger",
      }),
    );

  return (
    <li className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-text">{title}</span>
        {path ? (
          <span className="truncate font-mono text-[11px] text-text-3" title={path}>
            {path}
          </span>
        ) : (
          <span className="text-[12px] text-text-3">{t(`history.where.${source}`)}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void choose()}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
      >
        <FolderOpen aria-hidden size={14} strokeWidth={1.5} />
        {path ? t("history.change") : t("history.choose")}
      </button>
      <button
        type="button"
        disabled={!path || running != null}
        onClick={run}
        aria-label={t("history.importFrom", { name: title })}
        className="flex h-8 w-[104px] shrink-0 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
      >
        {busy && <LoaderCircle aria-hidden size={14} className="motion-safe:animate-spin" />}
        {busy ? t("history.importing") : t("history.import")}
      </button>
    </li>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const sources = useHistorySources(true).data?.sources ?? [];
  const last = useHistoryImport((s) => s.outcome);
  const n = (v: number) => formatCount(v, i18n.language);
  const name = (source: ImportSource) =>
    IMPORT_SOURCES.find((s) => s.source === source)?.title ?? source;
  return (
    <Modal label={t("history.importTitle")} onClose={onClose} width={640}>
      <div className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-title">{t("history.importTitle")}</h2>
        <p className="text-text-2">{t("history.importIntro")}</p>
        <ul className="overflow-hidden rounded-md border border-border bg-surface-2">
          {IMPORT_SOURCES.map(({ source, title }) => (
            <SourceRow
              key={source}
              source={source}
              title={title}
              found={sources.find((s) => s.source === source)?.path ?? null}
            />
          ))}
        </ul>
        {last && last.outcome.status === "done" && (
          <div role="status" className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2">
            <span className="text-text">
              {t("history.resultLine", {
                name: name(last.source),
                sessions: n(last.outcome.result.sessions),
                count: last.outcome.result.sessions,
                plays: n(last.outcome.result.plays),
              })}
              {last.outcome.result.newSessions < last.outcome.result.sessions &&
                ` · ${t("history.resultUpdated", { count: last.outcome.result.sessions - last.outcome.result.newSessions })}`}
            </span>
            {last.outcome.result.unmatched > 0 && (
              <details className="text-[12px] text-warning">
                <summary className="cursor-pointer">
                  {t("history.importedUnmatched", { count: last.outcome.result.unmatched })}
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-text-3">
                  {(last.outcome.result.unmatchedPaths ?? []).map((p) => (
                    <li key={p} className="truncate" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(last.outcome.result.warnings ?? []).map((w, i) => (
              <span key={`${w.code}-${i}`} className="text-[12px] text-warning">
                {t(`history.warnings.${w.code}`)}
                {w.path ? ` · ${w.path.split(/[\\/]/).pop() ?? ""}` : ""}
              </span>
            ))}
          </div>
        )}
        {last && last.outcome.status === "failed" && (
          <p role="alert" className="text-[12px] text-danger">
            {t("history.importFailed", { error: describeFailure(last.outcome) })}
          </p>
        )}
        <p className="text-[12px] text-text-3">🛟 {t("history.readOnlyNote")}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
          >
            {t("history.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SessionRow({ session, onForget }: { session: PlaySession; onForget: () => void }) {
  const { t, i18n } = useTranslation();
  const openSession = useViewStore((s) => s.openSession);
  const date = sessionDate(session, i18n.language);
  return (
    <li className="group flex items-center border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => openSession(session.id)}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-surface-3"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-text">{session.name || date}</span>
          <span className="truncate text-[12px] text-text-2">
            {session.name ? `${date} · ` : ""}
            {sessionSource(session, t)}
          </span>
        </span>
        <span className="shrink-0 text-[12px] text-text-2">
          {t("history.tracks", {
            count: session.tracks,
            n: formatCount(session.tracks, i18n.language),
          })}
        </span>
        <ChevronRight aria-hidden size={16} strokeWidth={1.5} className="shrink-0 text-text-3" />
      </button>
      <button
        type="button"
        onClick={onForget}
        aria-label={t("history.forgetLabel", { name: session.name || date })}
        title={t("history.forget")}
        className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-sm text-text-3 opacity-0 hover:bg-surface-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 aria-hidden size={14} strokeWidth={1.5} />
      </button>
    </li>
  );
}

export function HistoryView() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const data = useHistory().data;
  const [importing, setImporting] = useState(false);
  const [forgetting, setForgetting] = useState<PlaySession | null>(null);
  const sessions = data?.sessions ?? [];
  const n = (v: number) => formatCount(v, i18n.language);

  const smart = async (name: string, filter: { notPlayedDays?: number; minPlays?: number }) => {
    try {
      const node = await playlistApi.create({
        name,
        emoji: filter.minPlays ? "🔁" : "🕰️",
        smart: filter,
      });
      await qc.invalidateQueries({ queryKey: libraryKeys.all });
      useViewStore.getState().openPlaylist(node.id);
    } catch (err) {
      useToastStore.getState().push({
        title: t("playlists.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };
  const forget = async (session: PlaySession) => {
    setForgetting(null);
    try {
      await deleteSession(session.id);
      invalidateHistory(qc);
      useToastStore.getState().push({ title: t("history.forgotten"), tone: "neutral" });
    } catch (err) {
      useToastStore.getState().push({
        title: t("history.forgetFailed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("history.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("history.title")}</h1>
        {data && data.total > 0 && (
          <span className="text-[12px] text-text-3">
            {t("history.summary", { count: data.total, n: n(data.total), plays: n(data.plays) })}
          </span>
        )}
        {sessions.length > 0 && (
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
          >
            <Download aria-hidden size={14} strokeWidth={1.5} />
            {t("history.importButton")}
          </button>
        )}
      </header>
      {sessions.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("history.emptyTitle")}
          text={t("history.emptyText")}
          action={
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
            >
              <Download aria-hidden size={14} strokeWidth={1.5} />
              {t("history.importButton")}
            </button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto flex max-w-[960px] flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-2">
              <WandSparkles aria-hidden size={14} strokeWidth={1.5} className="text-text-3" />
              <span>{t("history.smartHint")}</span>
              <button
                type="button"
                onClick={() => void smart(t("history.smartNotPlayed"), { notPlayedDays: 30 })}
                className="h-7 rounded-sm border border-border bg-surface-3 px-2.5 text-text hover:border-border-strong"
              >
                {t("history.smartNotPlayed")}
              </button>
              <button
                type="button"
                onClick={() => void smart(t("history.smartMost"), { minPlays: 5 })}
                className="h-7 rounded-sm border border-border bg-surface-3 px-2.5 text-text hover:border-border-strong"
              >
                {t("history.smartMost")}
              </button>
            </div>
            <ul
              aria-label={t("history.sessions")}
              className="overflow-hidden rounded-md border border-border bg-surface-2"
            >
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} onForget={() => setForgetting(s)} />
              ))}
            </ul>
            <p className="text-[12px] text-text-3">{t("history.markHint")}</p>
          </div>
        </div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {forgetting && (
        <Modal label={t("history.forgetTitle")} onClose={() => setForgetting(null)} width={440}>
          <div className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-title">{t("history.forgetTitle")}</h2>
            <p className="text-text-2">
              {t(forgetting.program ? "history.forgetImported" : "history.forgetManual", {
                count: forgetting.tracks,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForgetting(null)}
                className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
              >
                {t("edit.cancel")}
              </button>
              <button
                type="button"
                data-autofocus
                onClick={() => void forget(forgetting)}
                className="h-8 rounded-sm bg-danger-fill px-3 font-semibold text-white"
              >
                {t("history.forget")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
