// Sidebar playlists, smart playlists, drag and drop and M3U (SPEC 2.11).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useToastStore } from "../toast/toastStore";
import { useDragStore } from "./dragStore";

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
  useLibraryStore.setState({
    search: "",
    sort: "added_at",
    descending: true,
    playlistSort: "position",
    playlistDescending: false,
    density: "comfortable",
    selected: [],
  });
  useToastStore.setState({ toasts: [] });
  useViewStore.setState({ view: "library", playlistId: null });
  useDragStore.setState({ payload: null, target: null });
  engine.tracks = [
    track(1, { title: "Midnight Bloom", energy: 7, addedAt: "2026-10-01T10:00:00Z" }),
    track(2, { title: "Golden Hour Tide", energy: 6, addedAt: "2026-10-02T10:00:00Z" }),
    track(3, { title: "Neon Cathedral", energy: 8, addedAt: "2026-10-03T10:00:00Z" }),
  ];
  await i18n.changeLanguage("es");
});

function sidebar(): HTMLElement {
  return screen.getByRole("complementary");
}

function treeItem(name: string): HTMLElement {
  const item = within(sidebar())
    .getAllByRole("treeitem")
    .find((li) => li.querySelector("button")?.textContent?.includes(name));
  if (!item) throw new Error(`no tree item ${name}`);
  return item;
}

function itemButton(name: string): HTMLElement {
  const button = treeItem(name).querySelector<HTMLElement>("button");
  if (!button) throw new Error(`no button for ${name}`);
  return button;
}

function rowWith(text: string): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`no row ${text}`);
  return row;
}

/** Pointer drag from `source` to `target` (a drop zone element). */
function drag(source: HTMLElement, target: HTMLElement) {
  fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
  fireEvent.pointerMove(target, { clientX: 40, clientY: 40 });
  fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
}

function seedTree() {
  const gigs = addPlaylist("Bolos", { isFolder: true, emoji: "📁" });
  const warm = addPlaylist("Warm-up Ibiza", { parentId: gigs.id, emoji: "🌅" }, [3, 1]);
  const peak = addPlaylist("Peak time", { parentId: gigs.id, emoji: "🔥" }, []);
  const loose = addPlaylist("Por probar", { emoji: "🧪" }, [2]);
  const smart = addPlaylist("Energía 8+", { emoji: "🔥", smart: { energyMin: 8 } });
  return { gigs, warm, peak, loose, smart };
}

describe("sidebar playlists", () => {
  it("shows nested folders and playlists with emoji and counts", async () => {
    seedTree();
    renderWithQuery(<App />);
    await screen.findByText("Warm-up Ibiza");
    expect(within(sidebar()).getByText("Playlists")).toBeInTheDocument();
    expect(within(sidebar()).getByText("Inteligentes")).toBeInTheDocument();
    expect(within(treeItem("Bolos")).getByText("Peak time")).toBeInTheDocument();
    expect(within(itemButton("Warm-up Ibiza")).getByText("🌅")).toBeInTheDocument();
    expect(within(itemButton("Warm-up Ibiza")).getByText("2")).toBeInTheDocument();
    expect(within(itemButton("Energía 8+")).getByText("1")).toBeInTheDocument();

    // Folders collapse and remember it.
    await userEvent.click(itemButton("Bolos"));
    expect(screen.queryByText("Warm-up Ibiza")).not.toBeInTheDocument();
    expect(treeItem("Bolos")).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("tonalia.playlists.collapsed")).toBe("[1]");
  });

  it("opens a playlist in its own order and a smart playlist with its matches", async () => {
    seedTree();
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Warm-up Ibiza"));
    expect(await screen.findByRole("heading", { name: "Warm-up Ibiza" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Neon Cathedral");
    expect(screen.getAllByRole("row")[2]).toHaveTextContent("Midnight Bloom");
    expect(screen.getByRole("columnheader", { name: "#" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await userEvent.click(screen.getByText("Energía 8+"));
    expect(await screen.findByRole("heading", { name: "Energía 8+" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Editar condiciones" })).toBeInTheDocument();
  });

  it("creates a playlist and renames it inline", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("button", { name: "Nueva playlist o carpeta" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Nueva playlist" }));
    const input = await screen.findByRole("textbox", { name: "Nombre" });
    await userEvent.clear(input);
    await userEvent.type(input, "Cierre 🌙{Enter}");
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.update",
        params: { playlistId: 1, name: "Cierre 🌙" },
      }),
    );
    expect(await screen.findByText("Cierre 🌙")).toBeInTheDocument();
  });

  it("changes the emoji from the item menu", async () => {
    seedTree();
    renderWithQuery(<App />);
    await screen.findByText("Por probar");
    await userEvent.click(screen.getByRole("button", { name: "Acciones de «Por probar»" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cambiar emoji" }));
    await userEvent.click(screen.getByRole("button", { name: "🪩" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.update",
        params: { playlistId: 4, emoji: "🪩" },
      }),
    );
  });

  it("deletes a folder after confirming and leaves an open playlist inside it", async () => {
    const { gigs } = seedTree();
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Warm-up Ibiza"));
    await screen.findByRole("heading", { name: "Warm-up Ibiza" });
    await userEvent.click(screen.getByRole("button", { name: "Acciones de «Bolos»" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(
      screen.getByText("¿Eliminar la carpeta «Bolos» y todo lo que contiene?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "playlists.delete", params: { playlistId: gigs.id } }),
    );
    expect(await screen.findByRole("heading", { name: "Todos los temas" })).toBeInTheDocument();
    expect(screen.queryByText("Warm-up Ibiza")).not.toBeInTheDocument();
  });
});

describe("drag and drop", () => {
  it("drags the selected tracks onto a playlist", async () => {
    const { peak } = seedTree();
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    const user = userEvent.setup();
    await user.click(within(rowWith("Midnight Bloom")).getByText("Midnight Bloom"));
    await user.keyboard("{Meta>}");
    await user.click(within(rowWith("Golden Hour Tide")).getByText("Golden Hour Tide"));
    await user.keyboard("{/Meta}");

    drag(
      within(rowWith("Golden Hour Tide")).getByText("Golden Hour Tide"),
      itemButton("Peak time"),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.addTracks",
        params: { playlistId: peak.id, trackIds: [1, 2] },
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.title).toBe("2 temas añadidos a «Peak time»"),
    );
  });

  it("does not drop tracks on folders or smart playlists", async () => {
    seedTree();
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    drag(within(rowWith("Neon Cathedral")).getByText("Neon Cathedral"), itemButton("Bolos"));
    drag(within(rowWith("Neon Cathedral")).getByText("Neon Cathedral"), itemButton("Energía 8+"));
    await act(async () => Promise.resolve());
    expect(calls.some((c) => c.method === "playlists.addTracks")).toBe(false);
  });

  it("moves a playlist into a folder by dragging", async () => {
    const { gigs, loose } = seedTree();
    renderWithQuery(<App />);
    await screen.findByText("Por probar");
    drag(itemButton("Por probar"), itemButton("Bolos"));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.move",
        params: { playlistId: loose.id, parentId: gigs.id, index: 2 },
      }),
    );
    // The drag did not also open the playlist.
    expect(useViewStore.getState().view).toBe("library");
  });

  it("reorders tracks inside a playlist", async () => {
    const { warm } = seedTree();
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Warm-up Ibiza"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    // Drag the second row (Midnight Bloom) onto the first: jsdom rows have no height,
    // so the drop lands before the target row.
    drag(within(rowWith("Midnight Bloom")).getByText("Midnight Bloom"), rowWith("Neon Cathedral"));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.reorderTracks",
        params: { playlistId: warm.id, trackIds: [1], index: 0 },
      }),
    );
    await waitFor(() => expect(screen.getAllByRole("row")[1]).toHaveTextContent("Midnight Bloom"));
  });

  it("cancels a drag with Escape", async () => {
    seedTree();
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    const source = within(rowWith("Neon Cathedral")).getByText("Neon Cathedral");
    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
    expect(useDragStore.getState().payload?.label).toBe("Neon Cathedral");
    fireEvent.pointerMove(itemButton("Peak time"), { clientX: 30, clientY: 30 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);
    expect(useDragStore.getState().payload).toBeNull();
    await act(async () => Promise.resolve());
    expect(calls.some((c) => c.method === "playlists.addTracks")).toBe(false);
  });
});

describe("selection actions", () => {
  it("adds the selection from the Add to playlist menu", async () => {
    const { loose } = seedTree();
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(within(rowWith("Neon Cathedral")).getByText("Neon Cathedral"));
    await userEvent.click(screen.getByRole("button", { name: "Añadir a playlist" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Por probar/ }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.addTracks",
        params: { playlistId: loose.id, trackIds: [3] },
      }),
    );
  });

  it("removes the selection from a playlist", async () => {
    const { warm } = seedTree();
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Warm-up Ibiza"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    await userEvent.click(within(rowWith("Neon Cathedral")).getByText("Neon Cathedral"));
    await userEvent.click(screen.getByRole("button", { name: "Quitar de la playlist" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.removeTracks",
        params: { playlistId: warm.id, trackIds: [3] },
      }),
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
  });

  it("shows an empty playlist hint", async () => {
    seedTree();
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Peak time"));
    expect(await screen.findByText("Esta playlist está vacía")).toBeInTheDocument();
  });
});

describe("smart playlists", () => {
  it("creates one from its conditions", async () => {
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("button", { name: "Nueva playlist inteligente" }));
    const dialog = await screen.findByRole("dialog", { name: "Nueva playlist inteligente" });
    const saveButton = within(dialog).getByRole("button", { name: "Guardar" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Nombre" }), "Pico");
    expect(saveButton).toBeDisabled();
    expect(within(dialog).getByText("Elige al menos una condición")).toBeInTheDocument();
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Energía mínima" }),
      "8",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "8A (menor)" }));
    await userEvent.click(within(dialog).getByRole("switch", { name: "Incluir compatibles" }));
    await userEvent.click(saveButton);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.create",
        params: {
          name: "Pico",
          emoji: "🔮",
          smart: { energyMin: 8, keys: [{ root: 9, mode: "minor" }], compatible: true },
        },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Pico" })).toBeInTheDocument();
  });
});

describe("M3U", () => {
  it("imports a playlist file and opens it", async () => {
    openDialog.mockResolvedValue("/Users/dj/Listas/Warm-up 🌅.m3u8");
    renderWithQuery(<App />);
    await screen.findByText("3 temas");
    await userEvent.click(screen.getByRole("button", { name: "Nueva playlist o carpeta" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Importar M3U…" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.importM3u",
        params: { path: "/Users/dj/Listas/Warm-up 🌅.m3u8", parentId: null },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Warm-up 🌅" })).toBeInTheDocument();
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.title).toBe("Importada «Warm-up 🌅» · 1 tema");
    expect(toast?.detail).toBe("1 entrada no se encontró en el disco");
    expect(toast?.tone).toBe("warning");
  });

  it("exports a playlist to the chosen file", async () => {
    const { warm } = seedTree();
    saveDialog.mockResolvedValue("/Users/dj/Desktop/Warm-up Ibiza.m3u8");
    renderWithQuery(<App />);
    await screen.findByText("Warm-up Ibiza");
    await userEvent.click(screen.getByRole("button", { name: "Acciones de «Warm-up Ibiza»" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Exportar M3U…" }));
    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Warm-up Ibiza.m3u8" }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "playlists.exportM3u",
        params: { playlistId: warm.id, path: "/Users/dj/Desktop/Warm-up Ibiza.m3u8" },
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.title).toBe("Exportados 2 temas"),
    );
  });
});
