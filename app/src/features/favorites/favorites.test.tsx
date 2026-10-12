// Mashup favorites (SPEC 2.15, DESIGN 6.11, task 8.6): save from Pro with a rating, the
// favorites screen (stars, notes, sort, search), open in decks, export to the DAW, remove.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { FavoriteSaveParams, StemExportParams } from "../../lib/rpc.types";
import { FakeAudioContext } from "../../test/fakeAudio";
import {
  calls,
  engine,
  fakeFavorites,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  stemSet,
  track,
} from "../../test/fakeEngine";
import { EMPTY_FILTERS, useDecksStore } from "../decks/decksStore";
import { player, setAudioContextFactory, usePlaybackStore } from "../decks/syncPlayer";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";

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

const ready = { status: "ready" as const };
let ctx: FakeAudioContext;

beforeEach(async () => {
  resetEngine();
  engine.tracks = [
    track(1, {
      ...ready,
      title: "Midnight Bloom",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 7,
    }),
    track(4, {
      ...ready,
      title: "Run The Signal",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 8,
    }),
    track(6, { ...ready, title: "Heatwave", keyRoot: 11, keyMode: "minor", bpm: 128, energy: 9 }),
  ];
  engine.details.set(1, {
    beatGrid: { kind: "constant", bpm: 124, first_downbeat: 0.3, beats: null },
  });
  engine.details.set(4, {
    beatGrid: { kind: "constant", bpm: 124, first_downbeat: 0.9, beats: null },
  });
  engine.settings.dawFolder = "/Users/dj/Ableton";
  ctx = new FakeAudioContext();
  setAudioContextFactory(() => ctx as unknown as AudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ),
  );
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useDecksStore.setState({
    mode: "mashup",
    trackA: 1,
    idea: 0,
    filters: EMPTY_FILTERS,
    allowShift: false,
    energyDirection: "up",
    filtersOpen: false,
    anchors: { a: null, b: null },
    crossfadeBars: 16,
    shifts: { a: 0, b: 0 },
    stems: { a: "mix", b: "mix" },
    loops: { a: null, b: null },
    freeLoops: { a: null, b: null },
    pinnedB: null,
  });
  useViewStore.setState({ view: "library" });
  usePlaybackStore.setState({ status: "idle", kind: null, clocks: {}, error: null });
  await i18n.changeLanguage("es");
});

afterEach(() => {
  player.stop();
  vi.unstubAllGlobals();
});

const params = (method: string) =>
  calls.filter((c) => c.method === method).map((c) => c.params) as unknown[];

const FAVORITE: FavoriteSaveParams = {
  trackA: 4,
  trackB: 1,
  mode: "mashup",
  shiftA: 0,
  shiftB: -1,
  cueA: 0.9,
  cueB: 62.2,
  stemA: "vocals",
  stemB: "instrumental",
  bpmFactor: 1,
  rating: 3,
  notes: "Acapella encima",
};

async function openFavorites() {
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /Mashups favoritos/ }));
  return screen.findByRole("heading", { name: "Mashups favoritos" });
}

describe("favorites", () => {
  it("saves the combination heard in Pro and rates it there", async () => {
    useViewStore.setState({ view: "pro" });
    renderWithQuery(<App />);
    await screen.findByRole("region", { name: /^Deck B: / });
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Stem de Deck A" })).getByRole("radio", {
        name: "Voz",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar favorito" }));
    await waitFor(() => expect(params("favorites.save")).toHaveLength(1));
    const saved = params("favorites.save")[0] as FavoriteSaveParams;
    expect(saved).toMatchObject({
      trackA: 1,
      mode: "mashup",
      shiftA: 0,
      cueA: 0.3,
      stemA: "vocals",
      stemB: "mix",
      bpmFactor: 1,
    });
    expect([4, 6]).toContain(saved.trackB);
    expect(await screen.findByText("Guardado en favoritos")).toBeInTheDocument();

    // Saved: the button says so and the stars rate it.
    const rating = await screen.findByRole("radiogroup", { name: "Valoración" });
    expect(screen.getByRole("button", { name: "En favoritos" })).toBeInTheDocument();
    await userEvent.click(within(rating).getByRole("radio", { name: "4 estrellas" }));
    await waitFor(() =>
      expect(params("favorites.update").at(-1)).toEqual({ favoriteId: 1, rating: 4 }),
    );
    // The sidebar counts it.
    expect(screen.getByRole("button", { name: /Mashups favoritos/ })).toHaveTextContent("1");

    // Reaching the favourites through the sidebar retires "Saved · View favourites".
    await userEvent.click(screen.getByRole("button", { name: /Mashups favoritos/ }));
    await waitFor(() => expect(screen.queryByText("Guardado en favoritos")).toBeNull());
  });

  it("marks a doubtful key on the favourite card too", async () => {
    engine.tracks = engine.tracks.map((tr) => (tr.id === 1 ? { ...tr, keyConfidence: 0.3 } : tr));
    fakeFavorites.save(FAVORITE);
    await openFavorites();
    const card = await screen.findByRole("article");
    expect(within(card).getByLabelText("Confianza baja")).toBeInTheDocument();
  });

  it("lists, sorts, searches, rates and annotates the favorites", async () => {
    fakeFavorites.save(FAVORITE);
    fakeFavorites.save({ trackA: 1, trackB: 6, mode: "mix", rating: 5, bpmFactor: 1 });
    await openFavorites();
    const cards = () => screen.getAllByRole("article").map((c) => c.getAttribute("aria-label"));
    expect(cards()).toEqual(["Midnight Bloom + Heatwave", "Run The Signal + Midnight Bloom"]);
    const first = screen.getByRole("article", { name: "Run The Signal + Midnight Bloom" });
    expect(within(first).getByText("Mashup")).toBeInTheDocument();
    expect(within(first).getByText("−1 st")).toBeInTheDocument();
    // B keeps its original key next to the shifted one: "8A → 1A −1 st" (A is 8A too).
    expect(within(first).getByText("1A")).toBeInTheDocument();
    expect(within(first).getAllByText("8A")).toHaveLength(2);
    expect(within(first).getByLabelText("pasa a")).toBeInTheDocument();
    expect(within(first).getByText("Voz")).toBeInTheDocument();
    expect(within(first).getByText("Instrumental")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Valoración" }));
    expect(params("favorites.list").at(-1)).toEqual({ sort: "rating" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar favoritos" }), "signal");
    expect(cards()).toEqual(["Run The Signal + Midnight Bloom"]);

    const stars = within(first).getByRole("radiogroup", { name: "Valoración" });
    await userEvent.click(within(stars).getByRole("radio", { name: "5 estrellas" }));
    await waitFor(() =>
      expect(params("favorites.update").at(-1)).toEqual({ favoriteId: 1, rating: 5 }),
    );
    // Clicking the current rating clears it.
    await userEvent.click(within(stars).getByRole("radio", { name: "5 estrellas" }));
    await waitFor(() =>
      expect(params("favorites.update").at(-1)).toEqual({ favoriteId: 1, rating: 0 }),
    );

    const notes = within(first).getByRole("textbox", { name: "Notas" });
    await userEvent.clear(notes);
    await userEvent.type(notes, "Entra en el drop");
    notes.blur();
    await waitFor(() =>
      expect(params("favorites.update").at(-1)).toEqual({
        favoriteId: 1,
        notes: "Entra en el drop",
      }),
    );
  });

  it("opens a favorite in the decks as it was saved", async () => {
    fakeFavorites.save(FAVORITE);
    await openFavorites();
    await userEvent.click(screen.getByRole("button", { name: "Abrir en decks" }));
    const deckB = await screen.findByRole("region", { name: "Deck B: Midnight Bloom" });
    expect(screen.getByRole("region", { name: "Deck A: Run The Signal" })).toBeInTheDocument();
    expect(within(deckB).getByText("Favorito")).toBeInTheDocument();
    expect(within(deckB).getByText("−1 st")).toBeInTheDocument();
    const stemA = screen.getByRole("radiogroup", { name: "Stem de Deck A" });
    expect(within(stemA).getByRole("radio", { name: "Voz" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: "En favoritos" })).toBeInTheDocument();
    // B is none of the ideas.
    expect(
      within(screen.getByRole("listbox")).queryByRole("option", { selected: true }),
    ).not.toBeInTheDocument();

    // The arrows go back to the ideas.
    await userEvent.click(within(deckB).getByRole("button", { name: "Idea siguiente" }));
    expect(await screen.findByText(/^Idea 1 \//)).toBeInTheDocument();
  });

  it("plays a favorite from its card", async () => {
    fakeFavorites.save(FAVORITE);
    engine.stems.sets.set(4, stemSet(4));
    await openFavorites();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir favorito" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    const renders = params("render.preview").slice(-2);
    // A's vocals exist; B has no stems yet, so its full track plays (at A's tempo, −1 st).
    expect(renders).toEqual([
      expect.objectContaining({ trackId: 4, source: "vocals", start: 0.9, semitones: 0 }),
      expect.objectContaining({ trackId: 1, source: "mix", start: 62.2, semitones: -1 }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Parar favorito" }));
    expect(usePlaybackStore.getState().status).toBe("idle");
  });

  it("exports the two processed files of a favorite", async () => {
    fakeFavorites.save(FAVORITE);
    await openFavorites();
    await userEvent.click(screen.getByRole("button", { name: "Exportar al DAW" }));
    const dialog = await screen.findByRole("dialog", { name: "Exportar favorito" });
    // No stems yet: separate them first.
    expect(within(dialog).getByRole("button", { name: "Separar stems" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Exportar 2 archivos/ })).toBeDisabled();
  });

  it("exports with the key and tempo applied, or the originals", async () => {
    fakeFavorites.save({ ...FAVORITE, bpmFactor: 0.5 });
    engine.stems.sets.set(4, stemSet(4));
    engine.stems.sets.set(1, stemSet(1));
    await openFavorites();
    await userEvent.click(screen.getByRole("button", { name: "Exportar al DAW" }));
    const dialog = await screen.findByRole("dialog", { name: "Exportar favorito" });
    await waitFor(() => expect(params("stems.exportPreview").length).toBeGreaterThan(0));
    expect((params("stems.exportPreview").at(-1) as StemExportParams).items).toEqual([
      { trackId: 4, source: "vocals", semitones: 0, targetBpm: null },
      { trackId: 1, source: "instrumental", semitones: -1, targetBpm: 248 },
    ]);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Originales" }));
    await waitFor(() =>
      expect((params("stems.exportPreview").at(-1) as StemExportParams).items).toEqual([
        { trackId: 4, source: "vocals", semitones: 0, targetBpm: null },
        { trackId: 1, source: "instrumental", semitones: 0, targetBpm: null },
      ]),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Exportar 2 archivos" }));
    await waitFor(() => expect(params("stems.export")).toHaveLength(1));
    expect(params("stems.export")[0]).toMatchObject({ destination: "/Users/dj/Ableton" });
  });

  it("removes a favorite with undo", async () => {
    fakeFavorites.save(FAVORITE);
    await openFavorites();
    await userEvent.click(screen.getByRole("button", { name: "Quitar de favoritos" }));
    await waitFor(() => expect(params("favorites.delete")).toEqual([{ favoriteId: 1 }]));
    expect(await screen.findByText("Aún no hay mashups favoritos")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(
      await screen.findByRole("article", { name: "Run The Signal + Midnight Bloom" }),
    ).toBeInTheDocument();
    expect(params("favorites.save").at(-1)).toMatchObject({
      ...FAVORITE,
      notes: "Acapella encima",
    });
  });
});
