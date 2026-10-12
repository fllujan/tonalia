// Pro mode (SPEC 2.15, DESIGN 6.9 and 6.10): two decks, Mashup ↔ DJ Mix, idea arrows with
// score and reasons, idea list and idea filter.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  calls,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import type { SuggestParams, SuggestReason } from "../../lib/rpc.types";
import en from "../../i18n/en.json";
import es from "../../i18n/es.json";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { reasonText } from "../suggestions/reasons";
import { EMPTY_FILTERS, useDecksStore } from "./decksStore";

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
    track(2, {
      ...ready,
      title: "Golden Hour Tide",
      keyRoot: 4,
      keyMode: "minor",
      bpm: 124,
      energy: 6,
      genre: "Deep House",
    }),
    track(3, {
      ...ready,
      title: "Neon Cathedral",
      keyRoot: 0,
      keyMode: "major",
      bpm: 126,
      energy: 8,
      genre: "Techno",
    }),
    track(4, {
      ...ready,
      title: "Run The Signal",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 8,
    }),
    track(5, { title: "Unanalysed One" }),
  ];
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useViewStore.setState({ view: "library" });
  useDecksStore.setState({
    mode: "mashup",
    trackA: null,
    idea: 0,
    filters: EMPTY_FILTERS,
    allowShift: true,
    energyDirection: "up",
    filtersOpen: false,
  });
  await i18n.changeLanguage("es");
});

const suggestCalls = () =>
  calls.filter((c) => c.method.startsWith("suggest.")) as {
    method: string;
    params: SuggestParams;
  }[];

async function openPro() {
  renderWithQuery(<App />);
  await screen.findByText("5 temas");
  const workspace = screen.getByRole("radiogroup", { name: "Espacio de trabajo" });
  await userEvent.click(within(workspace).getByRole("radio", { name: "Pro" }));
  return screen.findByRole("heading", { name: "Carga un tema en el deck A" });
}

describe("pro mode", () => {
  it("loads a track on deck A and shows the best idea on deck B with its reasons", async () => {
    await openPro();
    const results = screen.getByRole("list", { name: "Temas analizados" });
    // Only analysed tracks can be loaded.
    await within(results).findByText("Midnight Bloom");
    expect(within(results).queryByText("Unanalysed One")).not.toBeInTheDocument();
    await userEvent.click(within(results).getByText("Midnight Bloom"));

    expect(
      await screen.findByRole("region", { name: "Deck A: Midnight Bloom" }),
    ).toBeInTheDocument();
    const deckB = await screen.findByRole("region", { name: "Deck B: Run The Signal" });
    expect(within(deckB).getByText("Idea 1 / 3")).toBeInTheDocument();
    expect(within(deckB).getByRole("img", { name: "Puntuación 100 de 100" })).toBeInTheDocument();
    const why = screen.getByRole("list", { name: "Motivo" });
    expect(within(why).getByText("Misma tonalidad")).toBeInTheDocument();
    expect(within(why).getByText("Energía +1")).toBeInTheDocument();
    expect(suggestCalls().at(-1)).toEqual({
      method: "suggest.mashups",
      params: { trackId: 1, allowShift: true, filters: {}, limit: 100 },
    });

    // ▶ walks the ideas; the list follows.
    await userEvent.click(within(deckB).getByRole("button", { name: "Idea siguiente" }));
    const next = await screen.findByRole("region", { name: /^Deck B: / });
    expect(within(next).getByText("Idea 2 / 3")).toBeInTheDocument();
    const list = screen.getByRole("listbox", { name: "Ideas" });
    expect(within(list).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    // Picking from the list puts that idea on deck B.
    await userEvent.click(within(list).getAllByRole("option")[2] as HTMLElement);
    expect(
      within(await screen.findByRole("region", { name: /^Deck B: / })).getByText("Idea 3 / 3"),
    ).toBeInTheDocument();
  });

  it("shows the key change applied to B", async () => {
    // From 8A, 10A shifted down 2 semitones lands on 8A (same key, "−2 st").
    engine.tracks = [
      ...engine.tracks.slice(0, 1),
      track(6, { ...ready, title: "Heatwave", keyRoot: 11, keyMode: "minor", bpm: 124, energy: 7 }),
    ];
    useDecksStore.getState().loadA(1);
    useViewStore.setState({ view: "pro" });
    renderWithQuery(<App />);
    const deckB = await screen.findByRole("region", { name: "Deck B: Heatwave" });
    expect(within(deckB).getByText("10A")).toBeInTheDocument();
    expect(within(deckB).getByText("8A")).toBeInTheDocument();
    expect(within(deckB).getByText("−2 st")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Motivo" })).getByText("−2 st en B"),
    ).toBeInTheDocument();

    // Turning the key change off asks again without shifts.
    await userEvent.click(screen.getByRole("button", { name: "Filtro de ideas" }));
    await userEvent.click(screen.getByRole("switch", { name: "Permitir cambio de tono (±2)" }));
    await waitFor(() => expect(suggestCalls().at(-1)?.params.allowShift).toBe(false));
    const unshifted = await screen.findByRole("region", { name: "Deck B: Heatwave" });
    await waitFor(() => expect(within(unshifted).queryByText("−2 st")).not.toBeInTheDocument());
  });

  it("switches to DJ Mix with the energy direction and the energy step", async () => {
    useDecksStore.getState().loadA(1);
    useViewStore.setState({ view: "pro" });
    renderWithQuery(<App />);
    await screen.findByRole("region", { name: /^Deck B: / });
    await userEvent.click(screen.getByRole("radio", { name: "DJ Mix" }));
    await waitFor(() => expect(suggestCalls().at(-1)?.method).toBe("suggest.mixouts"));
    expect(suggestCalls().at(-1)?.params.energyDirection).toBe("up");
    expect(await screen.findByLabelText(/^Energía de 7 a /)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filtro de ideas" }));
    const direction = screen.getByRole("radiogroup", { name: "Energía del siguiente tema" });
    await userEvent.click(within(direction).getByRole("radio", { name: "Bajar" }));
    await waitFor(() => expect(suggestCalls().at(-1)?.params.energyDirection).toBe("down"));
  });

  it("filters the ideas and offers to clear the filter when nothing is left", async () => {
    useDecksStore.getState().loadA(1);
    useViewStore.setState({ view: "pro" });
    renderWithQuery(<App />);
    await screen.findByRole("region", { name: /^Deck B: / });
    await userEvent.click(screen.getByRole("button", { name: "Filtro de ideas" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Añadir género…" }),
      "Techno",
    );
    await waitFor(() =>
      expect(suggestCalls().at(-1)?.params.filters).toEqual({ genres: ["Techno"] }),
    );
    expect(
      await screen.findByRole("region", { name: "Deck B: Neon Cathedral" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtro de ideas (1)" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Energía mínima" }), "10");
    expect(await screen.findByText("Ninguna idea con estos filtros.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(
      await screen.findByRole("region", { name: "Deck B: Run The Signal" }),
    ).toBeInTheDocument();
  });

  it("opens from the track detail and explains when A is not analysed", async () => {
    renderWithQuery(<App />);
    await screen.findByText("5 temas");
    useViewStore.getState().openDetail(2);
    await userEvent.click(await screen.findByRole("button", { name: "Abrir en Pro" }));
    expect(
      await screen.findByRole("region", { name: "Deck A: Golden Hour Tide" }),
    ).toBeInTheDocument();

    useDecksStore.getState().loadA(5);
    expect(
      await screen.findByText(
        "Analiza este tema para ver ideas: hacen falta su tonalidad y su BPM.",
      ),
    ).toBeInTheDocument();
  });
});

describe("reasons", () => {
  const all: SuggestReason[] = [
    ...["same", "adjacent", "relative", "diagonal", "energy_boost", "semitone_up", "none"].map(
      (code) => ({ kind: "key" as const, code }),
    ),
    { kind: "shift", code: "b", value: 2 },
    ...["same", "half", "double"].map((code) => ({ kind: "bpm" as const, code, value: -1.6 })),
    { kind: "vocals", code: "a" },
    { kind: "vocals", code: "b" },
    ...["same", "up", "down"].map((code) => ({ kind: "energy" as const, code, value: 1 })),
    { kind: "genre", code: "same" },
    { kind: "genre", code: "related" },
  ];

  it.each([
    ["es", es],
    ["en", en],
  ])("every engine code has a %s text", async (lang) => {
    await i18n.changeLanguage(lang);
    for (const reason of all) {
      const text = reasonText(i18n.t, reason, lang);
      expect(text).not.toMatch(/pro\.reasons/);
      expect(text).not.toMatch(/\{\{/);
    }
  });

  it("writes signs and numbers in the UI language", async () => {
    await i18n.changeLanguage("es");
    expect(reasonText(i18n.t, { kind: "shift", code: "b", value: 2 }, "es")).toBe("+2 st en B");
    expect(reasonText(i18n.t, { kind: "bpm", code: "same", value: -1.6 }, "es")).toBe("BPM −1,6 %");
    expect(reasonText(i18n.t, { kind: "bpm", code: "same", value: 0 }, "es")).toBe("Mismo BPM");
    expect(reasonText(i18n.t, { kind: "vocals", code: "a" }, "es")).toBe("Voz A + Instr. B");
    await i18n.changeLanguage("en");
    expect(reasonText(i18n.t, { kind: "bpm", code: "double", value: 0.8 }, "en")).toBe(
      "B at double tempo (+0.8 %)",
    );
  });
});
