import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { useLibraryStore } from "../features/library/store";
import { useViewStore } from "../features/navigation/viewStore";
import i18n from "../i18n";
import {
  addPlaylist,
  engine,
  fakeFavorites,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../test/fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { method: string; params: unknown }) => invoke(cmd, args),
  convertFileSrc: (path: string) => path,
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
  engine.tracks = [
    track(1, { title: "Midnight Bloom", status: "ready", keyRoot: 9, keyMode: "minor", bpm: 124 }),
    track(2, {
      title: "Golden Hour Tide",
      status: "ready",
      keyRoot: 4,
      keyMode: "minor",
      bpm: 124,
    }),
  ];
  useLibraryStore.setState({ search: "", filter: {}, selected: [] });
  useViewStore.setState({ view: "library", infoTrackId: null });
  await i18n.changeLanguage("es");
});

describe("empty states", () => {
  it("an empty playlist explains how to fill it and leads to the library", async () => {
    addPlaylist("Por probar", {}, []);
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByText("Por probar"));
    expect(
      await screen.findByRole("heading", { name: "Esta playlist está vacía" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ir a la biblioteca" }));
    expect(useViewStore.getState().view).toBe("library");
  });

  it("a search with no results says so and clears the search", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(
      await screen.findByRole("heading", { name: "Ningún tema coincide" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Prueba con otra búsqueda o quita algún filtro.")).toBeInTheDocument();
    // (The search box has its own clear button too.)
    const clear = screen.getAllByRole("button", { name: "Borrar búsqueda" }).at(-1);
    await userEvent.click(clear as HTMLElement);
    expect(await screen.findByText("Midnight Bloom")).toBeInTheDocument();
  });

  it("no favorites yet leads to Pro mode", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    act(() => useViewStore.getState().show("favorites"));
    expect(
      await screen.findByRole("heading", { name: "Aún no hay favoritos" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ir al modo Pro" }));
    expect(useViewStore.getState().view).toBe("pro");
  });

  it("a favorites search with no match offers to clear it", async () => {
    fakeFavorites.call("favorites.save", {
      trackA: 1,
      trackB: 2,
      mode: "mashup",
      shiftA: 0,
      shiftB: 0,
    });
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    act(() => useViewStore.getState().show("favorites"));
    const search = await screen.findByRole("searchbox");
    await userEvent.type(search, "nada así");
    expect(
      await screen.findByRole("heading", { name: "Ningún favorito coincide con la búsqueda." }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Borrar búsqueda" }));
    expect(search).toHaveValue("");
    expect(screen.queryByRole("heading", { name: /Ningún favorito/ })).toBeNull();
  });
});
