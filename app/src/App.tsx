import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./components/Sidebar";
import { EngineBanner } from "./features/engine/EngineBanner";
import { ShortcutsDialog } from "./features/shortcuts/ShortcutsDialog";
import { useGlobalShortcuts } from "./features/shortcuts/useGlobalShortcuts";
import { useStoredSettings } from "./features/settings/api";
import { UpdateBanner } from "./features/updates/UpdateBanner";
import { useStartupUpdateCheck } from "./features/updates/useStartupUpdateCheck";
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
import { PlayerBar } from "./features/player/PlayerBar";
import { GuidesView } from "./features/guides/GuidesView";
import { FavoriteExportDialog } from "./features/favorites/FavoriteExportDialog";
import { FavoritesView } from "./features/favorites/FavoritesView";
import { BuilderView } from "./features/playlist-builder/BuilderView";
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
import { errorMessage } from "./lib/errors";

const ALL_TRACKS: ListParams = { search: null, sort: "added_at", descending: true };

function homeScope(back: string): LibraryScope {
  return back === "review" || back === "playlist" ? back : "all";
}

export default function App() {
  const { t } = useTranslation();
  const engine = useEngineStatus();
  const { status } = engine;
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
          title: t("import.failed", { error: errorMessage(err) }),
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

  useGlobalShortcuts(!showWelcome);
  // Waits for the stored settings so a check that was turned off never runs.
  const stored = useStoredSettings().data;
  useStartupUpdateCheck(status === "connected" && stored != null && stored.checkUpdates !== false);

  return (
    <div className="flex h-full bg-bg text-text">
      {showWelcome ? (
        <WelcomeScreen dragging={dragging} onChooseFolder={() => void chooseFolder()} />
      ) : (
        <>
          {/* Keyboard users skip the sidebar (SPEC 3). */}
          <a
            href="#main"
            className="sr-only z-50 rounded-sm bg-primary px-3 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
          >
            {t("nav.skipToContent")}
          </a>
          <Sidebar trackCount={library.total} engineStatus={status} />
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
            <EngineBanner {...engine} />
            <UpdateBanner />
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
            ) : view === "builder" ? (
              <BuilderView />
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
            <PlayerBar />
          </main>
          {infoTrackId != null && (
            <TrackInfoPanel key={infoTrackId} trackId={infoTrackId} onClose={closeInfo} />
          )}
          <DragLayer />
          <ModelDownloadDialog />
          <ExportStemsDialog />
          <FavoriteExportDialog />
          <ShortcutsDialog />
          {dragging && <DropOverlay />}
        </>
      )}
      <Toaster />
    </div>
  );
}
