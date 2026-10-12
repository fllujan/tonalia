// Automated accessibility checks (SPEC 3, 10.1): every screen is run through axe-core
// against WCAG 2.1 A/AA. jsdom does not lay out or paint, so colour contrast is checked
// separately on the design tokens (contrast.test.ts) and focus order by the keyboard tests.
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import App from "../App";
import { useDecksStore } from "../features/decks/decksStore";
import { useLibraryStore } from "../features/library/store";
import { useViewStore } from "../features/navigation/viewStore";
import { useShortcutsDialog } from "../features/shortcuts/shortcuts";
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
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${v.help} → ${n.html.slice(0, 160)}`),
  );
}

const ready = { status: "ready" as const, bpm: 124, energy: 7 };

beforeEach(async () => {
  resetEngine();
  engine.tracks = [
    track(1, { ...ready, title: "Midnight Bloom", keyRoot: 9, keyMode: "minor" }),
    track(2, { ...ready, title: "Golden Hour Tide", keyRoot: 4, keyMode: "minor" }),
    track(3, { ...ready, title: "Neon Cathedral", keyRoot: 0, keyMode: "major", bpm: 126 }),
    track(4, { ...ready, title: "Run The Signal", keyRoot: 9, keyMode: "minor" }),
    track(5, { title: "Unanalysed One" }),
  ];
  addPlaylist("Warm-up Ibiza", { emoji: "🌅" }, [1, 2, 3]);
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useViewStore.setState({ view: "library", infoTrackId: null, trackId: null });
  useDecksStore.setState({ trackA: null, idea: 0 });
  useShortcutsDialog.setState({ open: false });
  await i18n.changeLanguage("es");
});

const show = (view: Parameters<ReturnType<typeof useViewStore.getState>["show"]>[0]) =>
  act(() => useViewStore.getState().show(view));

describe("accessibility (axe, WCAG 2.1 AA)", () => {
  it("library, filters, review and a playlist", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    expect(await violations()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    expect(await violations()).toEqual([]);
    await userEvent.keyboard("{Escape}");
    show("review");
    await waitFor(() => expect(useViewStore.getState().view).toBe("review"));
    expect(await violations()).toEqual([]);
    await userEvent.click(screen.getByText("Warm-up Ibiza"));
    await screen.findByRole("heading", { name: "Warm-up Ibiza" });
    expect(await violations()).toEqual([]);
  });

  it("track detail and the track info panel", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    act(() => useViewStore.getState().openDetail(1));
    await screen.findByRole("button", { name: /Volver/ });
    expect(await violations()).toEqual([]);
    act(() => useViewStore.getState().openInfo(1));
    await screen.findByRole("dialog");
    expect(await violations()).toEqual([]);
  });

  it("pro mode with both decks", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    show("pro");
    await screen.findByRole("heading", { name: "Carga un tema en el deck A" });
    expect(await violations()).toEqual([]);
    act(() => useDecksStore.getState().loadA(1));
    await screen.findByRole("region", { name: /^Deck B: / });
    expect(await violations()).toEqual([]);
  });

  it("favorites, set builder, export, tags and guides", async () => {
    fakeFavorites.call("favorites.save", {
      trackA: 1,
      trackB: 4,
      mode: "mashup",
      shiftA: 0,
      shiftB: 0,
      rating: 4,
    });
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    show("favorites");
    await screen.findByRole("heading", { name: /favoritos/i });
    expect(await violations()).toEqual([]);
    show("builder");
    await screen.findByRole("button", { name: "Generar set" });
    expect(await violations()).toEqual([]);
    show("export");
    await screen.findAllByRole("button", { name: /Simular/ });
    expect(await violations()).toEqual([]);
    act(() => useViewStore.getState().openTags([1, 2]));
    await waitFor(() => expect(useViewStore.getState().view).toBe("tags"));
    expect(await violations()).toEqual([]);
    show("guides");
    await waitFor(() => expect(useViewStore.getState().view).toBe("guides"));
    expect(await violations()).toEqual([]);
  });

  it("every settings section and the shortcuts dialog", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    show("settings");
    for (const name of ["General", "Análisis", "Carpetas vigiladas", "Stems", "Acerca de"]) {
      await userEvent.click(await screen.findByRole("button", { name }));
      expect(await violations()).toEqual([]);
    }
    act(() => useShortcutsDialog.getState().setOpen(true));
    await screen.findByRole("dialog", { name: "Atajos de teclado" });
    expect(await violations()).toEqual([]);
  });

  it("offers a skip link to the main content as the first tab stop", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
  });

  it("the welcome screen", async () => {
    engine.tracks = [];
    renderWithQuery(<App />);
    await screen.findByRole("heading", { name: "Bienvenido a Tonalia" });
    expect(await violations()).toEqual([]);
  });
});
