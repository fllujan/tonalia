// Export screen (SPEC 2.12, DESIGN 6.8).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  calls,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
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
  await userEvent.click(within(card).getByRole("checkbox", { name: "Solo el tema seleccionado" }));
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
  const card = await screen.findByRole("region", { name: "Traktor" });
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
  const card = await screen.findByRole("region", { name: "Traktor" });
  expect(
    await within(card).findByText(/No se encontró la colección de Traktor/),
  ).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Exportar" })).toBeEnabled();
});

test("Serato: writes into the files and offers undo", async () => {
  renderWithQuery(<App />);
  const card = await screen.findByRole("region", { name: "Serato" });
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
