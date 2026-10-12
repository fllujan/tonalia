import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useAnalysisStore } from "./features/library/analysisStore";
import { useImportStore } from "./features/library/importStore";
import { useLibraryStore } from "./features/library/store";
import { useViewStore } from "./features/navigation/viewStore";
import { useTagJobStore } from "./features/tags/tagJobStore";
import { useToastStore } from "./features/toast/toastStore";
import { closePlayer } from "./features/player/playerStore";
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
  closePlayer();
  resetEngine();
  openDialog.mockReset();
  useLibraryStore.setState({
    search: "",
    sort: "added_at",
    descending: true,
    density: "comfortable",
    selected: [],
    filter: {},
  });
  useImportStore.setState({ jobId: null, stage: null, done: 0, total: 0, percent: 0 });
  useAnalysisStore.setState({ jobId: null, done: 0, total: 0, percent: 0, stages: {} });
  useToastStore.setState({ toasts: [] });
  useViewStore.setState({ view: "library" });
  useTagJobStore.setState({ jobId: null, kind: null, done: 0, total: 0, percent: 0 });
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
    expect(
      within(rowAt(1)).getByTitle("No se puede leer «Neon Cathedral.flac»."),
    ).toBeInTheDocument();
    expect(within(rowAt(3)).getByText("Midnight Bloom")).toBeInTheDocument();
    expect(within(rowAt(3)).getByLabelText("Analizado")).toBeInTheDocument();
    expect(within(rowAt(3)).getByText("6:12")).toBeInTheDocument();
    expect(screen.getByText("Motor listo")).toBeInTheDocument();
  });

  it("sorts by a column header and toggles direction", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    const header = screen.getByRole("columnheader", { name: "Título" });
    // The header is a grid column header with a sort button inside.
    await userEvent.click(within(header).getByRole("button", { name: "Título" }));
    await waitFor(() => expect(within(rowAt(1)).getByText("Golden Hour Tide")).toBeInTheDocument());
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(header).getByRole("button", { name: "Título" }));
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

  it("shows analysis progress, cancels it and summarizes the result", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
    act(() =>
      emit("engine://event", { type: "job.started", payload: { jobId: "an-1", kind: "analysis" } }),
    );
    act(() =>
      emit("engine://progress", { jobId: "an-1", stage: "key", percent: 25, done: 85, total: 340 }),
    );
    expect(await screen.findByText("Analizando 85 de 340")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(calls).toContainEqual({ method: "job.cancel", params: { jobId: "an-1" } });
    act(() =>
      emit("engine://event", {
        type: "job.finished",
        payload: {
          jobId: "an-1",
          kind: "analysis",
          status: "done",
          result: { analyzed: 338, failed: 2, cancelled: 0 },
          error: null,
        },
      }),
    );
    expect(await screen.findByText("Análisis completo")).toBeInTheDocument();
    expect(screen.getByText("338 temas analizados · 2 con error")).toBeInTheDocument();
    expect(screen.queryByText("Analizando 85 de 340")).not.toBeInTheDocument();
  });

  it("shows each analysing track's stage as a ring with a percentage", async () => {
    engine.tracks = [track(1, { title: "Midnight Bloom", status: "analyzing" })];
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
    act(() =>
      emit("engine://event", { type: "job.started", payload: { jobId: "an-2", kind: "analysis" } }),
    );
    expect(screen.getByRole("img", { name: "Analizando" })).toBeInTheDocument();
    act(() =>
      emit("engine://progress", {
        jobId: "an-2",
        trackId: 1,
        stage: "tempo",
        percent: 0,
        done: 0,
        total: 1,
      }),
    );
    // Tempo is the third of seven stages: two are behind it.
    // (Spanish puts a no-break space before the percent sign.)
    expect(screen.getByRole("img", { name: /^Analizando · Tempo · 29\s%$/ })).toHaveTextContent(
      /^29\s%$/,
    );
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

describe("key and BPM", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, {
        title: "Midnight Bloom",
        status: "ready",
        keyRoot: 9,
        keyMode: "minor",
        keyConfidence: 0.92,
        bpm: 124,
        addedAt: "2026-10-02T10:00:00Z",
      }),
      track(2, {
        title: "Velvet Static",
        status: "ready",
        keyRoot: 6,
        keyMode: "minor",
        keyConfidence: 0.31,
        bpm: 122.456,
        addedAt: "2026-10-01T10:00:00Z",
      }),
    ];
  });

  it("shows key chips and BPM, flagging low confidence", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    expect(within(rowAt(1)).getByText("8A")).toBeInTheDocument();
    expect(within(rowAt(1)).getByText("124.00")).toBeInTheDocument();
    const low = within(rowAt(2)).getByText("11A");
    expect(low).toHaveAttribute("title", "11A · Confianza baja (31 %)");
    expect(within(rowAt(2)).getByLabelText("Confianza baja")).toBeInTheDocument();
    expect(within(rowAt(2)).getByText("122.46")).toBeInTheDocument();
  });

  it("switches notation from the top bar and persists it in the engine", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    await userEvent.click(screen.getByRole("radio", { name: "1m" }));
    expect(within(rowAt(1)).getByText("1m")).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "settings.set", params: { notation: "open_key" } });
    await userEvent.click(screen.getByRole("radio", { name: "Am" }));
    expect(within(rowAt(2)).getByText("F#m")).toBeInTheDocument();
  });

  it("adds and removes watched folders in Settings", async () => {
    openDialog.mockResolvedValue(["/Users/dj/Descargas/Promos 🎧"]);
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    await userEvent.click(screen.getByRole("button", { name: "Carpetas vigiladas" }));
    expect(screen.getByText("Ninguna carpeta vigilada.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Añadir carpeta…" }));
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(await screen.findByText("/Users/dj/Descargas/Promos 🎧")).toBeInTheDocument();
    expect(engine.settings.watchedFolders).toEqual(["/Users/dj/Descargas/Promos 🎧"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Dejar de vigilar /Users/dj/Descargas/Promos 🎧" }),
    );
    await waitFor(() => expect(engine.settings.watchedFolders).toEqual([]));
  });

  it("announces tracks found in watched folders", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
    act(() =>
      emit("engine://event", {
        type: "job.finished",
        payload: {
          jobId: "w1",
          kind: "watch.import",
          status: "done",
          result: { added: 3, updated: 0, moved: 0, unchanged: 0, duplicates: 0, failed: [] },
          error: null,
        },
      }),
    );
    expect(await screen.findByText("3 temas nuevos en carpetas vigiladas")).toBeInTheDocument();
  });

  it("chooses notation and BPM rounding in Settings", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Clásica con bemoles/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Entero/ }));
    await waitFor(() =>
      expect(engine.settings).toMatchObject({
        notation: "classical_flat",
        bpmDecimals: 0,
        cueCount: 8,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Todos los temas/ }));
    await screen.findByText("2 temas");
    expect(within(rowAt(2)).getByText("Gbm")).toBeInTheDocument();
    expect(within(rowAt(2)).getByText("122")).toBeInTheDocument();
  });

  it("edits the key by hand from the table", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    await userEvent.click(within(rowAt(1)).getByRole("button", { name: "Tonalidad: 8A. Editar" }));
    const dialog = screen.getByRole("dialog", { name: "Tonalidad" });
    expect(within(dialog).getByRole("button", { name: "8A (menor)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "8A (menor)" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "9A (menor)" }));
    expect(calls).toContainEqual({
      method: "track.update",
      params: { trackId: 1, key: { root: 4, mode: "minor" } },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(within(rowAt(1)).getByText("9A")).toBeInTheDocument());
    expect(within(rowAt(1)).getByLabelText("Editado a mano")).toBeInTheDocument();
  });

  it("edits the BPM with halve and closes on Escape without saving", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    const cell = within(rowAt(1)).getByRole("button", { name: "BPM: 124.00. Editar" });
    await userEvent.click(cell);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cell).toHaveFocus();

    await userEvent.click(cell);
    await userEvent.click(screen.getByRole("button", { name: "Dividir el BPM entre dos" }));
    expect(screen.getByRole("textbox")).toHaveValue("62");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(calls).toContainEqual({ method: "track.update", params: { trackId: 1, bpm: 62 } });
    await waitFor(() => expect(within(rowAt(1)).getByText("62.00")).toBeInTheDocument());
  });
});

describe("review quality", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, { title: "Midnight Bloom", status: "ready", addedAt: "2026-10-02T10:00:00Z" }),
      track(2, {
        title: "Cobalt Rain",
        status: "ready",
        qualityFlags: ["low_bitrate", "clipping"],
        addedAt: "2026-10-01T10:00:00Z",
      }),
    ];
  });

  it("lists only tracks with quality issues and explains them", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    const item = await screen.findByRole("button", { name: /Revisar calidad/ });
    await waitFor(() => expect(item).toHaveTextContent("1"));
    expect(
      within(rowAt(2)).getByLabelText("Analizado · Bitrate bajo · Clipping"),
    ).toBeInTheDocument();
    await userEvent.click(item);
    expect(await screen.findByRole("heading", { name: "Revisar calidad" })).toBeInTheDocument();
    await screen.findByText("1 tema");
    expect(within(rowAt(1)).getByText("Cobalt Rain")).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: "library.list",
      params: expect.objectContaining({ qualityIssues: true }),
    });
  });

  it("shows an empty state when nothing needs review", async () => {
    engine.tracks = engine.tracks.slice(0, 1);
    renderWithQuery(<App />);
    await screen.findByText("1 tema");
    await userEvent.click(screen.getByRole("button", { name: /Revisar calidad/ }));
    expect(await screen.findByText("Ningún tema con problemas de calidad")).toBeInTheDocument();
  });
});

describe("track detail", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, {
        title: "Midnight Bloom",
        status: "ready",
        keyRoot: 9,
        keyMode: "minor",
        keyConfidence: 0.92,
        bpm: 124,
        energy: 7,
        bitrate: 320,
        qualityFlags: ["quiet"],
      }),
    ];
    engine.details.set(1, {
      beatGrid: { kind: "constant", bpm: 120, first_downbeat: 0.5 },
      keyAlternatives: [
        { root: 4, mode: "minor" },
        { root: 0, mode: "major" },
      ],
      segments: [
        { start: 0, end: 30, label: "intro", energy: 4 },
        { start: 30, end: 90, label: "drop", energy: 8 },
      ],
      energyCurve: [{ start: 0, end: 30, level: 4 }],
      loudnessLufs: -16.4,
      clippingRatio: 0,
      waveformPath: null,
    });
    engine.cues.set(1, [
      { slot: 0, positionSec: 0.5, label: "intro", color: "#4CC3FF", source: "auto" },
      { slot: 1, positionSec: 30, label: "drop", color: "#FF5F8A", source: "auto" },
    ]);
  });

  async function openDetail() {
    renderWithQuery(<App />);
    await screen.findByText("1 tema");
    await userEvent.dblClick(within(rowAt(1)).getByText("Midnight Bloom"));
    return screen.findByRole("heading", { name: "Midnight Bloom" });
  }

  it("opens on double-click with the big data, cues and quality, and goes back", async () => {
    await openDetail();
    expect(screen.getByText("Confianza 92 %")).toBeInTheDocument();
    expect(screen.getByText("Alternativas: 9A, 8B")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Energía 7 de 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cue 2: Drop, 0:30" })).toBeInTheDocument();
    expect(screen.getByText("320 kbps")).toBeInTheDocument();
    expect(screen.getByText(/−16,4 LUFS|-16,4 LUFS/)).toBeInTheDocument();
    expect(screen.getByText("Sin clipping")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByRole("heading", { name: "Todos los temas" })).toBeInTheDocument();
  });

  it("shows the harmonic wheel; clicking a key filters the library to its compatibles", async () => {
    await openDetail();
    const wheel = screen.getByRole("group", { name: "Rueda armónica" });
    expect(within(wheel).getByRole("button", { name: /^8A \(menor\)/ })).toHaveAttribute(
      "data-state",
      "current",
    );
    const legend = screen.getByRole("list", { name: "Tonalidades compatibles" });
    expect(legend).toHaveTextContent("8BRelativa");
    await userEvent.click(within(wheel).getByRole("button", { name: /^9A \(menor\)/ }));
    expect(await screen.findByRole("heading", { name: "Todos los temas" })).toBeInTheDocument();
    expect(screen.getByText("Tonalidad: compatible con 9A")).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: "library.list",
      params: expect.objectContaining({
        filter: { keys: [{ root: 4, mode: "minor" }], compatible: true },
      }),
    });
  });

  it("shows the verification piano with the key's scale", async () => {
    await openDetail();
    const piano = screen.getByRole("group", { name: "Piano" });
    expect(within(piano).getByRole("button", { name: "A3 · tónica" })).toBeInTheDocument();
    expect(screen.getByText("A B C D E F G")).toBeInTheDocument();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    await userEvent.click(screen.getByRole("switch", { name: "Tocar con el tema" }));
    expect(play).toHaveBeenCalled();
  });

  it("opens with Enter on a focused row", async () => {
    renderWithQuery(<App />);
    await screen.findByText("1 tema");
    rowAt(1).focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Midnight Bloom" })).toBeInTheDocument();
  });

  it("sets a cue at the playback position snapped to the beat", async () => {
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Fijar cue aquí" }));
    expect(calls).toContainEqual({
      method: "cues.set",
      params: { trackId: 1, slot: 2, positionSec: 0, label: null, color: "#FF5F8A" },
    });
  });

  it("plays, and jumps to cues with the number keys", async () => {
    await openDetail();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    await userEvent.keyboard("2");
    expect(play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("renames, deletes and resets cues", async () => {
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Editar cue 2" }));
    const name = screen.getByRole("textbox", { name: "Nombre" });
    expect(name).toHaveValue("Drop");
    await userEvent.clear(name);
    await userEvent.type(name, "Gran drop");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(calls).toContainEqual({
      method: "cues.set",
      params: { trackId: 1, slot: 1, positionSec: 30, label: "Gran drop", color: "#FF5F8A" },
    });
    expect(
      await screen.findByRole("button", { name: "Cue 2: Gran drop, 0:30" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Editar cue 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Borrar" }));
    expect(calls).toContainEqual({ method: "cues.delete", params: { trackId: 1, slot: 0 } });

    await userEvent.click(screen.getByRole("button", { name: "Restablecer automáticos" }));
    await userEvent.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(calls).toContainEqual({ method: "cues.resetAuto", params: { trackId: 1 } });
  });
});

describe("writing tags", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, { title: "Midnight Bloom", status: "ready", addedAt: "2026-10-03T10:00:00Z" }),
      track(2, { title: "Golden Hour Tide", status: "ready", addedAt: "2026-10-02T10:00:00Z" }),
      track(3, { title: "Velvet Static", status: "ready", addedAt: "2026-10-01T10:00:00Z" }),
    ];
  });

  it("selects rows with click, Cmd-click and Shift-click", async () => {
    const user = userEvent.setup();
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await user.click(within(rowAt(1)).getByText("Midnight Bloom"));
    expect(rowAt(1)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Shift>}");
    await user.click(within(rowAt(3)).getByText("Velvet Static"));
    await user.keyboard("{/Shift}");
    expect(useLibraryStore.getState().selected).toEqual([1, 2, 3]);
    await user.keyboard("{Meta>}");
    await user.click(within(rowAt(2)).getByText("Golden Hour Tide"));
    await user.keyboard("{/Meta}");
    expect(useLibraryStore.getState().selected).toEqual([1, 3]);
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
  });

  it("previews, writes the selection and offers undo", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(within(rowAt(2)).getByText("Golden Hour Tide"));
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("tab", { name: "Escribir resultados" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("{key} - Energy {energy} | Free download")).toBeInTheDocument();
    expect(screen.getByText("Free download")).toBeInTheDocument();

    const template = screen.getByRole("textbox", { name: "Plantilla del comentario" });
    await userEvent.clear(template);
    await userEvent.type(template, "E");
    await userEvent.click(screen.getByRole("button", { name: "{bpm}" }));
    expect(template).toHaveValue("E{bpm}");
    await userEvent.click(screen.getByRole("radio", { name: "Sustituir" }));
    await userEvent.click(screen.getByRole("switch", { name: "Energía en «grouping»" }));

    await userEvent.click(screen.getByRole("button", { name: "Escribir en 1 tema" }));
    expect(calls).toContainEqual({
      method: "tags.write",
      params: {
        trackIds: [2],
        options: expect.objectContaining({
          commentTemplate: "E{bpm}",
          commentPosition: "replace",
          energyInGrouping: true,
        }),
      },
    });
    act(() =>
      emit("engine://event", {
        type: "job.finished",
        payload: {
          jobId: "job-1",
          kind: "tags.write",
          status: "done",
          result: { batchId: "b1", written: 1, unchanged: 0, failed: [] },
          error: null,
        },
      }),
    );
    expect(await screen.findByText("Tags escritos en 1 tema")).toBeInTheDocument();
    expect(
      screen.getByText("También puedes deshacerlo más tarde en Tags › Historial."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(calls).toContainEqual({ method: "tags.undo", params: { batchId: "b1" } });
  });

  it("works on the whole view when nothing is selected", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("button", { name: "Escribir en 3 temas" })).toBeInTheDocument();
  });

  it("says in words which tracks it will write to", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(within(rowAt(2)).getByText("Golden Hour Tide"));
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    const scope = (await screen.findByText("1 tema seleccionado")).closest("p") as HTMLElement;
    expect(within(scope).getByText("Golden Hour Tide")).toBeInTheDocument();
    await userEvent.click(within(scope).getByRole("button", { name: "Cambiar" }));
    expect(useViewStore.getState().view).toBe("library");

    act(() => useLibraryStore.getState().setSelected([]));
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    const all = (await screen.findByText("los 3 temas de esta vista")).closest("p") as HTMLElement;
    expect(await within(all).findByText("y 2 más", { exact: false })).toBeInTheDocument();
  });

  it("keeps every write in a history that can still be undone", async () => {
    engine.tagHistory = [
      {
        batchId: "b2",
        kind: "results",
        createdAt: "2026-10-12T21:47:00Z",
        written: 248,
        undoneAt: null,
        undoable: 248,
        fields: ["key", "bpm", "comment"],
        titles: ["Midnight Bloom", "Golden Hour Tide", "Velvet Static"],
      },
      {
        batchId: "b1",
        kind: "clean",
        createdAt: "2026-10-11T20:00:00Z",
        written: 3,
        undoneAt: "2026-10-11T20:05:00Z",
        undoable: 0,
        fields: ["title"],
        titles: ["Midnight Bloom"],
      },
    ];
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ver el historial" }));
    expect(screen.getByRole("tab", { name: "Historial" })).toHaveAttribute("aria-selected", "true");

    const results = (await screen.findByText("Resultados del análisis")).closest(
      "li",
    ) as HTMLElement;
    expect(within(results).getByText("248 temas", { exact: false })).toBeInTheDocument();
    expect(
      within(results).getByText("Midnight Bloom, Golden Hour Tide, Velvet Static y 245 más"),
    ).toBeInTheDocument();
    expect(within(results).getByText("Tonalidad")).toBeInTheDocument();
    const cleaned = screen.getByText("Limpieza de tags").closest("li") as HTMLElement;
    expect(within(cleaned).getByText(/^Deshecho el/)).toBeInTheDocument();
    expect(within(cleaned).queryByRole("button", { name: "Deshacer" })).toBeNull();

    await userEvent.click(within(results).getByRole("button", { name: "Deshacer" }));
    expect(calls).toContainEqual({ method: "tags.undo", params: { batchId: "b2" } });
  });
});

describe("cleaning and bulk edit", () => {
  beforeEach(() => {
    engine.tracks = [track(1, { title: "01 - MIDNIGHT BLOOM", status: "ready" })];
  });

  async function openTags() {
    renderWithQuery(<App />);
    await screen.findByText("1 tema");
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await screen.findByRole("tab", { name: "Limpiar tags" });
  }

  it("cleans with switchable rules and an editable phrase list", async () => {
    await openTags();
    await userEvent.click(screen.getByRole("tab", { name: "Limpiar tags" }));
    expect(screen.getByText("01 - Golden Hour Tide → Golden Hour Tide")).toBeInTheDocument();
    expect(await screen.findByText("Midnight Bloom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar «Support»" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Nueva frase…" }),
      "Radio Premiere{Enter}",
    );
    await userEvent.click(screen.getByRole("switch", { name: "Quitar «(Original Mix)»" }));
    await userEvent.click(screen.getByRole("button", { name: "Escribir en 1 tema" }));
    const call = calls.find((c) => c.method === "tags.clean");
    const rules = (
      call?.params as { rules: { promoPhrases: string[]; removeOriginalMix: boolean } }
    ).rules;
    expect(rules.removeOriginalMix).toBe(true);
    expect(rules.promoPhrases).toContain("Radio Premiere");
    expect(rules.promoPhrases).not.toContain("Support");
  });

  it("edits chosen fields in bulk", async () => {
    await openTags();
    await userEvent.click(screen.getByRole("tab", { name: "Editar en lote" }));
    expect(
      screen.getByText("Marca al menos un campo para ver la vista previa."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escribir en 1 tema" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Género" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Nuevo valor de Género" }),
      "Melodic House",
    );
    expect(await screen.findByText("Melodic House")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Escribir en 1 tema" }));
    expect(calls).toContainEqual({
      method: "tags.edit",
      params: { trackIds: [1], values: { genre: "Melodic House" } },
    });
  });
});

describe("track info panel", () => {
  beforeEach(() => {
    engine.tracks = [
      track(1, {
        title: "Midnight Bloom",
        status: "ready",
        keyRoot: 9,
        keyMode: "minor",
        bpm: 62,
        energy: 6,
        genre: "Deep House",
      }),
    ];
  });

  async function openPanel() {
    renderWithQuery(<App />);
    await screen.findByText("1 tema");
    await userEvent.click(within(rowAt(1)).getByText("Midnight Bloom"));
    await userEvent.click(screen.getByRole("button", { name: "Editar info" }));
    return screen.findByRole("dialog", { name: "Info del tema" });
  }

  it("edits analysis fields as manual edits and metadata in the file", async () => {
    const panel = await openPanel();
    const title = within(panel).getByRole("textbox", { name: "Título" });
    expect(title).toHaveValue("Midnight Bloom");
    await userEvent.clear(title);
    await userEvent.type(title, "Midnight Bloom (Extended)");
    expect(within(panel).getAllByText("Editado a mano")).toHaveLength(1);
    await userEvent.click(within(panel).getByRole("button", { name: "9A (menor)" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Doblar el BPM" }));
    expect(within(panel).getByRole("textbox", { name: "BPM" })).toHaveValue("124");
    await userEvent.click(within(panel).getByRole("radio", { name: "Energía 8 de 10" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "track.update",
        params: { trackId: 1, key: { root: 4, mode: "minor" }, bpm: 124, energy: 8 },
      }),
    );
    expect(calls).toContainEqual({
      method: "tags.edit",
      params: { trackIds: [1], values: { title: "Midnight Bloom (Extended)" } },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers genres from the library and validates the year", async () => {
    const panel = await openPanel();
    await waitFor(() => expect(panel.querySelectorAll("#tonalia-genres option")).toHaveLength(2));
    const year = within(panel).getByRole("textbox", { name: "Año" });
    await userEvent.clear(year);
    await userEvent.type(year, "99");
    expect(within(panel).getByRole("button", { name: "Guardar" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "track.update" || c.method === "tags.edit")).toBe(false);
  });

  it("taps a tempo", async () => {
    const panel = await openPanel();
    const tapButton = within(panel).getByRole("button", { name: "Tap tempo" });
    for (const at of [1000, 1500, 2000, 2500]) {
      const click = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(click, "timeStamp", { value: at });
      act(() => {
        tapButton.dispatchEvent(click);
      });
    }
    expect(within(panel).getByRole("textbox", { name: "BPM" })).toHaveValue("120");
  });
});
