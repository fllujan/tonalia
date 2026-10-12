import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  commands,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useViewStore } from "../navigation/viewStore";

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

beforeEach(async () => {
  resetEngine();
  engine.tracks = [track(1)];
  useViewStore.setState({ view: "library" });
  await i18n.changeLanguage("es");
});

async function openAttributions() {
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
  await userEvent.click(screen.getByRole("button", { name: "Acerca de" }));
  await userEvent.click(screen.getByRole("button", { name: "Licencias de terceros" }));
  return screen.findByRole("dialog", { name: "Licencias de terceros" });
}

describe("third-party licences (SPEC 10.4)", () => {
  it("lists the components by part of the app, with their licence", async () => {
    const dialog = await openAttributions();
    expect(await within(dialog).findByText(/4 componentes de código abierto/)).toBeInTheDocument();
    const bundled = within(dialog).getByRole("region", { name: "Herramientas incluidas" });
    expect(within(bundled).getByText("FFmpeg")).toBeInTheDocument();
    expect(within(bundled).getByText("GPL-3.0-or-later")).toBeInTheDocument();
    expect(
      within(bundled).getByText(/decodificar el audio/), // the note of the entry
    ).toBeInTheDocument();
    const core = within(dialog).getByRole("region", { name: "Núcleo de la app (Rust)" });
    expect(within(core).getByText("serde")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("region", { name: "Motor de análisis (Python)" }),
    ).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Interfaz (JavaScript)" })).toBeVisible();
    // The acknowledgements of data that is not a package.
    expect(within(dialog).getByText(/Krumhansl/)).toBeInTheDocument();
  });

  it("filters by name or licence and opens the full texts", async () => {
    const dialog = await openAttributions();
    const search = await within(dialog).findByRole("searchbox", {
      name: "Buscar componente o licencia",
    });
    await userEvent.type(search, "apache");
    expect(within(dialog).getByText("serde")).toBeInTheDocument();
    expect(within(dialog).queryByText("FFmpeg")).toBeNull();
    expect(within(dialog).queryByRole("region", { name: "Herramientas incluidas" })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(within(dialog).getByText("Ningún componente coincide")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Ver los textos completos" }));
    expect(commands).toEqual(["open_third_party_notices"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains when the list has not been generated", async () => {
    engine.thirdParty = null;
    const dialog = await openAttributions();
    expect(
      await within(dialog).findByText(/La lista de licencias no está disponible/),
    ).toBeInTheDocument();
  });

  it("names the source code of Tonalia itself", async () => {
    renderWithQuery(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    await userEvent.click(screen.getByRole("button", { name: "Acerca de" }));
    expect(screen.getByText("github.com/fllujan/tonalia")).toBeInTheDocument();
  });
});
