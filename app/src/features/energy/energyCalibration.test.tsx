// "Calibrar energía" (SPEC 12.2): rate by ear with the keyboard, calibrate with the MAE
// before → after shown first, apply or go back, and import ratings written in the tags.
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
import { ratingFromKey } from "./api";

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

const rated = () =>
  calls
    .filter((c) => c.method === "energy.rate")
    .map((c) => c.params as { trackId: number; rating: number | null });

beforeEach(async () => {
  resetEngine();
  engine.tracks = Array.from({ length: 40 }, (_, i) =>
    track(i + 1, { title: `Tema ${i + 1}`, status: "ready", energy: (i % 10) + 1 }),
  );
  useViewStore.setState({ view: "settings", back: "library" });
  await i18n.changeLanguage("es");
});

test("keys 1-9 rate 1-9 and 0 rates 10", () => {
  expect(ratingFromKey("1")).toBe(1);
  expect(ratingFromKey("9")).toBe(9);
  expect(ratingFromKey("0")).toBe(10);
  expect(ratingFromKey("a")).toBeNull();
  expect(ratingFromKey("Enter")).toBeNull();
});

test("opens from Settings, rates with the keyboard, undoes, and goes back", async () => {
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Calibrar energía…" }));
  expect(await screen.findByRole("heading", { name: "Tema 1" })).toBeInTheDocument();
  expect(screen.getByText("0 de 30 valoraciones para calibrar")).toBeInTheDocument();
  // The excerpt plays as the track appears, from its drop.
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());

  await user.keyboard("7");
  expect(await screen.findByRole("heading", { name: "Tema 2" })).toBeInTheDocument();
  await user.keyboard("0");
  expect(await screen.findByRole("heading", { name: "Tema 3" })).toBeInTheDocument();
  await waitFor(() =>
    expect(rated()).toEqual([
      { trackId: 1, rating: 7 },
      { trackId: 2, rating: 10 },
    ]),
  );
  expect(screen.getByText("2 de 30 valoraciones para calibrar")).toBeInTheDocument();

  // ⌘Z takes the last rating back and returns to that track.
  await user.keyboard("{Meta>}z{/Meta}");
  expect(await screen.findByRole("heading", { name: "Tema 2" })).toBeInTheDocument();
  await waitFor(() => expect(rated().at(-1)).toEqual({ trackId: 2, rating: null }));

  // → skips without rating.
  await user.keyboard("{ArrowRight}");
  expect(await screen.findByRole("heading", { name: "Tema 3" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Volver" }));
  expect(useViewStore.getState().view).toBe("settings");
});

test("calibrating shows the error before → after and applies only when asked", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "energy", back: "settings" });
  renderWithQuery(<App />);
  // Rating 30 tracks, one per key press.
  for (let i = 1; i <= 30; i++) {
    expect(await screen.findByRole("heading", { name: `Tema ${i}` })).toBeInTheDocument();
    await user.keyboard(String((i % 9) + 1));
  }
  await user.click(await screen.findByRole("button", { name: "Calibrar" }));
  expect(await screen.findByText("Error medio frente a tus valoraciones")).toBeInTheDocument();
  expect(
    calls.some((c) => c.method === "energy.calibrate" && (c.params as { apply: boolean }).apply),
  ).toBe(false);

  await user.click(screen.getByRole("button", { name: "Aplicar a la biblioteca" }));
  expect(await screen.findByText(/Energía recalculada en 40 temas/)).toBeInTheDocument();
  expect(screen.getByText("Modelo personal")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Volver al modelo por defecto" }));
  expect(await screen.findByText("Modelo por defecto")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "energy.revert")).toBe(true);
});

test("imports the ratings found in the tags after a preview", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "energy", back: "settings" });
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("tab", { name: "Importar de los tags" }));
  // A new pattern needs exactly one {n}.
  const input = screen.getByRole("textbox", { name: "Nuevo patrón" });
  await user.type(input, "Nivel");
  expect(screen.getByRole("button", { name: "Añadir" })).toBeDisabled();
  await user.type(input, " {{n}");
  await user.click(screen.getByRole("button", { name: "Añadir" }));
  expect(screen.getByText("Nivel {n}")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Buscar en la biblioteca" }));
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(5);
  expect(screen.getByText(/1 tiene la energía que escribió Tonalia/)).toBeInTheDocument();
  const preview = calls.find((c) => c.method === "energy.importPreview");
  expect((preview?.params as { patterns: string[] }).patterns).toContain("Nivel {n}");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "Importar 4 valoraciones" }));
  });
  expect(await screen.findByText("4 valoraciones importadas")).toBeInTheDocument();
});
