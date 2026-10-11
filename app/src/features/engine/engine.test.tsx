import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../i18n";
import App from "../../App";

const invoke = vi.fn();
const listeners = new Map<string, (ev: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (ev: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  },
}));

describe("engine status", () => {
  beforeEach(async () => {
    invoke.mockReset();
    listeners.clear();
    await i18n.changeLanguage("es");
  });

  it('shows "Motor: conectado" after a successful ping', async () => {
    invoke.mockResolvedValue({ pong: true });
    render(<App />);
    expect(await screen.findByText("conectado")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("engine_request", { method: "engine.ping", params: null });
    expect(screen.getByRole("status")).toHaveTextContent("Motor: conectado");
  });

  it("shows disconnected and retries", async () => {
    invoke.mockRejectedValueOnce({ code: -32000, message: "engine not running" });
    render(<App />);
    expect(await screen.findByText("desconectado")).toBeInTheDocument();
    invoke.mockResolvedValue({ pong: true });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("conectado")).toBeInTheDocument();
  });

  it("tracks restarts from engine events", async () => {
    invoke.mockResolvedValue({ pong: true });
    render(<App />);
    await screen.findByText("conectado");
    await waitFor(() => expect(listeners.has("engine://event")).toBe(true));
    listeners.get("engine://event")?.({ payload: { type: "engine.exited", payload: {} } });
    expect(await screen.findByText("reiniciando…")).toBeInTheDocument();
    listeners.get("engine://event")?.({ payload: { type: "engine.restarted", payload: {} } });
    expect(await screen.findByText("conectado")).toBeInTheDocument();
  });

  it("renders in English", async () => {
    invoke.mockResolvedValue({ pong: true });
    await i18n.changeLanguage("en");
    render(<App />);
    expect(await screen.findByRole("status")).toHaveTextContent("Engine: connected");
  });
});
