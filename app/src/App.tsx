import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./components/Sidebar";
import { useEngineStatus } from "./features/engine/useEngineStatus";
import { type ListParams, startImport, useLibraryTotal } from "./features/library/api";
import { DropOverlay } from "./features/library/DropOverlay";
import { useImportStore } from "./features/library/importStore";
import { LibraryView } from "./features/library/LibraryView";
import { useFileDrop } from "./features/library/useFileDrop";
import { useLibraryEvents } from "./features/library/useLibraryEvents";
import { WelcomeScreen } from "./features/library/WelcomeScreen";
import { useViewStore } from "./features/navigation/viewStore";
import { SettingsView } from "./features/settings/SettingsView";
import { Toaster } from "./features/toast/Toaster";
import { useToastStore } from "./features/toast/toastStore";
import { loadTheme, saveTheme, type Theme } from "./lib/theme";

const ALL_TRACKS: ListParams = { search: null, sort: "added_at", descending: true };

export default function App() {
  const { t } = useTranslation();
  const { status, retry } = useEngineStatus();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const view = useViewStore((s) => s.view);
  useLibraryEvents();

  const importing = useImportStore((s) => s.jobId !== null);
  const library = useLibraryTotal(ALL_TRACKS);

  const importPaths = useCallback(
    (paths: string[]) => {
      startImport(paths).catch((err: unknown) =>
        useToastStore.getState().push({
          title: t("import.failed", { error: err instanceof Error ? err.message : String(err) }),
          tone: "danger",
        }),
      );
    },
    [t],
  );

  const chooseFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      title: t("welcome.chooseFolder"),
    });
    if (selected) importPaths(Array.isArray(selected) ? selected : [selected]);
  }, [importPaths, t]);

  const dragging = useFileDrop(importPaths);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  const showWelcome =
    status === "connected" &&
    !library.isLoading &&
    !library.isError &&
    library.total === 0 &&
    !importing;

  return (
    <div className="flex h-full bg-bg text-text">
      {showWelcome ? (
        <WelcomeScreen dragging={dragging} onChooseFolder={() => void chooseFolder()} />
      ) : (
        <>
          <Sidebar trackCount={library.total} engineStatus={status} onRetryEngine={retry} />
          <main className="flex min-w-0 flex-1 flex-col">
            {view === "settings" ? (
              <SettingsView theme={theme} onThemeChange={changeTheme} />
            ) : (
              <LibraryView onAddMusic={() => void chooseFolder()} />
            )}
          </main>
          {dragging && <DropOverlay />}
        </>
      )}
      <Toaster />
    </div>
  );
}
