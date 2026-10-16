// "Mark as played" (SPEC 13.4): a selection, a playlist or a set goes into the history on
// a day (today by default), as a session of its own that can be forgotten again.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../lib/errors";
import { formatCount } from "../../lib/format";
import { useToastStore } from "../toast/toastStore";
import { deleteSession, invalidateHistory, markPlayed } from "./api";
import { type MarkTarget as Target, useMarkPlayed } from "./markPlayedStore";

/** Today as YYYY-MM-DD in local time (what an `<input type="date">` holds). */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Dialog({ target }: { target: Target }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const close = useMarkPlayed((s) => s.close);
  const [day, setDay] = useState(today);
  const [name, setName] = useState(target.name ?? "");
  const [busy, setBusy] = useState(false);
  const max = today();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= max;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const result = await markPlayed({
        trackIds: target.trackIds ?? [],
        playlistId: target.playlistId ?? null,
        playedAt: day,
        name: name.trim() || null,
      });
      invalidateHistory(qc);
      close();
      useToastStore.getState().push({
        title: t("history.marked", {
          count: result.plays,
          n: formatCount(result.plays, i18n.language),
        }),
        tone: "success",
        action: {
          label: t("history.undo"),
          run: () =>
            void deleteSession(result.sessionId)
              .then(() => invalidateHistory(qc))
              .catch((err: unknown) =>
                useToastStore.getState().push({
                  title: t("history.forgetFailed", { error: errorMessage(err) }),
                  tone: "danger",
                }),
              ),
        },
      });
    } catch (err) {
      useToastStore.getState().push({
        title: t("history.markFailed", { error: errorMessage(err) }),
        tone: "danger",
      });
      setBusy(false);
    }
  };

  return (
    <Modal label={t("history.markTitle")} onClose={close} width={440}>
      <form
        className="flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="font-display text-title">{t("history.markTitle")}</h2>
        <p className="text-text-2">
          {t("history.markText", {
            count: target.count,
            n: formatCount(target.count, i18n.language),
          })}
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-text-2">{t("history.markDay")}</span>
          <input
            type="date"
            value={day}
            max={max}
            data-autofocus
            onChange={(e) => setDay(e.target.value)}
            aria-invalid={!valid}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text focus:border-primary aria-[invalid=true]:border-danger"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-text-2">{t("history.markName")}</span>
          <input
            type="text"
            value={name}
            maxLength={200}
            placeholder={t("history.markNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            className="h-8 rounded-sm border border-border bg-surface-3 px-2 text-text focus:border-primary"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
          >
            {t("edit.cancel")}
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("history.markGo")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MarkPlayedDialog() {
  const target = useMarkPlayed((s) => s.target);
  return target ? <Dialog target={target} /> : null;
}
