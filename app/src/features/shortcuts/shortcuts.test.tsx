import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import en from "../../i18n/en.json";
import es from "../../i18n/es.json";
import { MOD } from "../../lib/keyboard";
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
import { SHORTCUT_GROUPS, useShortcutsDialog } from "./shortcuts";

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

const mod = MOD === "⌘" ? "Meta" : "Control";

beforeEach(async () => {
  resetEngine();
  engine.tracks = [1, 2, 3, 4].map((id) => track(id, { title: `Tema ${id}`, status: "ready" }));
  useLibraryStore.setState({
    search: "",
    filter: {},
    selected: [],
    sort: "title",
    descending: false,
  });
  useViewStore.setState({ view: "library" });
  useShortcutsDialog.setState({ open: false });
  await i18n.changeLanguage("es");
});

describe("global shortcuts", () => {
  it("switches views with the modifier and the number keys", async () => {
    renderWithQuery(<App />);
    await screen.findByText("4 temas");
    await userEvent.keyboard(`{${mod}>}2{/${mod}}`);
    expect(useViewStore.getState().view).toBe("pro");
    await userEvent.keyboard(`{${mod}>},{/${mod}}`);
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    await userEvent.keyboard(`{${mod}>}4{/${mod}}`);
    expect(useViewStore.getState().view).toBe("builder");
    await userEvent.keyboard(`{${mod}>}1{/${mod}}`);
    expect(useViewStore.getState().view).toBe("library");
  });

  it("opens the shortcuts with ? while a sidebar item has the focus", async () => {
    renderWithQuery(<App />);
    await screen.findByText("4 temas");
    screen.getByRole("button", { name: /Revisar calidad/ }).focus();
    await userEvent.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Atajos de teclado" })).toBeInTheDocument();
  });

  it("lists every shortcut with ? and closes with Escape", async () => {
    renderWithQuery(<App />);
    await screen.findByText("4 temas");
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Atajos de teclado" });
    for (const group of ["General", "Biblioteca", "Detalle del tema", "Modo Pro"])
      expect(within(dialog).getByRole("heading", { name: group })).toBeInTheDocument();
    expect(within(dialog).getByText("Probar mashup o mezcla / parar")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Espacio").length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Also from the sidebar.
    await userEvent.click(screen.getByRole("button", { name: /Atajos de teclado/ }));
    expect(await screen.findByRole("dialog", { name: "Atajos de teclado" })).toBeInTheDocument();
  });

  it("has a translated label for every shortcut in both languages", () => {
    const tables = [es.shortcuts, en.shortcuts] as const;
    for (const table of tables)
      for (const { group, items } of SHORTCUT_GROUPS) {
        expect(table.groups).toHaveProperty(group);
        for (const { action, keys } of items) {
          expect(table.actions).toHaveProperty(action);
          for (const k of keys.filter((k) => k.startsWith("@")))
            expect(table.keys).toHaveProperty(k.slice(1));
        }
      }
  });
});

describe("library keyboard", () => {
  it("moves through the rows, extends the selection and opens the detail", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Tema 1");
    const rows = () => screen.getAllByRole("row").slice(1);
    // One tab stop for all the rows.
    expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    rows()[0]?.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(rows()[1]));
    expect(useLibraryStore.getState().selected).toEqual([2]);
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(useLibraryStore.getState().selected).toEqual([2, 3]);
    await userEvent.keyboard("{End}");
    expect(useLibraryStore.getState().selected).toEqual([4]);
    await userEvent.keyboard("{Escape}");
    expect(useLibraryStore.getState().selected).toEqual([]);
    await userEvent.keyboard("{Home}{Enter}");
    expect(useViewStore.getState()).toMatchObject({ view: "detail", trackId: 1 });
    // Escape goes back from the detail.
    await screen.findByRole("button", { name: /Volver/ });
    await userEvent.keyboard("{Escape}");
    expect(useViewStore.getState().view).toBe("library");
  });
});
