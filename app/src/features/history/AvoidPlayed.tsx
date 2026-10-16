// "Avoid tracks played in the last N days" (SPEC 13.4), shared by the set builder and the
// Pro idea filter: one setting (`historyAvoidDays`, 0 = off), so both leave out the same.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import { useUpdateSettings } from "../settings/api";
import { useAvoidPlayedDays } from "./api";

const DAYS_KEY = "tonalia.history.avoidDays";
const DEFAULT_DAYS = 30;

/** The last number of days chosen, so turning it off and on keeps it. */
function rememberedDays(): number {
  try {
    const n = Number(localStorage.getItem(DAYS_KEY));
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_DAYS;
  } catch {
    return DEFAULT_DAYS;
  }
}

function remember(days: number) {
  try {
    localStorage.setItem(DAYS_KEY, String(days));
  } catch {
    // Not remembered: the next time it starts at 30 days.
  }
}

export function AvoidPlayed() {
  const { t } = useTranslation();
  const days = useAvoidPlayedDays();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const [draft, setDraft] = useState(() => String(days || rememberedDays()));
  const on = days > 0;
  const set = (value: number) => update.mutate({ historyAvoidDays: value });

  const commit = (text: string) => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      setDraft(String(days || rememberedDays()));
      return;
    }
    setDraft(String(n));
    remember(n);
    if (on) set(n);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Switch
        checked={on}
        onChange={(checked) => set(checked ? rememberedDays() : 0)}
        label={t("history.avoid")}
      />
      {on && (
        <label className="flex items-center gap-2 text-[12px] text-text-2">
          <span>{t("history.avoidLast")}</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(e.currentTarget.value);
            }}
            aria-label={t("history.avoidDays")}
            className="h-7 w-16 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text focus:border-primary"
          />
          <span>{t("history.avoidDaysUnit")}</span>
        </label>
      )}
    </div>
  );
}
