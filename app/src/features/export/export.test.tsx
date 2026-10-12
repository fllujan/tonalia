// Export screen (SPEC 2.12, DESIGN 6.8).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  addPlaylist,
  calls,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  revealed,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useExportStore } from "./exportStore";

const saveDialog = vi.fn();

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
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: (...a: unknown[]) => saveDialog(...a),
}));

beforeEach(async () => {
  resetEngine();
  saveDialog.mockReset();
  localStorage.clear();
  useLibraryStore.setState({ selected: [], filter: {}, search: "" });
  useViewStore.setState({ view: "export" });
  useExportStore.setState({ running: null, outcomes: {} });
  engine.tracks = [track(1), track(2)];
  await i18n.changeLanguage("es");
});

/** Pick a destination in the list; its panel replaces the one shown. */
async function openTarget(name: string) {
  await userEvent.click(await screen.findByRole("tab", { name }));
  return screen.findByRole("region", { name });
}

function finish(jobId: string, result: Record<string, unknown>) {
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: { jobId, kind: "export.rekordbox", status: "done", result, error: null },
    }),
  );
}

const RESULT = {
  target: "rekordbox",
  path: "/Users/dj/rekordbox.xml",
  tracks: 1204,
  cues: 8916,
  playlists: 12,
  skipped: 1,
  backupPath: null,
  warnings: [
    { code: "unsupported_format", trackId: 7, path: "/Users/dj/a.ogg" },
    { code: "missing_file", trackId: 9, path: "/Users/dj/b.mp3" },
  ],
};

test("simulates a Rekordbox export and shows the report", async () => {
  renderWithQuery(<App />);
  const card = await screen.findByRole("region", { name: "Rekordbox" });
  expect(within(card).getAllByRole("listitem")).toHaveLength(3); // the 3-step guide
  await waitFor(() => expect(calls.some((c) => c.method === "export.traktorStatus")).toBe(true));
  await userEvent.click(within(card).getByRole("checkbox", { name: "Colores" }));
  await userEvent.click(within(card).getByRole("button", { name: "Simular" }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "export.rekordbox",
      params: {
        cues: true,
        colors: false,
        beatgrid: true,
        key: true,
        includePlaylists: true,
        memoryCues: false,
        simulate: true,
        path: null,
        trackIds: null,
        notation: "classical",
        language: "es",
      },
    }),
  );
  expect(saveDialog).not.toHaveBeenCalled();
  expect(within(card).getByRole("button", { name: "Simular" })).toBeDisabled();
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  finish("job-1", { ...RESULT, simulated: true });
  expect(await within(card).findByText("Simulación: no se ha escrito nada")).toBeInTheDocument();
  expect(
    within(card).getByText("1.204 temas · 8.916 cues · 12 playlists · 2 avisos"),
  ).toBeInTheDocument();
  expect(
    within(card).getByText("1 tema en un formato que este programa no reproduce (se omite)"),
  ).toBeInTheDocument();
  expect(within(card).getByText("1 archivo no se encuentra en el disco")).toBeInTheDocument();
});

test("asks where to save, remembers it and reports the backup", async () => {
  saveDialog.mockResolvedValue("/Users/dj/Documents/rekordbox.xml");
  useLibraryStore.setState({ selected: [2] });
  renderWithQuery(<App />);
  const card = await screen.findByRole("region", { name: "Rekordbox" });
  await userEvent.click(within(card).getByRole("radio", { name: "1 seleccionado" }));
  await userEvent.click(within(card).getByRole("button", { name: "Exportar" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({
      method: "export.rekordbox",
      params: { simulate: false, path: "/Users/dj/Documents/rekordbox.xml", trackIds: [2] },
    }),
  );
  expect(localStorage.getItem("tonalia.export.rekordbox.path")).toBe(
    "/Users/dj/Documents/rekordbox.xml",
  );
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  finish("job-1", {
    ...RESULT,
    simulated: false,
    warnings: [],
    backupPath: "/datos/backups/rekordbox/20261011-rekordbox.xml",
  });
  expect(await within(card).findByText("Exportado")).toBeInTheDocument();
  expect(
    within(card).getByText(
      "Copia del archivo anterior: /datos/backups/rekordbox/20261011-rekordbox.xml",
    ),
  ).toBeInTheDocument();
});

test("exports one playlist, and waits until one is chosen", async () => {
  const set = addPlaylist("Peak time", { emoji: "🔥" }, [2]);
  renderWithQuery(<App />);
  const card = await screen.findByRole("region", { name: "Rekordbox" });
  await userEvent.click(within(card).getByRole("radio", { name: "Una playlist" }));
  expect(within(card).getByText("Elige una playlist para exportar.")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Simular" })).toBeDisabled();
  await userEvent.selectOptions(
    within(card).getByRole("combobox", { name: "Elegir playlist…" }),
    String(set.id),
  );
  await userEvent.click(within(card).getByRole("button", { name: "Simular" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({
      method: "export.rekordbox",
      params: { simulate: true, trackIds: null, playlistIds: [set.id] },
    }),
  );
});

test("lists the destinations with what each found, and remembers the last one", async () => {
  const { unmount } = renderWithQuery(<App />);
  expect(await screen.findByRole("tab", { name: "Traktor" })).toHaveAccessibleDescription(
    /^Colección/,
  );
  expect(screen.getByRole("tab", { name: "Serato" })).toHaveAccessibleDescription(
    "Dentro de tus archivos",
  );
  const rekordbox = screen.getByRole("tab", { name: "Rekordbox" });
  expect(rekordbox).toHaveAttribute("aria-selected", "true");
  rekordbox.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("tab", { name: "Traktor" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("region", { name: "Traktor" })).toBeInTheDocument();
  unmount();
  renderWithQuery(<App />);
  expect(await screen.findByRole("region", { name: "Traktor" })).toBeInTheDocument();
});

test("is reachable from the sidebar", async () => {
  useViewStore.setState({ view: "library" });
  renderWithQuery(<App />);
  await screen.findByText("2 temas");
  await userEvent.click(screen.getByRole("button", { name: "Exportar" }));
  expect(screen.getByRole("heading", { name: "Exportar a software de DJ" })).toBeInTheDocument();
});

test("Traktor: uses the collection found and blocks exporting while Traktor is open", async () => {
  engine.traktorStatus = {
    collectionPath: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
    running: true,
  };
  renderWithQuery(<App />);
  const card = await openTarget("Traktor");
  expect(
    await within(card).findByText(/Traktor está abierto: ciérralo para exportar/),
  ).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Exportar" })).toBeDisabled();
  expect(within(card).queryByRole("checkbox", { name: "Colores" })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Simular" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({
      method: "export.traktor",
      params: {
        simulate: true,
        notation: "open_key",
        path: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
      },
    }),
  );
});

test("Traktor: reports when no collection is found", async () => {
  renderWithQuery(<App />);
  const card = await openTarget("Traktor");
  expect(
    await within(card).findByText(/No se encontró la colección de Traktor/),
  ).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Exportar" })).toBeEnabled();
});

test("Serato: writes into the files and offers undo", async () => {
  renderWithQuery(<App />);
  const card = await openTarget("Serato");
  expect(within(card).queryByText("Destino")).not.toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Exportar" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({
      method: "export.serato",
      params: { simulate: false, path: null, cues: true, colors: true },
    }),
  );
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: "job-1",
        kind: "export.serato",
        status: "done",
        error: null,
        result: { ...RESULT, target: "serato", path: "", simulated: false, warnings: [],
          batchId: "b42" }, // prettier-ignore
      },
    }),
  );
  await userEvent.click(await within(card).findByRole("button", { name: "Deshacer" }));
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "tags.undo", params: { batchId: "b42" } }),
  );
});

test("Traktor: confirms before changing the collection, then lists tracks and reveals files", async () => {
  engine.traktorStatus = { collectionPath: "/Users/dj/NI/collection.nml", running: false };
  renderWithQuery(<App />);
  const card = await openTarget("Traktor");
  await within(card).findByText(/Encontrado en/);
  await userEvent.click(within(card).getByRole("button", { name: "Exportar" }));
  const dialog = await screen.findByRole("dialog", { name: "¿Modificar la colección de Traktor?" });
  expect(within(dialog).getByText("/Users/dj/NI/collection.nml")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "export.traktor")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Exportar" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({ method: "export.traktor", params: { simulate: false } }),
  );
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: "job-1",
        kind: "export.traktor",
        status: "done",
        error: null,
        result: {
          ...RESULT,
          target: "traktor",
          simulated: false,
          tracks: 2,
          warnings: [],
          path: "/Users/dj/NI/collection.nml",
          backupPath: "/datos/backups/traktor/20261011-collection.nml",
          items: [
            { trackId: 1, title: "Midnight Bloom", action: "updated", cues: 5 },
            { trackId: 2, title: "Neon Cathedral", action: "added", cues: 3 },
          ],
        },
      },
    }),
  );
  await userEvent.click(await within(card).findByText("Ver los temas (2)"));
  expect(within(card).getByText("Actualizado")).toBeInTheDocument();
  expect(within(card).getByText("Añadido")).toBeInTheDocument();
  expect(within(card).getByText("5 cues")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Mostrar copia de seguridad" }));
  expect(revealed).toEqual(["/datos/backups/traktor/20261011-collection.nml"]);
});

test("cancelling the confirmation exports nothing", async () => {
  engine.traktorStatus = { collectionPath: "/Users/dj/NI/collection.nml", running: false };
  renderWithQuery(<App />);
  const card = await openTarget("Traktor");
  await within(card).findByText(/Encontrado en/);
  await userEvent.click(within(card).getByRole("button", { name: "Exportar" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.some((c) => c.method === "export.traktor")).toBe(false);
});

test("Engine DJ: exports into m.db after confirming and explains tracks it does not have", async () => {
  engine.engineDjStatus = {
    collectionPath: "/Users/dj/Music/Engine Library/Database2/m.db",
    running: false,
  };
  renderWithQuery(<App />);
  const card = await openTarget("Engine DJ");
  expect(
    await within(card).findByText(/Solo se actualizan los temas que ya están en Engine DJ/),
  ).toBeInTheDocument();
  expect(
    await within(card).findByText("Encontrado en /Users/dj/Music/Engine Library/Database2/m.db"),
  ).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Exportar" }));
  const dialog = await screen.findByRole("dialog", {
    name: "¿Modificar la colección de Engine DJ?",
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Exportar" }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "export.engineDj",
      params: expect.objectContaining({
        simulate: false,
        path: "/Users/dj/Music/Engine Library/Database2/m.db",
        cues: true,
        colors: true,
        beatgrid: true,
        key: true,
        includePlaylists: true,
      }) as unknown,
    }),
  );
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: "job-1",
        kind: "export.engineDj",
        status: "done",
        result: {
          ...RESULT,
          target: "engine_dj",
          simulated: false,
          path: "/Users/dj/Music/Engine Library/Database2/m.db",
          warnings: [{ code: "not_in_collection", trackId: 2, path: "/Users/dj/nuevo.mp3" }],
        },
        error: null,
      },
    }),
  );
  expect(
    await within(card).findByText(
      "1 tema no está en la colección de Engine DJ (impórtalo antes en Engine DJ)",
    ),
  ).toBeInTheDocument();
});

test("Engine DJ: blocks exporting while it is open and explains a failed export", async () => {
  engine.engineDjStatus = {
    collectionPath: "/Users/dj/Music/Engine Library/Database2/m.db",
    running: true,
  };
  renderWithQuery(<App />);
  const card = await openTarget("Engine DJ");
  expect(await within(card).findByText(/Engine DJ está abierto/)).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Exportar" })).toBeDisabled();
  await userEvent.click(within(card).getByRole("button", { name: "Simular" }));
  await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: "job-1",
        kind: "export.engineDj",
        status: "failed",
        result: null,
        error: "Engine Library version 4.0.0 is not supported",
      },
    }),
  );
  expect(
    await within(card).findByText(/esta versión de la biblioteca de Engine DJ/),
  ).toBeInTheDocument();
});
