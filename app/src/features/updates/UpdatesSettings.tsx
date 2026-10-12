// Settings → Updates (DESIGN 6.13): the start-up check switch and "Check now".
import { useTranslation } from "react-i18next";
import { Switch } from "../../components/Switch";
import { APP_VERSION } from "../../lib/system";
import { useSettings, useUpdateSettings } from "../settings/api";
import { useUpdateStore } from "./updateStore";

export function UpdatesSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const { status, version, error, checkNow, install } = useUpdateStore();
  const result =
    status === "checking"
      ? t("updates.checking")
      : status === "latest"
        ? t("updates.latest", { version: APP_VERSION })
        : status === "available" && version
          ? t("updates.available", { version })
          : status === "error"
            ? t("updates.checkFailed", { error })
            : null;
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Switch
          label={t("updates.auto")}
          checked={settings.checkUpdates ?? true}
          onChange={(checkUpdates) => update.mutate({ checkUpdates })}
        />
        <p className="text-control text-text-3">{t("updates.privacy")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={status === "checking" || status === "downloading" || status === "installing"}
          onClick={() => void checkNow()}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
        >
          {t("updates.checkNow")}
        </button>
        {status === "available" && (
          <button
            type="button"
            onClick={() => void install()}
            className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
          >
            {t("updates.install")}
          </button>
        )}
        {result && (
          <span role="status" className="text-control text-text-2">
            {result}
          </span>
        )}
      </div>
      <p className="font-mono text-control text-text-3">
        {t("settings.version", { version: APP_VERSION })}
      </p>
    </div>
  );
}
