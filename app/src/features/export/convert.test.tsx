// From one DJ program to another (SPEC 13.2): in Export, review the trip first (nothing is
// written), see what does not survive, then take the library and undo it in Tonalia.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { ConvertOptions } from "../../lib/rpc.types";
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
import { useImportJobs } from "../dj-import/importJobs";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import { useConvertJobs } from "./convertJobs";

const openDialog = vi.fn();
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
  open: (...a: unknown[]) => openDialog(...a),
  save: (...a: unknown[]) => saveDialog(...a),
}));

beforeEach(async () => {
  resetEngine();
  openDialog.mockReset();
  saveDialog.mockReset();
  localStorage.clear();
  localStorage.setItem("tonalia.export.target", "convert");
  useToastStore.setState({ toasts: [] });
  useConvertJobs.setState({ running: null, outcome: null });
  useImportJobs.setState({ running: null, outcomes: {} });
  useViewStore.setState({ view: "export" });
  engine.traktorStatus = {
    collectionPath: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
    running: false,
  };
  engine.tracks = [
    track(1, { status: "ready" }),
    track(2, { title: "Golden Hour Tide", status: "ready" }),
    track(3, { title: "Neon Cathedral", status: "ready" }),
  ];
  await i18n.changeLanguage("es");
});

const lastCall = (method: string) =>
  [...calls].reverse().find((c) => c.method === method)?.params as ConvertOptions;

/** Finish the running trip the way the engine does. */
function finish() {
  const running = useConvertJobs.getState().running;
  if (!running) throw new Error("no trip running");
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: running.jobId,
        kind: running.simulate ? "convert.plan" : "convert.apply",
        status: "done",
        result: djImport.convert(running.options, running.simulate),
        error: null,
      },
    }),
  );
}

test("review the trip, see what is lost, take it and undo it in Tonalia", async () => {
  const user = userEvent.setup();
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", {
    name: "Llevar tu biblioteca de un programa a otro",
  });
  // Rekordbox → Traktor: the XML is chosen; Traktor's collection was found.
  expect(within(panel).getByRole("combobox", { name: "De" })).toHaveValue("rekordbox");
  expect(within(panel).getByRole("combobox", { name: "A" })).toHaveValue("traktor");
  const go = within(panel).getByRole("button", { name: "Llevar a Traktor" });
  expect(go).toHaveAttribute("aria-disabled", "true");
  expect(within(panel).getByText("Elige la colección de Rekordbox.")).toBeVisible();
  openDialog.mockResolvedValueOnce("/Users/dj/Desktop/rekordbox.xml");
  const [chooseSource] = within(panel).getAllByRole("button", { name: "Elegir…" });
  if (!chooseSource) throw new Error("no Choose button");
  await user.click(chooseSource);
  expect(await within(panel).findByText("/Users/dj/Desktop/rekordbox.xml")).toBeVisible();
  expect(await within(panel).findByText(/Revisa primero el viaje/)).toBeVisible();

  await user.click(within(panel).getByRole("button", { name: "Revisar el viaje" }));
  expect(lastCall("convert.plan")).toMatchObject({
    source: "rekordbox",
    target: "traktor",
    sourcePath: "/Users/dj/Desktop/rekordbox.xml",
    targetPath: engine.traktorStatus.collectionPath,
    policy: { cues: "take", grid: "take", key: "take" },
    playlists: true,
    addMissing: false,
    language: "es",
  });
  finish();
  expect(await within(panel).findByText("Revisión: aún no se ha cambiado nada")).toBeVisible();
  const lost = within(panel).getByRole("region", { name: "Lo que no llega a Traktor" });
  expect(within(lost).getByText("Colores de cue.")).toBeVisible();
  expect(within(lost).getByText(/Traktor no los guarda: 5 cues de 2 temas/)).toBeVisible();
  expect(within(lost).getByText("Memory cues y loops.")).toBeVisible();
  expect(within(lost).getByText("Temas que no viajan.")).toBeVisible();
  expect(calls.some((c) => c.method === "convert.apply")).toBe(false);

  // Writing Traktor's collection asks first.
  expect(go).not.toHaveAttribute("aria-disabled");
  await user.click(go);
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Llevar a Traktor" }));
  expect(lastCall("convert.apply")).toMatchObject({ source: "rekordbox", target: "traktor" });
  finish();
  expect(await within(panel).findByText("Hecho: tu biblioteca está en Traktor")).toBeVisible();
  await waitFor(() =>
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain(
      "Tu biblioteca está en Traktor",
    ),
  );
  expect(within(panel).getByText(/Para volver a llevarla, revisa otra vez/)).toBeVisible();

  // Undo what came into Tonalia (the import batch); Traktor keeps its backup.
  await user.click(within(panel).getByRole("button", { name: "Deshacer en Tonalia" }));
  await waitFor(() => expect(calls.some((c) => c.method === "import.undo")).toBe(true));
});

test("choosing the same program on both sides swaps them, and changes make the review stale", async () => {
  const user = userEvent.setup();
  localStorage.setItem("tonalia.convert.from.rekordbox", "/Users/dj/rekordbox.xml");
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", {
    name: "Llevar tu biblioteca de un programa a otro",
  });
  await user.selectOptions(within(panel).getByRole("combobox", { name: "A" }), "rekordbox");
  expect(within(panel).getByRole("combobox", { name: "De" })).toHaveValue("traktor");
  expect(within(panel).getByRole("button", { name: "Llevar a Rekordbox" })).toBeVisible();
  await user.selectOptions(within(panel).getByRole("combobox", { name: "De" }), "rekordbox");
  expect(within(panel).getByRole("combobox", { name: "A" })).toHaveValue("traktor");

  await user.click(within(panel).getByRole("button", { name: "Revisar el viaje" }));
  finish();
  expect(await within(panel).findByText(/Revisión: aún no/)).toBeVisible();
  await user.click(within(panel).getByRole("radio", { name: "Solo rellenar lo que falta" }));
  expect(within(panel).getByText(/Has cambiado las opciones/)).toBeVisible();
  expect(within(panel).getByRole("button", { name: "Llevar a Traktor" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await user.click(within(panel).getByRole("button", { name: "Revisar el viaje" }));
  expect(lastCall("convert.plan").policy).toMatchObject({ cues: "fill", key: "fill" });
});

test("an open target cannot be written, and a Rekordbox target asks where to save", async () => {
  const user = userEvent.setup();
  engine.traktorStatus.running = true;
  localStorage.setItem("tonalia.convert.source", "serato");
  renderWithQuery(<App />);
  const panel = await screen.findByRole("region", {
    name: "Llevar tu biblioteca de un programa a otro",
  });
  expect(
    await within(panel).findByText(/Traktor está abierto: ciérralo para poder escribir/),
  ).toBeVisible();
  expect(within(panel).getByText("Cierra Traktor para poder llevar tu biblioteca.")).toBeVisible();

  await user.selectOptions(within(panel).getByRole("combobox", { name: "A" }), "rekordbox");
  await user.click(within(panel).getByRole("button", { name: "Revisar el viaje" }));
  finish();
  await within(panel).findByText(/Revisión: aún no/);
  saveDialog.mockResolvedValueOnce("/Users/dj/Desktop/de-serato.xml");
  await user.click(within(panel).getByRole("button", { name: "Llevar a Rekordbox" }));
  await waitFor(() =>
    expect(lastCall("convert.apply")).toMatchObject({
      source: "serato",
      target: "rekordbox",
      targetPath: "/Users/dj/Desktop/de-serato.xml",
    }),
  );
  finish();
  // After a Rekordbox trip, how to bring the XML into Rekordbox.
  expect(await within(panel).findByText("Después de exportar")).toBeVisible();
});
