import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./components/Sidebar";
import { useEngineStatus } from "./features/engine/useEngineStatus";
import { type ListParams, startImport, useLibraryTotal } from "./features/library/api";
import { DropOverlay } from "./features/library/DropOverlay";
import { useImportStore } from "./features/library/importStore";
import { type LibraryScope, LibraryView } from "./features/library/LibraryView";
import { useFileDrop } from "./features/library/useFileDrop";
import { useLibraryEvents } from "./features/library/useLibraryEvents";
import { WelcomeScreen } from "./features/library/WelcomeScreen";
import { useViewStore } from "./features/navigation/viewStore";
import { DragLayer } from "./features/playlists/DragLayer";
import { GuidesView } from "./features/guides/GuidesView";
import { FavoriteExportDialog } from "./features/favorites/FavoriteExportDialog";
import { FavoritesView } from "./features/favorites/FavoritesView";
import { ExportStemsDialog } from "./features/stems/ExportStemsDialog";
import { ModelDownloadDialog } from "./features/stems/StemsUi";
import { ExportView } from "./features/export/ExportView";
import { ProView } from "./features/decks/ProView";
import { SettingsView } from "./features/settings/SettingsView";
import { TagsView } from "./features/tags/TagsView";
import { TrackInfoPanel } from "./features/track-info/TrackInfoPanel";
import { TrackDetailView } from "./features/track-detail/TrackDetailView";
import { Toaster } from "./features/toast/Toaster";
import { useToastStore } from "./features/toast/toastStore";
import { loadTheme, saveTheme, type Theme } from "./lib/theme";

const ALL_TRACKS: ListParams = { search: null, sort: "added_at", descending: true };

function homeScope(back: string): LibraryScope {
  return back === "review" || back === "playlist" ? back : "all";
}

export default function App() {
  const { t } = useTranslation();
  const { status, retry } = useEngineStatus();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const view = useViewStore((s) => s.view);
  const detailId = useViewStore((s) => s.trackId);
  const back = useViewStore((s) => s.back);
  const closeDetail = useViewStore((s) => s.closeDetail);
  const tagTrackIds = useViewStore((s) => s.tagTrackIds);
  const infoTrackId = useViewStore((s) => s.infoTrackId);
  const closeInfo = useViewStore((s) => s.closeInfo);
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
            {view === "tags" ? (
              <TagsView trackIds={tagTrackIds} onBack={closeDetail} />
            ) : view === "detail" && detailId != null ? (
              <TrackDetailView key={detailId} trackId={detailId} onBack={closeDetail} />
            ) : view === "export" ? (
              <ExportView />
            ) : view === "pro" ? (
              <ProView />
            ) : view === "favorites" ? (
              <FavoritesView />
            ) : view === "guides" ? (
              <GuidesView />
            ) : view === "settings" ? (
              <SettingsView theme={theme} onThemeChange={changeTheme} />
            ) : (
              <LibraryView
                scope={
                  view === "review" || view === "playlist"
                    ? view
                    : view === "detail"
                      ? homeScope(back)
                      : "all"
                }
                onAddMusic={() => void chooseFolder()}
              />
            )}
          </main>
          {infoTrackId != null && (
            <TrackInfoPanel key={infoTrackId} trackId={infoTrackId} onClose={closeInfo} />
          )}
          <DragLayer />
          <ModelDownloadDialog />
          <ExportStemsDialog />
          <FavoriteExportDialog />
          {dragging && <DropOverlay />}
        </>
      )}
      <Toaster />
    </div>
  );
}
