// Built-in guides (SPEC 6.3, DESIGN 6.14).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { GuideLink } from "./GuideLink";

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

beforeEach(async () => {
  resetEngine();
  engine.tracks = [track(1, { title: "Midnight Bloom" })];
  useLibraryStore.setState({ search: "", filter: {}, selected: [] });
  useViewStore.setState({ view: "library", guide: "harmonic" });
  await i18n.changeLanguage("es");
});

async function openGuides() {
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Guías" }));
  return screen.findByRole("heading", { level: 1, name: "Guías" });
}

it("opens from the sidebar with an index of four guides", async () => {
  await openGuides();
  const index = screen.getByRole("navigation", { name: "Índice" });
  expect(
    within(index)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual([
    "Mezcla armónica",
    "Niveles de energía",
    "Cue points y saltos de frase",
    "Mashups con stems",
  ]);
  expect(within(index).getByRole("button", { name: "Mezcla armónica" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("heading", { level: 2, name: "Mezcla armónica" })).toBeInTheDocument();
  expect(screen.getByText(/^Relativa \(8A → 8B\)/)).toBeInTheDocument();
});

it("writes the example keys in the chosen notation", async () => {
  engine.settings = { ...engine.settings, notation: "classical" };
  await openGuides();
  expect(screen.getByText(/^Relativa \(Am → C\)/)).toBeInTheDocument();
  expect(screen.getByText(/^Medio tono arriba \(Am → A#m\)/)).toBeInTheDocument();
});

it("has an interactive wheel in the harmonic mixing guide", async () => {
  await openGuides();
  const wheel = screen.getByRole("group", { name: "Rueda armónica" });
  await userEvent.click(within(wheel).getByRole("button", { name: /^3B \(mayor\)/ }));
  expect(within(wheel).getByRole("button", { name: /^3B \(mayor\)/ })).toHaveAttribute(
    "data-state",
    "current",
  );
  // It is a demo: the library filters are untouched.
  expect(useLibraryStore.getState().filter).toEqual({});
});

it("switches between guides with their illustrations", async () => {
  await openGuides();
  await userEvent.click(screen.getByRole("button", { name: "Niveles de energía" }));
  expect(screen.getByRole("heading", { level: 2, name: "Niveles de energía" })).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Tres formas de recorrer una sesión" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cue points y saltos de frase" }));
  expect(screen.getByRole("img", { name: "Un tema dividido en frases" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Mashups con stems" }));
  expect(
    screen.getByRole("img", { name: "Voz de un tema sobre la instrumental de otro" }),
  ).toBeInTheDocument();
});

it("is available in English", async () => {
  await i18n.changeLanguage("en");
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Guides" }));
  expect(
    await screen.findByRole("heading", { level: 2, name: "Harmonic mixing" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/^Relative \(8A → 8B\)/)).toBeInTheDocument();
});

it("opens at the guide a «?» next to the jargon points to", async () => {
  renderWithQuery(
    <>
      <GuideLink guide="energy" />
      <App />
    </>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Qué significa: Niveles de energía (Guías)" }),
  );
  expect(
    await screen.findByRole("heading", { level: 2, name: "Niveles de energía" }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("navigation", { name: "Índice" })).getByRole("button", {
      name: "Niveles de energía",
    }),
  ).toHaveAttribute("aria-current", "page");
});
