// Play history (SPEC 13.4, DESIGN 6.22): importing a program's history, the sessions as
// read-only lists, the table columns, marking a selection as played (with Undo) and the
// set builder leaving out the tracks played recently.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { BuilderGenerateParams, HistoryImportParams } from "../../lib/rpc.types";
import {
  calls,
  emit,
  engine,
  history,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useBuilderStore } from "../playlist-builder/builderStore";
import { useToastStore } from "../toast/toastStore";
import { useHistoryImport } from "./api";

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
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const DAY = 86_400_000;
const ready = { status: "ready" as const };
const last = <T,>(method: string) =>
  calls.filter((c) => c.method === method).at(-1)?.params as T | undefined;

beforeEach(async () => {
  resetEngine();
  useToastStore.setState({ toasts: [] });
  useHistoryImport.setState({ running: null, outcome: null });
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useBuilderStore.getState().reset();
  engine.tracks = [
    track(1, { ...ready, title: "Midnight Bloom", keyRoot: 9, keyMode: "minor", bpm: 124, energy: 6 }),
    track(2, { ...ready, title: "Golden Hour Tide", keyRoot: 4, keyMode: "minor", bpm: 124, energy: 6 }),
    track(3, { ...ready, title: "Neon Cathedral", keyRoot: 0, keyMode: "major", bpm: 126, energy: 8 }),
  ]; // prettier-ignore
  await i18n.changeLanguage("es");
});

/** Finish the running history import the way the engine does. */
function finishImport() {
  const running = useHistoryImport.getState().running;
  if (!running) throw new Error("no import running");
  const params = last<HistoryImportParams>("history.import") as HistoryImportParams;
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: running.jobId,
        kind: "history.import",
        status: "done",
        result: history.importHistory(params),
        error: null,
      },
    }),
  );
}

test("import a program's history, then open a session as a read-only list", async () => {
  useViewStore.setState({ view: "history" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  expect(await screen.findByText("Aún no hay historial")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Importar historial" }));
  const dialog = await screen.findByRole("dialog");
  // Where each program keeps it, or what to choose.
  expect(await within(dialog).findByText(/Traktor 3\.11\.1\/History/)).toBeVisible();
  expect(within(dialog).getByText(/Exporta la colección en formato xml/)).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "Importar el historial de Rekordbox" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Importar el historial de Traktor" }),
  );
  expect(last("history.import")).toEqual({ source: "traktor", path: null });
  finishImport();
  expect(await within(dialog).findByText("Traktor: 2 sesiones · 9 reproducciones")).toBeVisible();
  const toast = useToastStore.getState().toasts.find((t) => t.title.startsWith("Historial"));
  expect(toast?.title).toBe("Historial de Traktor: 2 sesiones");
  expect(toast?.detail).toBe(
    "9 reproducciones de temas de tu biblioteca · 1 tema que no está en la biblioteca",
  );
  await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));

  const sessions = await screen.findByRole("list", { name: "Sesiones" });
  expect(within(sessions).getAllByRole("listitem")).toHaveLength(2);
  // The sidebar counts the sessions.
  const nav = screen.getByRole("button", { name: /^Historial/ });
  expect(within(nav).getByText("2")).toBeVisible();

  // The newest session first; it opens with its tracks in the order they were played.
  await user.click(within(sessions).getAllByRole("button", { name: /Traktor/ })[0] as HTMLElement);
  expect(await screen.findByText(/solo lectura/)).toBeVisible();
  await waitFor(() =>
    expect(last("library.list")).toMatchObject({ sessionId: 1, sort: "position" }),
  );
  const rows = await screen.findAllByRole("row");
  expect(rows.some((r) => within(r).queryByText("Midnight Bloom"))).toBe(true);
  // The play columns show once something has been played.
  expect(screen.getByRole("columnheader", { name: /Veces tocado/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Volver al historial" }));
  expect(await screen.findByRole("list", { name: "Sesiones" })).toBeVisible();
});

test("mark the selection as played on a day, and undo it from the notice", async () => {
  useViewStore.setState({ view: "library" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  // Nothing played yet: no play columns.
  await screen.findByText("Midnight Bloom");
  expect(screen.queryByRole("columnheader", { name: /Veces tocado/ })).toBeNull();
  await user.click(screen.getByText("Midnight Bloom"));
  await user.click(screen.getByRole("button", { name: "Más acciones" }));
  await user.click(screen.getByRole("menuitem", { name: /Marcar como tocado/ }));
  const dialog = await screen.findByRole("dialog");
  const day = new Date(Date.now() - 3 * DAY);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  const input = within(dialog).getByLabelText("Día");
  await user.clear(input);
  await user.type(input, iso);
  await user.type(within(dialog).getByLabelText("Nombre de la sesión"), "Bolo sábado");
  await user.click(within(dialog).getByRole("button", { name: "Marcar como tocado" }));
  expect(last("history.markPlayed")).toEqual({
    trackIds: [1],
    playlistId: null,
    playedAt: iso,
    name: "Bolo sábado",
  });
  expect(await screen.findByRole("columnheader", { name: /Veces tocado/ })).toBeVisible();
  const toast = useToastStore.getState().toasts.find((t) => t.title.startsWith("Marcado"));
  expect(toast?.title).toBe("Marcado como tocado · 1 tema");
  act(() => toast?.action?.run());
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "history.deleteSession", params: { sessionId: 1 } }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("columnheader", { name: /Veces tocado/ })).toBeNull(),
  );
});

test("a future day cannot be marked", async () => {
  useViewStore.setState({ view: "library" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByText("Neon Cathedral"));
  await user.click(screen.getByRole("button", { name: "Más acciones" }));
  await user.click(screen.getByRole("menuitem", { name: /Marcar como tocado/ }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Día");
  await user.clear(input);
  await user.type(input, "2999-01-01");
  expect(within(dialog).getByRole("button", { name: "Marcar como tocado" })).toBeDisabled();
});

test("the set builder leaves out the tracks played recently and says how many", async () => {
  history.add("traktor", null, Date.now() - 2 * DAY, [2]);
  useViewStore.setState({ view: "builder" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await screen.findByRole("heading", { name: "Constructor de sets" });
  await user.click(screen.getByRole("switch", { name: "Evitar temas tocados hace poco" }));
  await waitFor(() => expect(last("settings.set")).toEqual({ historyAvoidDays: 30 }));
  expect(await screen.findByLabelText("Días que se evitan")).toHaveValue(30);
  await user.click(screen.getByRole("button", { name: "Generar set" }));
  await waitFor(() =>
    expect(last<BuilderGenerateParams>("builder.generate")).toMatchObject({ avoidPlayedDays: 30 }),
  );
  const set = await screen.findByRole("list", { name: "Set" });
  expect(within(set).queryByText("Golden Hour Tide")).toBeNull();
  expect(screen.getByText("1 tema fuera: tocado en los últimos 30 días")).toBeVisible();
});
