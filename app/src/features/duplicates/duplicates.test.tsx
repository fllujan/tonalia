// Duplicates (SPEC 13.3, DESIGN 6.21): search, the groups with the proposed copy and why,
// merge (with confirmation and Undo), the trash only when ticked, keep all and versions.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  calls,
  duplicates,
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
import { useDuplicateScan } from "./api";

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

beforeEach(async () => {
  resetEngine();
  useToastStore.setState({ toasts: [] });
  useDuplicateScan.setState({ running: null, outcome: null });
  useViewStore.setState({ view: "duplicates" });
  engine.tracks = [track(1, { status: "ready" }), track(2, { status: "ready" })];
  await i18n.changeLanguage("es");
});

/** Finish the running scan the way the engine does. */
function finishScan() {
  const running = useDuplicateScan.getState().running;
  if (!running) throw new Error("no scan running");
  act(() => emit("engine://progress", { jobId: running.jobId, stage: "grouping", percent: 85 }));
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId: running.jobId,
        kind: "duplicates.scan",
        status: "done",
        result: duplicates.scan(),
        error: null,
      },
    }),
  );
}

async function scanned() {
  const user = userEvent.setup();
  renderWithQuery(<App />);
  expect(await screen.findByText("Busca duplicados en tu biblioteca")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Buscar duplicados" })[0] as HTMLElement);
  expect(calls).toContainEqual({ method: "duplicates.scan", params: { full: false } });
  expect(await screen.findByText(/Calculando la huella de audio/)).toBeVisible();
  finishScan();
  await screen.findByText(/Última búsqueda/);
  return user;
}

test("search, then each group says which copy to keep and why", async () => {
  await scanned();
  const bloom = await screen.findByRole("region", { name: /Mismo audio: Midnight Bloom/ });
  expect(within(bloom).getByText("Mejor copia")).toBeVisible();
  expect(within(bloom).getByText(/es FLAC, sin pérdida; la siguiente es MP3/)).toBeVisible();
  expect(within(bloom).getByText("MP3 · 128 kbps")).toBeVisible();
  expect(within(bloom).getByText("1 aviso de calidad")).toBeVisible();
  // The proposed copy is chosen.
  expect(
    within(bloom).getByRole("radio", { name: "Conservar Midnight Bloom (Original Mix)" }),
  ).toBeChecked();
  // Other versions are never merged: only "different versions".
  const neon = screen.getByRole("region", { name: /Otra versión: Neon Cathedral/ });
  expect(within(neon).queryByRole("button", { name: "Fusionar en la elegida" })).toBeNull();
  expect(within(neon).getByRole("button", { name: "Son versiones distintas" })).toBeVisible();
  // The sidebar counts the groups waiting.
  const nav = screen.getByRole("button", { name: /Duplicados/ });
  expect(within(nav).getByText("3")).toBeVisible();
});

test("merge asks first, keeps the chosen copy and can be undone", async () => {
  const user = await scanned();
  const bloom = await screen.findByRole("region", { name: /Mismo audio: Midnight Bloom/ });
  await user.click(within(bloom).getByRole("radio", { name: "Conservar Midnight Bloom" }));
  await user.click(within(bloom).getByRole("button", { name: "Fusionar en la elegida" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/su archivo sigue en el disco/)).toBeVisible();
  expect(within(dialog).getByText(/Puedes deshacerlo/)).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Fusionar" }));
  expect(calls).toContainEqual({
    method: "duplicates.resolve",
    params: { groupId: "audio:bloom", action: "merge", keepTrackId: 1, trash: false },
  });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: /Mismo audio: Midnight Bloom/ })).toBeNull(),
  );
  const toast = useToastStore.getState().toasts.find((t) => t.title.startsWith("Fusionado"));
  expect(toast?.title).toBe("Fusionado en «Midnight Bloom» · 1 copia fuera de la biblioteca");
  act(() => toast?.action?.run());
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "duplicates.undo",
      params: { mergeId: "fake-merge-1" },
    }),
  );
  expect(await screen.findByRole("region", { name: /Mismo audio: Midnight Bloom/ })).toBeVisible();
});

test("the trash is only used when ticked, and then the merge says it cannot be undone", async () => {
  const user = await scanned();
  const golden = await screen.findByRole("region", { name: /Idénticos: Golden Hour Tide/ });
  await user.click(
    within(golden).getByRole("checkbox", { name: "Mover la otra copia a la papelera del sistema" }),
  );
  await user.click(within(golden).getByRole("button", { name: "Fusionar en la elegida" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/va a la papelera del sistema/)).toBeVisible();
  expect(within(dialog).getByText(/no se puede deshacer desde Tonalia/)).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Fusionar y mover a la papelera" }));
  expect(calls).toContainEqual({
    method: "duplicates.resolve",
    params: { groupId: "identical:golden", action: "merge", keepTrackId: 2, trash: true },
  });
  await waitFor(() =>
    expect(useToastStore.getState().toasts.some((t) => t.title.startsWith("Fusionado"))).toBe(true),
  );
  const toast = useToastStore.getState().toasts.find((t) => t.title.startsWith("Fusionado"));
  expect(toast?.action).toBeUndefined();
});

test("keep all and different versions take the group away, with the filter by kind", async () => {
  const user = await scanned();
  await user.click(screen.getByRole("radio", { name: "Otra versión" }));
  expect(screen.queryByRole("region", { name: /Mismo audio/ })).toBeNull();
  const neon = screen.getByRole("region", { name: /Otra versión: Neon Cathedral/ });
  await user.click(within(neon).getByRole("button", { name: "Son versiones distintas" }));
  expect(calls).toContainEqual({
    method: "duplicates.resolve",
    params: { groupId: "version:neon", action: "distinct" },
  });
  expect(await screen.findByText("Ningún duplicado pendiente")).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "Todos" }));
  const golden = screen.getByRole("region", { name: /Idénticos: Golden Hour Tide/ });
  await user.click(within(golden).getByRole("button", { name: "Conservar todas" }));
  expect(calls).toContainEqual({
    method: "duplicates.resolve",
    params: { groupId: "identical:golden", action: "keep_all" },
  });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: /Idénticos: Golden Hour Tide/ })).toBeNull(),
  );
  expect(screen.getByText(/2 grupos resueltos/)).toBeVisible();
});
