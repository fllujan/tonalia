// "Analizar" (SPEC 2.14 sidebar, DESIGN 6.4): the tracks still to analyse or that failed,
// with Analyse / Retry; a failed track says why and can be retried where it shows.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  calls,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useViewStore } from "../navigation/viewStore";
import { useAnalysisStore } from "./analysisStore";
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

const ready = { status: "ready" as const, keyRoot: 9, keyMode: "minor" as const, bpm: 124 };

beforeEach(async () => {
  resetEngine();
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useViewStore.setState({ view: "library" });
  engine.tracks = [
    track(1, { ...ready, title: "Midnight Bloom" }),
    track(2, { title: "Paper Satellites" }),
    track(3, { title: "Neon Cathedral" }),
    track(4, {
      title: "Heatwave Protocol",
      status: "error",
      error: "decode_failed: corrupt frame",
    }),
  ];
  await i18n.changeLanguage("es");
});

const analysisCalls = () => calls.filter((c) => c.method.startsWith("analysis."));

describe("analyse queue", () => {
  it("lists what is left to analyse, with a counter, and starts it", async () => {
    renderWithQuery(<App />);
    const item = await screen.findByRole("button", { name: /^Analizar/ });
    await waitFor(() => expect(item).toHaveTextContent("3"));
    await userEvent.click(item);
    const table = await screen.findByRole("grid");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4)); // + header
    expect(within(table).queryByText("Midnight Bloom")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Analizar 2 pendientes" }));
    await waitFor(() =>
      expect(analysisCalls().at(-1)).toEqual({ method: "analysis.start", params: {} }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar 1 con error" }));
    await waitFor(() =>
      expect(analysisCalls().at(-1)).toEqual({
        method: "analysis.reanalyze",
        params: { trackIds: [4] },
      }),
    );
  });

  it("says when everything is analysed", async () => {
    engine.tracks = [track(1, { ...ready, title: "Midnight Bloom" })];
    act(() => useViewStore.getState().show("queue"));
    renderWithQuery(<App />);
    expect(await screen.findByText("Todo analizado")).toBeInTheDocument();
  });

  it("retries one failed track from the table and from its detail, saying why", async () => {
    renderWithQuery(<App />);
    const retry = await screen.findByRole("button", {
      name: "Reintentar el análisis de «Heatwave Protocol»",
    });
    expect(retry).toHaveAccessibleDescription(/El archivo está dañado|corrupt frame/);
    await userEvent.click(retry);
    await waitFor(() =>
      expect(analysisCalls().at(-1)).toEqual({
        method: "analysis.reanalyze",
        params: { trackIds: [4] },
      }),
    );

    calls.length = 0;
    act(() => useViewStore.getState().openDetail(4));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/No se pudo analizar/);
    await userEvent.click(within(banner).getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(analysisCalls().at(-1)).toEqual({
        method: "analysis.reanalyze",
        params: { trackIds: [4] },
      }),
    );
  });

  it("shows each track's stage, the time left and a live summary", async () => {
    engine.tracks = [
      track(1, { ...ready, title: "Midnight Bloom", energy: 7 }),
      track(5, { ...ready, title: "Golden Hour Tide", keyRoot: 4, energy: 6 }),
      track(6, { ...ready, title: "Velvet Static", energy: 7 }),
      track(2, { title: "Paper Satellites", status: "analyzing" }),
      track(3, { title: "Neon Cathedral" }),
    ];
    act(() => useViewStore.getState().show("queue"));
    renderWithQuery(<App />);
    const summary = await screen.findByRole("complementary", { name: "Resumen en vivo" });
    await waitFor(() =>
      expect(within(summary).getByText("3 de 5 temas analizados")).toBeInTheDocument(),
    );
    // 8A twice (A minor), 9A once (E minor); energy 7 twice and 6 once.
    expect(
      within(summary).getByRole("img", { name: /Tonalidades: 8A: 2 temas, 9A: 1 tema/ }),
    ).toBeInTheDocument();
    expect(within(summary).getByLabelText("Energía 7: 2 temas")).toBeInTheDocument();
    expect(
      within(summary).getByRole("combobox", { name: /Procesos en paralelo/ }),
    ).toBeInTheDocument();

    await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
    act(() =>
      emit("engine://event", { type: "job.started", payload: { jobId: "an-1", kind: "analysis" } }),
    );
    act(() => useAnalysisStore.setState({ startedAt: Date.now() - 60_000 }));
    act(() =>
      emit("engine://progress", {
        jobId: "an-1",
        trackId: 2,
        stage: "tempo",
        percent: 25,
        done: 0,
        total: 2,
      }),
    );
    const status = (await screen.findByText("Analizando 0 de 2")).closest<HTMLElement>(
      '[role="status"]',
    );
    if (!status) throw new Error("no progress header");
    expect(status).toHaveTextContent("Analizando 0 de 2");
    expect(status).toHaveTextContent("quedan ~3 min");
    expect(within(status).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    // Paper Satellites is on the 3rd of 7 stages; Neon Cathedral waits its turn.
    const steps = screen.getByRole("img", { name: "Tempo · paso 3 de 7" });
    expect(steps.querySelectorAll('[data-step="done"]')).toHaveLength(2);
    expect(steps.querySelectorAll('[data-step="current"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Pendiente de análisis" })).toBeInTheDocument();

    await userEvent.click(within(status).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "job.cancel")).toBe(true));
  });
});
