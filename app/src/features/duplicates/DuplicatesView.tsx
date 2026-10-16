// DESIGN 6.21 — duplicates (SPEC 13.3). "Search for duplicates" fingerprints what is
// missing and groups the library: identical files, the same audio in another encoding or
// with other tags, and other versions of a track. Each group proposes the copy to keep
// and says why; merging moves what the user made to it and removes the others from the
// library (to the system trash only when asked, per group) and can be undone.
import { useQueryClient } from "@tanstack/react-query";
import { AudioWaveform, CopyCheck, Files, GitBranch, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import { errorInfoOf, errorMessage } from "../../lib/errors";
import { formatCount, formatDate, formatDuration } from "../../lib/format";
import { request } from "../../lib/rpc";
import type { DuplicateGroup, DuplicateMember } from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import {
  duplicatesKey,
  resolveGroup,
  startScan,
  undoMerge,
  useDuplicateScan,
  useDuplicates,
} from "./api";

type Kind = DuplicateGroup["kind"];
type Filter = Kind | "all";
const KIND_ICON = { identical: Files, audio: AudioWaveform, version: GitBranch } as const;
const LOSSLESS = new Set(["flac", "wav", "aiff", "aif", "alac"]);

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of [duplicatesKey, libraryKeys.all, ["track"], ["playlists"], ["favorites"]])
      void qc.invalidateQueries({ queryKey: key });
  };
}

/** "MP3 · 128 kbps" or "FLAC" (data, in mono) and, for lossless, the word (in sans). */
function Quality({ m }: { m: DuplicateMember }) {
  const { t } = useTranslation();
  const format = (m.format ?? "?").toUpperCase();
  const lossless = LOSSLESS.has((m.format ?? "").toLowerCase());
  return (
    <span>
      <span className="font-mono">
        {format}
        {!lossless && m.bitrate ? ` · ${m.bitrate} kbps` : ""}
      </span>
      {lossless && <span> · {t("duplicates.lossless")}</span>}
    </span>
  );
}

function Member({
  member,
  group,
  chosen,
  onChoose,
}: {
  member: DuplicateMember;
  group: DuplicateGroup;
  chosen: boolean;
  onChoose: (() => void) | null;
}) {
  const { t, i18n } = useTranslation();
  const openDetail = useViewStore((s) => s.openDetail);
  const n = (v: number) => formatCount(v, i18n.language);
  const title = member.title ?? member.path.split(/[\\/]/).pop() ?? member.path;
  return (
    <li
      className={`flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 ${chosen ? "bg-primary-soft" : ""}`}
    >
      {onChoose && (
        <input
          type="radio"
          name={`keep-${group.groupId}`}
          checked={chosen}
          onChange={onChoose}
          aria-label={t("duplicates.keepThis", { title })}
          className="mt-1 size-4 accent-[var(--color-primary)]"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openDetail(member.trackId)}
            className="min-w-0 truncate text-left font-medium text-text hover:underline"
            title={title}
          >
            {title}
          </button>
          {member.trackId === group.proposed && group.kind !== "version" && (
            <span className="shrink-0 rounded-pill bg-surface-3 px-2 text-[11px] text-success">
              {t("duplicates.best")}
            </span>
          )}
        </div>
        {member.artist && <span className="truncate text-[12px] text-text-2">{member.artist}</span>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-2">
          <Quality m={member} />
          <span className="font-mono">{formatDuration(member.duration)}</span>
          <span>{t("duplicates.cues", { count: member.cues, n: n(member.cues) })}</span>
          <span>
            {t("duplicates.playlists", { count: member.playlists, n: n(member.playlists) })}
          </span>
          {member.qualityIssues > 0 && (
            <span className="text-warning">
              {t("duplicates.issues", { count: member.qualityIssues, n: n(member.qualityIssues) })}
            </span>
          )}
        </div>
        <span className="truncate font-mono text-[11px] text-text-3" title={member.path}>
          {member.path}
        </span>
      </div>
    </li>
  );
}

function Group({ group }: { group: DuplicateGroup }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [keep, setKeep] = useState(group.proposed);
  const [trash, setTrash] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = KIND_ICON[group.kind];
  const mergeable = group.kind !== "version";
  const kept = group.members.find((m) => m.trackId === keep) ?? group.members[0];
  const keptTitle = kept?.title ?? kept?.path ?? "";
  const others = group.members.length - 1;

  const act = async (action: "keep_all" | "distinct" | "merge") => {
    setBusy(true);
    try {
      const out = await resolveGroup({
        groupId: group.groupId,
        action,
        ...(action === "merge" ? { keepTrackId: keep, trash } : {}),
      });
      invalidate();
      const push = useToastStore.getState().push;
      if (action !== "merge") {
        push({ title: t(`duplicates.done.${action}`), tone: "success" });
        return;
      }
      const mergeId = out.mergeId;
      const failed = out.trashFailed ?? [];
      push({
        title: t("duplicates.done.merge", { title: keptTitle, count: out.removed }),
        ...(failed.length > 0
          ? { detail: t("duplicates.trashFailed", { count: failed.length }) }
          : {}),
        tone: failed.length > 0 ? "warning" : "success",
        ...(mergeId && !out.trashed
          ? {
              action: {
                label: t("duplicates.undo"),
                run: () =>
                  void undoMerge(mergeId)
                    .then(() => {
                      invalidate();
                      push({ title: t("duplicates.undone"), tone: "success" });
                    })
                    .catch((err: unknown) =>
                      push({
                        title:
                          errorInfoOf(err)?.reason === "undo_changed"
                            ? t("duplicates.undoChanged")
                            : t("duplicates.undoFailed", { error: errorMessage(err) }),
                        tone: "danger",
                      }),
                    ),
              },
            }
          : {}),
      });
    } catch (err) {
      useToastStore.getState().push({
        title: t("duplicates.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const reason = t(`duplicates.reasons.${group.reason}`, {
    best: group.reasonBest ?? "",
    other: group.reasonOther ?? "",
  });

  return (
    <section
      aria-label={t(`duplicates.kinds.${group.kind}`) + ": " + (group.members[0]?.title ?? "")}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4"
    >
      <header className="flex items-start gap-3">
        <span className="flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-3 px-2 py-0.5 text-[12px] text-text">
          <Icon aria-hidden size={14} strokeWidth={1.5} className="text-primary-ink" />
          {t(`duplicates.kinds.${group.kind}`)}
        </span>
        <span className="min-w-0 flex-1 text-[12px] text-text-3">
          {t(`duplicates.kindHints.${group.kind}`)}
        </span>
        <span className="shrink-0 text-[12px] text-text-2">
          {t(group.kind === "version" ? "duplicates.versions" : "duplicates.copies", {
            count: group.members.length,
          })}
        </span>
      </header>
      <ul className="flex flex-col overflow-hidden rounded-sm border border-border">
        {group.members.map((m) => (
          <Member
            key={m.trackId}
            member={m}
            group={group}
            chosen={mergeable && m.trackId === keep}
            onChoose={mergeable ? () => setKeep(m.trackId) : null}
          />
        ))}
      </ul>
      {mergeable && (
        <p className="text-[12px] text-text-2">
          <span className="text-text-3">{t("duplicates.why")}</span> {reason}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {mergeable && (
          <label className="mr-auto flex items-center gap-2 text-[12px] text-text-2">
            <input
              type="checkbox"
              checked={trash}
              onChange={(e) => setTrash(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
            />
            {t("duplicates.trash", { count: others })}
          </label>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("distinct")}
          className="h-8 rounded-sm px-3 text-text-2 hover:bg-surface-3 hover:text-text disabled:opacity-40"
        >
          {t("duplicates.distinct")}
        </button>
        {mergeable && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("keep_all")}
              className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
            >
              {t("duplicates.keepAll")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              <CopyCheck size={14} strokeWidth={1.5} />
              {t("duplicates.merge")}
            </button>
          </>
        )}
      </div>
      {confirming && (
        <Modal
          label={t("duplicates.confirmTitle", { title: keptTitle })}
          onClose={() => setConfirming(false)}
          width={480}
        >
          <div className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-title">
              {t("duplicates.confirmTitle", { title: keptTitle })}
            </h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-text-2">
              <li>{t("duplicates.confirmMoves")}</li>
              <li className={trash ? "text-warning" : ""}>
                {t(trash ? "duplicates.confirmTrash" : "duplicates.confirmRemove", {
                  count: others,
                })}
              </li>
            </ul>
            <p className="text-body text-text-2">
              🛟 {t(trash ? "duplicates.confirmNoUndo" : "duplicates.confirmUndo")}
            </p>
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
                  void act("merge");
                }}
                className={`h-8 rounded-sm px-3 font-semibold text-white ${trash ? "bg-danger-fill" : "bg-primary hover:bg-primary-hover"}`}
              >
                {t(trash ? "duplicates.confirmGoTrash" : "duplicates.confirmGo")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function DuplicatesView() {
  const { t, i18n } = useTranslation();
  const list = useDuplicates().data;
  const running = useDuplicateScan((s) => s.running);
  const [filter, setFilter] = useState<Filter>("all");
  const groups = list?.groups ?? [];
  const shown = filter === "all" ? groups : groups.filter((g) => g.kind === filter);
  const n = (v: number) => formatCount(v, i18n.language);

  const scan = () =>
    void startScan().catch((err: unknown) =>
      useToastStore.getState().push({
        title: t("duplicates.scanFailed", { error: errorMessage(err) }),
        tone: "danger",
      }),
    );
  const cancel = () => {
    if (running) void request("job.cancel", { jobId: running.jobId }).catch(() => undefined);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("duplicates.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("duplicates.title")}</h1>
        <span className="text-[12px] text-text-3">
          {t("duplicates.groups", { count: groups.length, n: n(groups.length) })}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {groups.length > 0 && (
            <Segmented<Filter>
              size="sm"
              label={t("duplicates.filter")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: t("duplicates.all") },
                { value: "identical", label: t("duplicates.kinds.identical") },
                { value: "audio", label: t("duplicates.kinds.audio") },
                { value: "version", label: t("duplicates.kinds.version") },
              ]}
            />
          )}
          {(list?.lastScan || running) && (
            <button
              type="button"
              disabled={running != null}
              onClick={scan}
              className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {running ? (
                <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
              ) : (
                <Search size={14} strokeWidth={1.5} />
              )}
              {t("duplicates.scan")}
            </button>
          )}
        </div>
      </header>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-5 py-2 text-[12px] text-text-3">
        {running ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-text-2">
                {t(
                  `duplicates.stages.${running.stage === "grouping" ? "grouping" : "fingerprints"}`,
                )}
              </span>
              <span className="font-mono">{Math.round(running.percent)} %</span>
              <button
                type="button"
                onClick={cancel}
                className="ml-auto h-6 rounded-sm px-2 text-text-2 hover:bg-surface-3"
              >
                {t("import.cancel")}
              </button>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-pill bg-surface-3"
              role="progressbar"
              aria-label={t("duplicates.scan")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(running.percent)}
            >
              <div
                className="h-full rounded-pill bg-aurora transition-[width] duration-panel"
                style={{ width: `${running.percent}%` }}
              />
            </div>
          </>
        ) : (
          <span>
            {list?.lastScan
              ? t("duplicates.lastScan", {
                  date: formatDate(list.lastScan, i18n.language),
                  done: n(list.fingerprinted),
                  total: n(list.tracks),
                })
              : t("duplicates.neverScanned")}
            {list &&
              list.resolved > 0 &&
              ` · ${t("duplicates.resolved", { count: list.resolved })}`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {!list?.lastScan && !running ? (
          <EmptyState
            icon={CopyCheck}
            title={t("duplicates.emptyNever")}
            text={t("duplicates.emptyNeverText")}
            action={
              <button
                type="button"
                onClick={scan}
                className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
              >
                {t("duplicates.scan")}
              </button>
            }
          />
        ) : shown.length === 0 && !running ? (
          <EmptyState
            icon={CopyCheck}
            title={t("duplicates.emptyNone")}
            text={t("duplicates.emptyNoneText")}
          />
        ) : (
          <div className="flex max-w-[960px] flex-col gap-4">
            {shown.map((g) => (
              <Group key={g.groupId} group={g} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
