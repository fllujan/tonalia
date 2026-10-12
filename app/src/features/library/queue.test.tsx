// "Analizar" (SPEC 2.14 sidebar, DESIGN 6.4): the tracks still to analyse or that failed,
// with Analyse / Retry; a failed track says why and can be retried where it shows.
import { act, screen, waitFor, within } from "@testing-library/react";
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
import { useViewStore } from "../navigation/viewStore";
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
});
