// DESIGN 6.13 "Carpetas vigiladas": new tracks in these folders are imported and
// analysed automatically (the engine checks them every 30 s).
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings, useUpdateSettings } from "./api";

export function WatchedFolders() {
  const { t } = useTranslation();
  const { watchedFolders } = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));

  const add = async () => {
    const picked = await open({ directory: true, multiple: true, title: t("watch.add") });
    if (!picked) return;
    const chosen = Array.isArray(picked) ? picked : [picked];
    const next = [...watchedFolders, ...chosen.filter((f) => !watchedFolders.includes(f))];
    if (next.length !== watchedFolders.length) update.mutate({ watchedFolders: next });
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <div>
        <h2 className="text-section">{t("watch.title")}</h2>
        <p className="max-w-[68ch] text-control text-text-2">{t("watch.hint")}</p>
      </div>
      {watchedFolders.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface-2">
          {watchedFolders.map((folder) => (
            <li key={folder} className="flex items-center gap-3 px-3 py-2">
              <FolderOpen
                aria-hidden
                size={16}
                strokeWidth={1.5}
                className="shrink-0 text-text-3"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                aria-label={t("watch.remove", { folder })}
                onClick={() =>
                  update.mutate({ watchedFolders: watchedFolders.filter((f) => f !== folder) })
                }
                className="grid size-7 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-text-3">
          {t("watch.empty")}
        </p>
      )}
      <button
        type="button"
        onClick={() => void add()}
        className="flex h-8 items-center gap-1.5 self-start rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
      >
        <FolderPlus size={16} strokeWidth={1.5} />
        {t("watch.add")}
      </button>
    </div>
  );
}
