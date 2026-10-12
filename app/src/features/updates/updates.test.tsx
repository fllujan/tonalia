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
import { STARTUP_DELAY_MS } from "./useStartupUpdateCheck";
import { useUpdateStore } from "./updateStore";

const plugin = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugin.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: plugin.relaunch }));
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

type Progress = (e: { event: string; data?: Record<string, number> }) => void;

function fakeUpdate(version = "0.2.0") {
  return {
    version,
    body: "Atajos de teclado.\nMensajes de error claros.",
    downloadAndInstall: vi.fn((onEvent: Progress) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 500 } });
      onEvent({ event: "Finished" });
      return Promise.resolve();
    }),
  };
}

beforeEach(async () => {
  resetEngine();
  engine.tracks = [track(1, { title: "Midnight Bloom", status: "ready" })];
  useViewStore.setState({ view: "library", infoTrackId: null });
  useUpdateStore.setState({
    status: "idle",
    version: null,
    notes: null,
    progress: null,
    error: null,
    dismissed: false,
    update: null,
  });
  plugin.check.mockReset();
  plugin.relaunch.mockClear();
  await i18n.changeLanguage("es");
});

afterEach(() => vi.useRealTimers());

describe("updates", () => {
  it("checks at start-up and installs only when asked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const update = fakeUpdate();
    plugin.check.mockResolvedValue(update);
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    expect(plugin.check).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS));
    const banner = (await screen.findByText("Tonalia 0.2.0 está disponible")).closest(
      "[role=status]",
    ) as HTMLElement;
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    vi.useRealTimers();

    await userEvent.click(within(banner).getByRole("button", { name: "Novedades" }));
    expect(within(banner).getByText(/Mensajes de error claros/)).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Instalar y reiniciar" }));
    await waitFor(() => expect(plugin.relaunch).toHaveBeenCalled());
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("never checks when the setting is off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    engine.settings = { ...engine.settings, checkUpdates: false };
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    await act(() => vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS * 3));
    expect(plugin.check).not.toHaveBeenCalled();
  });

  it("stays quiet when the start-up check fails (offline)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    plugin.check.mockRejectedValue(new Error("error sending request"));
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    await act(() => vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS));
    expect(plugin.check).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No se ha podido/)).toBeNull();
  });

  it("can be turned off and checked by hand in Settings", async () => {
    plugin.check.mockResolvedValueOnce(null);
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
    act(() => useViewStore.getState().show("settings"));
    await userEvent.click(await screen.findByRole("button", { name: "Actualizaciones" }));
    const toggle = screen.getByRole("switch", { name: "Buscar actualizaciones al arrancar" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "settings.set", params: { checkUpdates: false } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Buscar ahora" }));
    expect(await screen.findByText("Tienes la última versión (0.1.0).")).toBeInTheDocument();

    plugin.check.mockRejectedValueOnce(new Error("error sending request"));
    await userEvent.click(screen.getByRole("button", { name: "Buscar ahora" }));
    expect(await screen.findByText(/No se ha podido comprobar/)).toBeInTheDocument();
  });
});
