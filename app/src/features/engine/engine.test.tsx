import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  commands,
  engine,
  invoke,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useViewStore } from "../navigation/viewStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { method: string; params: unknown }) => invoke(cmd, args),
  convertFileSrc: (path: string) => path,
}));
// Several components listen to engine events: keep them all (the shared fake keeps one).
const many = vi.hoisted(() => new Map<string, Set<(ev: { payload: unknown }) => void>>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (ev: { payload: unknown }) => void) => {
    const set = many.get(name) ?? new Set();
    set.add(cb);
    many.set(name, set);
    return Promise.resolve(() => set.delete(cb));
  },
}));
const emit = (name: string, payload: unknown) => many.get(name)?.forEach((cb) => cb({ payload }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }),
}));

beforeEach(async () => {
  resetEngine();
  engine.tracks = [track(1)];
  useViewStore.setState({ view: "library" });
  await i18n.changeLanguage("es");
});

describe("engine banner", () => {
  it("tells that the engine is restarting and, once back, what was interrupted", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Motor listo");
    expect(screen.queryByText(/motor de análisis se/)).toBeNull();

    act(() => emit("engine://event", { type: "engine.exited", payload: {} }));
    expect(
      await screen.findByText("El motor de análisis se está reiniciando…"),
    ).toBeInTheDocument();

    act(() => emit("engine://event", { type: "engine.restarted", payload: {} }));
    const banner = (await screen.findByText("El motor de análisis se ha reiniciado")).closest(
      "[role=status]",
    ) as HTMLElement;
    await userEvent.click(within(banner).getByRole("button", { name: "Ver detalles" }));
    expect(within(banner).getByText(/ese trabajo se ha interrumpido/)).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Abrir carpeta de logs" }));
    expect(commands).toEqual(["open_logs_folder"]);
    await userEvent.click(within(banner).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText("El motor de análisis se ha reiniciado")).toBeNull();
  });

  it("raises an alert with a retry button when the engine does not answer", async () => {
    engine.connected = false;
    renderWithQuery(<App />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("El motor de análisis no responde")).toBeInTheDocument();
    engine.connected = true;
    await userEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Motor listo");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("about", () => {
  it("shows the versions and the licence and opens the logs folder", async () => {
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    await userEvent.click(screen.getByRole("button", { name: "Acerca de" }));
    expect(screen.getByText("Versión 0.1.0")).toBeInTheDocument();
    expect(await screen.findByText(/Python 3\.11\.9/)).toBeInTheDocument();
    expect(screen.getByText(/^Software libre bajo licencia AGPL-3\.0/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir carpeta de logs" }));
    expect(commands).toEqual(["open_logs_folder"]);
  });
});
