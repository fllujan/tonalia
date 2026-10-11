import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useImportStore } from "./features/library/importStore";
import { useLibraryStore } from "./features/library/store";
import { useToastStore } from "./features/toast/toastStore";
import i18n from "./i18n";
import {
  calls,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "./test/fakeEngine";

const openDialog = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { method: string; params: unknown }) => invoke(cmd, args),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (ev: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (ev: { payload: unknown }) => void) => {
      listeners.set("drag-drop", cb);
      return Promise.resolve(() => listeners.delete("drag-drop"));
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => openDialog(...a) }));

beforeEach(async () => {
  resetEngine();
  openDialog.mockReset();
  useLibraryStore.setState({
    search: "",
    sort: "added_at",
    descending: true,
    density: "comfortable",
  });
  useImportStore.setState({ jobId: null, stage: null, done: 0, total: 0, percent: 0 });
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("es");
});

/** Data row `i` (1-based; row 0 is the header). */
function rowAt(i: number): HTMLElement {
  const row = screen.getAllByRole("row")[i];
  if (!row) throw new Error(`no row ${i}`);
  return row;
}

describe("first run", () => {
  it("shows the welcome screen when the library is empty", async () => {
    renderWithQuery(<App />);
    expect(
      await screen.findByRole("heading", { name: "Bienvenido a Tonalia" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Arrastra aquí tu carpeta de música")).toBeInTheDocument();
  });

  it("imports the folder chosen in the dialog", async () => {
    openDialog.mockResolvedValue(["/Users/dj/Música 🎧"]);
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Elegir carpeta…" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "library.addPaths",
        params: { paths: ["/Users/dj/Música 🎧"] },
      }),
    );
    expect(useImportStore.getState().jobId).toBe("job-1");
  });

  it("imports files dropped on the window", async () => {
    renderWithQuery(<App />);
    await screen.findByRole("heading", { name: "Bienvenido a Tonalia" });
    await waitFor(() => expect(listeners.has("drag-drop")).toBe(true));
    act(() => emit("drag-drop", { type: "drop", paths: ["/música/a.flac", "/música/b.mp3"] }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "library.addPaths",
        params: { paths: ["/música/a.flac", "/música/b.mp3"] },
      }),
    );
  });
});

describe("library", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, { title: "Midnight Bloom", addedAt: "2026-10-01T10:00:00Z", status: "ready" }),
      track(2, { title: "Golden Hour Tide", artist: "Sora Vela", addedAt: "2026-10-02T10:00:00Z" }),
      track(3, {
        title: null,
        path: "/Users/dj/Música/Neon Cathedral.flac",
        addedAt: "2026-10-03T10:00:00Z",
        status: "error",
        error: "cannot read Neon Cathedral.flac",
      }),
    ];
  });

  it("lists tracks with count, file-name fallback and status", async () => {
    renderWithQuery(<App />);
    expect(await screen.findByText("3 temas")).toBeInTheDocument();
    const rows = await screen.findAllByRole("row");
    // header + 3 rows, newest first
    expect(rows).toHaveLength(4);
    expect(within(rowAt(1)).getByText("Neon Cathedral")).toBeInTheDocument();
    expect(within(rowAt(1)).getByTitle("cannot read Neon Cathedral.flac")).toBeInTheDocument();
    expect(within(rowAt(3)).getByText("Midnight Bloom")).toBeInTheDocument();
    expect(within(rowAt(3)).getByLabelText("Analizado")).toBeInTheDocument();
    expect(within(rowAt(3)).getByText("6:12")).toBeInTheDocument();
    expect(screen.getByText("Motor listo")).toBeInTheDocument();
  });

  it("sorts by a column header and toggles direction", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    const header = screen.getByRole("columnheader", { name: "Título" });
    await userEvent.click(header);
    await waitFor(() => expect(within(rowAt(1)).getByText("Golden Hour Tide")).toBeInTheDocument());
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("searches and offers to clear when nothing matches", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    const box = screen.getByRole("searchbox", { name: "Buscar título, artista, álbum…" });
    await userEvent.type(box, "sora");
    expect(await screen.findByText("1 tema")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "zzz");
    expect(await screen.findByText("Ningún tema coincide")).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Borrar búsqueda" }).at(-1) as HTMLElement,
    );
    expect(await screen.findByText("3 temas")).toBeInTheDocument();
  });

  it("focuses search with the keyboard shortcut", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.keyboard("{Control>}f{/Control}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("shows import progress and a summary toast when done", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await waitFor(() => expect(listeners.has("engine://progress")).toBe(true));
    act(() => useImportStore.getState().start("job-9"));
    act(() =>
      emit("engine://progress", {
        jobId: "job-9",
        stage: "importing",
        percent: 50,
        done: 500,
        total: 1000,
      }),
    );
    expect(await screen.findByText("Importando 500 de 1000")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    act(() =>
      emit("engine://event", {
        type: "job.finished",
        payload: {
          jobId: "job-9",
          kind: "library.addPaths",
          status: "done",
          result: {
            added: 998,
            updated: 0,
            moved: 1,
            unchanged: 0,
            duplicates: 0,
            failed: [{ path: "x", reason: "y" }],
          },
          error: null,
        },
      }),
    );
    expect(await screen.findByText("Importación completa")).toBeInTheDocument();
    expect(screen.getByText("998 añadidos · 1 reubicado · 1 con error")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("cancels a running import", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    act(() => useImportStore.getState().start("job-5"));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(calls).toContainEqual({ method: "job.cancel", params: { jobId: "job-5" } });
  });

  it("switches row density", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("radio", { name: "Filas compactas" }));
    expect(useLibraryStore.getState().density).toBe("compact");
    expect(rowAt(1)).toHaveStyle({ height: "28px" });
  });

  it("renders in English", async () => {
    await i18n.changeLanguage("en");
    renderWithQuery(<App />);
    expect(await screen.findByText("3 tracks")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
  });
});

describe("engine down", () => {
  it("shows the library shell with a disconnected engine and retries", async () => {
    engine.connected = false;
    renderWithQuery(<App />);
    expect(await screen.findByText("Motor: desconectado")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bienvenido a Tonalia" })).not.toBeInTheDocument();
    engine.connected = true;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Motor listo")).toBeInTheDocument();
  });
});
