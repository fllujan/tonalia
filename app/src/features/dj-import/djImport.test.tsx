// Import from DJ programs (SPEC 13.1, DESIGN 6.19): preview first, then import, undo,
// the per-field policy, the detected path mappings and the history.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { ImportOptions } from "../../lib/rpc.types";
import {
  calls,
  djImport,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import { useImportJobs } from "./importJobs";

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
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => openDialog(...a),
  save: vi.fn(),
}));

beforeEach(async () => {
  resetEngine();
  openDialog.mockReset();
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  useImportJobs.setState({ running: null, outcomes: {} });
  useViewStore.setState({ view: "library" });
  engine.tracks = [
    track(1, { status: "ready", keyRoot: 9, keyMode: "minor" }),
    track(2, { title: "Golden Hour Tide", status: "ready", keyRoot: 4, keyMode: "minor" }),
    track(3, { title: "Neon Cathedral", status: "ready" }),
  ];
  await i18n.changeLanguage("es");
});

const lastCall = (method: string) =>
  [...calls].reverse().find((c) => c.method === method)?.params as ImportOptions;

/** Finish the running import job the way the engine does. */
function finish() {
  const running = useImportJobs.getState().running;
  if (!running) throw new Error("no import running");
  const result = running.simulate
    ? djImport.report(running.options, true)
    : djImport.apply(running.options);
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: running.jobId,
        kind: running.simulate ? "import.preview" : "import.apply",
        status: "done",
        result,
        error: null,
      },
    }),
  );
}

test("preview first, then import, then undo — Tonalia never writes to the program", async () => {
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Importar" }));
  const traktor = await screen.findByRole("tab", { name: /Traktor/ });
  await user.click(traktor);
  const panel = await screen.findByRole("region", { name: "Traktor" });
  expect(await within(panel).findByText(/Colección encontrada en/)).toBeInTheDocument();
  expect(within(panel).getByText(/solo lee la colección de Traktor/)).toBeInTheDocument();

  // Import waits for a preview and says why.
  const importButton = within(panel).getByRole("button", { name: "Importar" });
  expect(importButton).toHaveAttribute("aria-disabled", "true");
  expect(
    within(panel).getByText("Haz primero la vista previa para ver qué cambiará."),
  ).toBeVisible();
  await user.click(importButton);
  expect(calls.some((c) => c.method === "import.apply")).toBe(false);

  await user.click(within(panel).getByRole("button", { name: "Vista previa" }));
  expect(lastCall("import.preview")).toMatchObject({
    source: "traktor",
    path: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
    pathMaps: null,
    playlists: true,
    addMissing: false,
    language: "es",
    policy: { cues: "fill", key: "fill", playCount: "fill" },
  });
  finish();
  expect(
    await within(panel).findByText("Vista previa: aún no se ha cambiado nada"),
  ).toBeInTheDocument();
  expect(within(panel).getByText(/6 temas en la colección · 3 ya están en Tonalia/)).toBeVisible();
  expect(within(panel).getByText(/1 por ruta, 2 por ruta cambiada, 0 por contenido/)).toBeVisible();
  // The detected mapping, with the tracks it found.
  expect(within(panel).getByText("D:\\Música → /Users/dj/Music")).toBeVisible();
  expect(within(panel).getByText("2 temas")).toBeVisible();
  // Before → after, and the folder the playlists go into.
  expect(within(panel).getByText("#2 · 0:31.05 · drop")).toHaveClass("line-through");
  expect(within(panel).getByText(/en «Importado de Traktor»/)).toBeVisible();
  expect(within(panel).getByText(/no se importa de vuelta/)).toBeVisible();

  expect(importButton).not.toHaveAttribute("aria-disabled");
  await user.click(importButton);
  expect(lastCall("import.apply")).toMatchObject({ source: "traktor", pathMaps: null });
  finish();
  expect(await within(panel).findByText("Importado")).toBeInTheDocument();
  await waitFor(() =>
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Importado: 3 temas"),
  );
  // The history lists it; Undo from the result.
  const history = await screen.findByRole("region", { name: "Importaciones" });
  expect(await within(history).findByText("Traktor")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Deshacer" }));
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "import.undo", params: { batchId: "fake-import-1" } }),
  );
  await waitFor(() =>
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Importación deshecha"),
  );
  expect(await within(history).findByText(/Deshecha el/)).toBeInTheDocument();
  expect(within(panel).getByText("Esta importación se ha deshecho.")).toBeVisible();
  expect(within(panel).queryByRole("button", { name: "Deshacer" })).toBeNull();
  expect(within(panel).getByText("Para volver a importar, haz otra vista previa.")).toBeVisible();
});

test("the policy is saved per field and makes the preview stale", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "import" });
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", { name: "Rekordbox" });
  // Rekordbox keeps no collection of its own: the XML is chosen.
  expect(within(panel).getByText("Sin elegir")).toBeVisible();
  expect(within(panel).getByRole("button", { name: "Vista previa" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  openDialog.mockResolvedValueOnce("/Users/dj/Desktop/rekordbox.xml");
  await user.click(within(panel).getByRole("button", { name: "Elegir…" }));
  expect(await within(panel).findByText("/Users/dj/Desktop/rekordbox.xml")).toBeVisible();
  await user.click(within(panel).getByRole("button", { name: "Vista previa" }));
  finish();
  expect(await within(panel).findByText(/Vista previa: aún no/)).toBeInTheDocument();

  const key = within(panel).getByRole("radiogroup", { name: "Tonalidad" });
  await user.click(within(key).getByRole("radio", { name: "Tomar lo importado" }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "settings.set",
      params: { importPolicy: expect.objectContaining({ key: "take", cues: "fill" }) },
    }),
  );
  expect(await within(panel).findByText(/Has cambiado las opciones/)).toBeVisible();
  expect(within(panel).getByRole("button", { name: "Importar" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.click(within(panel).getByRole("button", { name: "Vista previa" }));
  expect(lastCall("import.preview").policy).toMatchObject({ key: "take" });
  finish();
  // A key Tonalia has is replaced: marked, and "by hand" when the user edited it.
  expect(await within(panel).findAllByText("sustituye")).not.toHaveLength(0);
  expect(within(panel).getByText("a mano")).toBeVisible();
});

test("switching a detected mapping off previews again without it, and back on", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "import" });
  localStorage.setItem("tonalia.import.source", "serato");
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", { name: "Serato" });
  await within(panel).findByText(/Colección encontrada/);
  await user.click(within(panel).getByRole("button", { name: "Vista previa" }));
  finish();
  const map = await within(panel).findByRole("checkbox", { name: /D:\\Música/ });
  expect(map).toBeChecked();
  await user.click(map);
  expect(lastCall("import.preview").pathMaps).toEqual([]);
  finish();
  const off = await within(panel).findByRole("checkbox", { name: /D:\\Música/ });
  expect(off).not.toBeChecked();
  expect(within(panel).getByText(/0 por ruta cambiada/)).toBeVisible();
  await user.click(off);
  expect(lastCall("import.preview").pathMaps).toEqual([
    expect.objectContaining({ from: "D:\\Música", to: "/Users/dj/Music" }),
  ]);
});

test("an open program is read from a copy, and says so", async () => {
  useViewStore.setState({ view: "import" });
  localStorage.setItem("tonalia.import.source", "virtualdj");
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", { name: "VirtualDJ" });
  expect(
    await within(panel).findByText(/VirtualDJ está abierto: se leerá una copia/),
  ).toBeVisible();
  const tab = screen.getByRole("tab", { name: /VirtualDJ/ });
  expect(within(tab).getByText("Abierto: se leerá una copia")).toBeVisible();
});

test("the detail shows the rating, plays, memory cues and loops brought from the program", async () => {
  const user = userEvent.setup();
  engine.details.set(1, {
    rating: 4,
    playCount: 12,
    markers: [
      {
        kind: "memory",
        positionSec: 12,
        lengthSec: null,
        label: null,
        color: null,
        source: "import",
      },
      {
        kind: "loop",
        positionSec: 40,
        lengthSec: 7.68,
        label: "Loop 4",
        color: null,
        source: "import",
      },
    ],
  });
  useViewStore.setState({ view: "detail", trackId: 1, back: "library" });
  renderWithQuery(<App />);
  expect(await screen.findByRole("img", { name: "4 estrellas" })).toBeInTheDocument();
  expect(screen.getByText("12 reproducciones en tu programa de DJ")).toBeVisible();
  const markers = screen.getByRole("region", { name: "Memory cues y loops" });
  expect(within(markers).getByRole("button", { name: /0:12\s*Memory cue/ })).toBeVisible();
  await user.click(within(markers).getByRole("button", { name: /0:40–0:48\s*Loop 4/ }));
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
});
