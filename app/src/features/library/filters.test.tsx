// Advanced library filters (SPEC 2.14, DESIGN 6.2–6.3).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  addPlaylist,
  calls,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useViewStore } from "../navigation/viewStore";
import { activeConditions, withoutCondition } from "../playlists/filter";
import { useLibraryStore } from "./store";

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

beforeEach(async () => {
  resetEngine();
  useLibraryStore.setState({
    search: "",
    sort: "title",
    descending: false,
    filter: {},
    selected: [],
    density: "comfortable",
  });
  useViewStore.setState({ view: "library", playlistId: null });
  engine.tracks = [
    track(1, { title: "Midnight Bloom", keyRoot: 9, keyMode: "minor", bpm: 124, energy: 7 }),
    track(2, { title: "Golden Hour Tide", keyRoot: 4, keyMode: "minor", bpm: 124, energy: 6 }),
    track(3, { title: "Neon Cathedral", keyRoot: 0, keyMode: "major", bpm: 126, energy: 8,
      genre: "Techno" }), // prettier-ignore
    track(4, { title: "Cobalt Rain", keyRoot: 0, keyMode: "minor", bpm: 174, energy: 8 }),
    track(5, { title: "Paper Satellites", keyRoot: 1, keyMode: "major", bpm: 86, energy: 4 }),
  ];
  await i18n.changeLanguage("es");
});

function titles(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector(".font-medium")?.textContent ?? "");
}

async function openFilters() {
  await userEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  return screen.findByRole("dialog", { name: "Filtros avanzados" });
}

test("filters by compatible keys from the popover and shows a removable chip", async () => {
  renderWithQuery(<App />);
  await screen.findByText("5 temas");
  const dialog = await openFilters();
  await userEvent.click(within(dialog).getByRole("button", { name: "8A (menor)" }));
  await userEvent.click(within(dialog).getByRole("switch", { name: "Incluir compatibles" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));

  await waitFor(() =>
    expect(titles()).toEqual(["Golden Hour Tide", "Midnight Bloom", "Neon Cathedral"]),
  );
  expect(calls.at(-1)?.params).toMatchObject({
    filter: { keys: [{ root: 9, mode: "minor" }], compatible: true },
  });
  expect(screen.getByRole("button", { name: "Filtros (1 activo)" })).toBeInTheDocument();
  const chips = screen.getByRole("group", { name: "Filtros activos" });
  expect(within(chips).getByText("Tonalidad: compatible con 8A")).toBeInTheDocument();

  await userEvent.click(
    within(chips).getByRole("button", { name: "Quitar filtro Tonalidad: compatible con 8A" }),
  );
  await waitFor(() => expect(titles()).toHaveLength(5));
  expect(screen.queryByRole("group", { name: "Filtros activos" })).not.toBeInTheDocument();
});

test("BPM range with half/double and energy combine", async () => {
  renderWithQuery(<App />);
  await screen.findByText("5 temas");
  const dialog = await openFilters();
  await userEvent.type(within(dialog).getByRole("textbox", { name: "BPM mínimo" }), "170");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "BPM máximo" }), "176");
  await userEvent.click(within(dialog).getByRole("switch", { name: "Incluir ×2 / ÷2" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(titles()).toEqual(["Cobalt Rain", "Paper Satellites"]));
  expect(screen.getByText("BPM 170–176 · ×2 / ÷2")).toBeInTheDocument();

  const again = await openFilters();
  fireEvent.change(within(again).getByRole("slider", { name: "Energía mínima" }), {
    target: { value: "6" },
  });
  await userEvent.click(within(again).getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(titles()).toEqual(["Cobalt Rain"]));
  expect(screen.getByText("Energía ≥ 6")).toBeInTheDocument();
});

test("no matches offers to clear the filters; Clear empties the draft", async () => {
  useLibraryStore.setState({ filter: { genres: ["Reggaeton"] } });
  renderWithQuery(<App />);
  expect(await screen.findByText("Ningún tema coincide")).toBeInTheDocument();
  const clear = screen.getAllByRole("button", { name: "Quitar filtros" }).at(-1);
  if (!clear) throw new Error("no clear button");
  await userEvent.click(clear);
  await waitFor(() => expect(titles()).toHaveLength(5));

  useLibraryStore.setState({ filter: { energyMin: 8 } });
  const dialog = await openFilters();
  await userEvent.click(within(dialog).getByRole("button", { name: "Limpiar" }));
  expect(within(dialog).getByRole("slider", { name: "Energía mínima" })).toHaveValue("1");
  await userEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));
  expect(useLibraryStore.getState().filter).toEqual({});
});

test("filters by playlist and saves the filters as a smart playlist", async () => {
  const set = addPlaylist("Peak time", { emoji: "🔥" }, [3, 4]);
  renderWithQuery(<App />);
  await screen.findByText("5 temas");
  const dialog = await openFilters();
  await userEvent.selectOptions(
    within(dialog).getByRole("combobox", { name: "Playlist" }),
    String(set.id),
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(titles()).toEqual(["Cobalt Rain", "Neon Cathedral"]));
  expect(screen.getByText("Playlist: Peak time")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Guardar como playlist inteligente" }));
  const smart = await screen.findByRole("dialog", { name: "Nueva playlist inteligente" });
  await userEvent.type(within(smart).getByRole("textbox", { name: "Nombre" }), "De Peak");
  await userEvent.click(within(smart).getByRole("button", { name: "Guardar" }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "playlists.create",
      params: { name: "De Peak", emoji: "🔮", smart: { playlistId: set.id } },
    }),
  );
});

test("filter helpers list and drop conditions", () => {
  const f = { keys: [{ root: 9, mode: "minor" as const }], compatible: true, bpmMin: 120,
    bpmHalfDouble: true, favorites: true }; // prettier-ignore
  expect(activeConditions(f)).toEqual(["keys", "bpm", "favorites"]);
  expect(withoutCondition(f, "keys")).toEqual({
    bpmMin: 120,
    bpmHalfDouble: true,
    favorites: true,
  });
  expect(withoutCondition(f, "bpm")).toEqual({
    keys: [{ root: 9, mode: "minor" }], compatible: true, favorites: true,
  }); // prettier-ignore
});
