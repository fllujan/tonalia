// Set builder screen (SPEC 2.17, DESIGN 6.12, task 9.2): origin, length, first track,
// energy curve editor, generate, the timeline with coloured transitions, reorder, replace,
// remove, save as a playlist and export.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { save } from "@tauri-apps/plugin-dialog";
import App from "../../App";
import i18n from "../../i18n";
import type {
  BuilderAlternativesParams,
  BuilderGenerateParams,
  BuilderScoreParams,
} from "../../lib/rpc.types";
import {
  addPlaylist,
  calls,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useBuilderStore } from "./builderStore";

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

// jsdom has no PointerEvent: pointer events fall back to mouse events with coordinates.
window.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;

const ready = { status: "ready" as const };
let warmup: { id: number };

beforeEach(async () => {
  resetEngine();
  engine.tracks = [
    track(1, {
      ...ready,
      title: "Midnight Bloom",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 5,
    }),
    track(2, {
      ...ready,
      title: "Golden Hour Tide",
      keyRoot: 4,
      keyMode: "minor",
      bpm: 124,
      energy: 6,
    }),
    track(3, {
      ...ready,
      title: "Heatwave Protocol",
      keyRoot: 11,
      keyMode: "minor",
      bpm: 125,
      energy: 7,
    }),
    track(4, {
      ...ready,
      title: "Paper Satellites",
      keyRoot: 1,
      keyMode: "major",
      bpm: 124,
      energy: 8,
    }),
    track(5, {
      ...ready,
      title: "Neon Cathedral",
      keyRoot: 0,
      keyMode: "major",
      bpm: 126,
      energy: 6,
    }),
  ];
  warmup = addPlaylist("Warm-up Ibiza", { emoji: "🌅" }, [1, 2, 3, 4, 5]);
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useBuilderStore.getState().reset();
  useViewStore.setState({ view: "library" });
  await i18n.changeLanguage("es");
});

const last = <T,>(method: string) =>
  calls.filter((c) => c.method === method).at(-1)?.params as T | undefined;

async function openBuilder() {
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /Constructor de sets/ }));
  return screen.findByRole("heading", { name: "Constructor de sets" });
}

async function generate() {
  await openBuilder();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Origen" }),
    await screen.findByRole("option", { name: "Warm-up Ibiza" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
  return screen.findByRole("list", { name: "Set" });
}

describe("set builder", () => {
  it("generates a set from a playlist and shows its transitions", async () => {
    const list = await generate();
    expect(last<BuilderGenerateParams>("builder.generate")).toEqual({
      pool: { playlistId: warmup.id },
      curve: { preset: "warmup_peak_cooldown" },
      durationMin: 60,
      // As in Pro: a key change of ±2 is allowed unless the DJ turns it off.
      allowShift: true,
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveAccessibleName("1. Midnight Bloom");
    // Every track after the first comes with its transition bar.
    expect(within(list).getAllByRole("group", { name: /^Transición \d → \d/ })).toHaveLength(4);
    expect(screen.getByText(/^Media de transición \d,\d\d$/)).toBeInTheDocument();
    expect(screen.getByText(/^\d choques? de tonalidad$/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Curva objetivo y energía real" })).toBeInTheDocument();
    // Five tracks cannot fill an hour: the screen says so instead of looking finished.
    expect(
      screen.getByText(/^El set dura \d+ min de los 60 pedidos\.$/).closest("[role=status]"),
    ).toHaveTextContent(
      /^El set dura \d+ min de los 60 pedidos\. No hay más temas del origen que encajen/,
    );
  });

  it("groups the sources and names the folder above a playlist", async () => {
    const folder = addPlaylist("Bolos", { isFolder: true }, []);
    addPlaylist("Peak time", { emoji: "🔥", parentId: folder.id }, [1]);
    await openBuilder();
    const source = screen.getByRole("combobox", { name: "Origen" });
    const groups = within(source).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("label"))).toContain("Playlists");
    expect(
      await within(source).findByRole("option", { name: "Bolos › Peak time" }),
    ).toBeInTheDocument();
    expect(within(source).queryByRole("option", { name: "Bolos" })).toBeNull();
  });

  it("uses a template, the number of tracks, the first track and a drawn curve", async () => {
    await openBuilder();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Origen" }),
      await screen.findByRole("option", { name: "Warm-up Ibiza" }),
    );
    await userEvent.click(screen.getByRole("radio", { name: "Nº de temas" }));
    const count = screen.getByRole("spinbutton", { name: "Temas" });
    await userEvent.clear(count);
    await userEvent.type(count, "4");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Tema inicial" }),
      await screen.findByRole("option", { name: "Heatwave Protocol" }),
    );
    await userEvent.click(screen.getByRole("radio", { name: "Ascenso" }));
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await waitFor(() =>
      expect(last<BuilderGenerateParams>("builder.generate")).toMatchObject({
        count: 4,
        startTrackId: 3,
        curve: { preset: "ascending" },
      }),
    );
    expect(
      within(await screen.findByRole("list", { name: "Set" })).getAllByRole("listitem")[0],
    ).toHaveAccessibleName("1. Heatwave Protocol");

    // Moving a point of the curve turns it into a drawn one.
    const end = screen.getByRole("slider", { name: "Punto 2 de la curva" });
    end.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await waitFor(() =>
      expect(last<BuilderGenerateParams>("builder.generate")?.curve).toEqual({
        preset: "custom",
        points: [
          { x: 0, energy: 4 },
          { x: 1, energy: 8 },
        ],
      }),
    );
  });

  it("reorders, removes and replaces tracks, scoring the new order", async () => {
    const list = await generate();
    const order = () =>
      within(list)
        .getAllByRole("listitem")
        .map((r) => r.getAttribute("aria-label"));
    const first = order();

    await userEvent.click(
      within(within(list).getAllByRole("listitem")[0] as HTMLElement).getByRole("button", {
        name: "Bajar",
      }),
    );
    await waitFor(() => expect(order()[0]).toBe(first[1]?.replace(/^2\./, "1.")));
    const scored = last<BuilderScoreParams>("builder.score");
    expect(scored?.trackIds).toHaveLength(5);
    expect(scored?.curve).toEqual({ preset: "warmup_peak_cooldown" });

    await userEvent.click(
      within(within(list).getAllByRole("listitem")[4] as HTMLElement).getByRole("button", {
        name: "Quitar del set",
      }),
    );
    await waitFor(() => expect(order()).toHaveLength(4));
    expect(last<BuilderScoreParams>("builder.score")?.trackIds).toHaveLength(4);

    // Replace: the alternatives are the pool's tracks outside the set.
    const removed = engine.tracks.find(
      (t) => !order().some((name) => name?.endsWith(t.title ?? "")),
    );
    await userEvent.click(
      within(within(list).getAllByRole("listitem")[1] as HTMLElement).getByRole("button", {
        name: "Reemplazar",
      }),
    );
    expect(last<BuilderAlternativesParams>("builder.alternatives")).toMatchObject({
      position: 1,
      pool: { playlistId: warmup.id },
    });
    const menu = await screen.findByRole("menu", { name: "Alternativas" });
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(removed?.title ?? "") }),
    );
    await waitFor(() => expect(order()[1]).toBe(`2. ${removed?.title}`));
    expect(last<BuilderScoreParams>("builder.score")?.trackIds[1]).toBe(removed?.id);
  });

  it("drags a track to another place", async () => {
    const list = await generate();
    const rows = () => within(list).getAllByRole("listitem");
    const firstTitle = rows()[0]?.getAttribute("aria-label")?.replace(/^1\. /, "");
    const handle = within(rows()[0] as HTMLElement).getByRole("button", {
      name: "Arrastrar para reordenar",
    });
    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 10 + 2 * 96, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 10 + 2 * 96, pointerId: 1 });
    await waitFor(() => expect(rows()[2]).toHaveAccessibleName(`3. ${firstTitle}`));
  });

  it("says once, above the set, what limits it and what to do next", async () => {
    const list = await generate();
    // Each unavoidable clash is marked quietly in its bar: the ✕ and a grey word, no red pill.
    const marks = within(list).getAllByText("Inevitable");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]).toHaveClass("text-text-3");
    expect(within(list).queryByText("Choque inevitable")).toBeNull();
    // One notice explains the short set and the unavoidable clashes together…
    const notice = screen.getByRole("status", { name: "Lo que limita este set" });
    expect(notice).toHaveTextContent(/El set dura \d+ min de los 60 pedidos/);
    expect(notice).toHaveTextContent(
      marks.length === 1 ? /1 choque inevitable/ : `${marks.length} choques inevitables`,
    );
    expect(notice).toHaveTextContent(/el set ya usa todos los temas del origen/);
    // …with the next step as a button: a bigger source.
    await userEvent.click(within(notice).getByRole("button", { name: "Cambiar origen" }));
    expect(screen.getByRole("combobox", { name: "Origen" })).toHaveFocus();
  });

  it("offers to allow a key change and regenerate when a set has clashes", async () => {
    await openBuilder();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Origen" }),
      await screen.findByRole("option", { name: "Warm-up Ibiza" }),
    );
    await userEvent.click(screen.getByRole("switch", { name: "Permitir cambio de tono (±2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await screen.findByRole("list", { name: "Set" });
    expect(last<BuilderGenerateParams>("builder.generate")?.allowShift).toBe(false);
    const regenerate = screen.getByRole("button", {
      name: "Permitir cambio de tono (±2) y regenerar",
    });
    await userEvent.click(regenerate);
    await waitFor(() =>
      expect(last<BuilderGenerateParams>("builder.generate")?.allowShift).toBe(true),
    );
    expect(screen.getByRole("switch", { name: "Permitir cambio de tono (±2)" })).toBeChecked();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Permitir cambio de tono (±2) y regenerar" }),
      ).toBeNull(),
    );
  });

  it("says so when generating again gives the same set", async () => {
    await generate();
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    expect(
      await screen.findByText("Mismo set: con estos ajustes no hay un orden mejor."),
    ).toBeInTheDocument();
  });

  it("says what changed when generating again gives another order", async () => {
    await generate();
    // Pretend the set on screen was another order (first two swapped, a worse mean).
    const current = useBuilderStore.getState().result;
    if (!current) throw new Error("no set");
    const [a, b, ...rest] = current.items;
    if (!a || !b) throw new Error("set too short");
    act(() =>
      useBuilderStore.setState({
        result: { ...current, items: [b, a, ...rest], meanScore: 0.1, clashes: 4 },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    expect(await screen.findByText("Set nuevo: 2 posiciones cambian")).toBeInTheDocument();
    expect(
      screen.getByText(/^Media de transición 0,10 → \d,\d\d · choques 4 → \d+$/),
    ).toBeInTheDocument();
  });

  it("keeps the Pro workspace when Settings opens from the builder", async () => {
    await openBuilder();
    const workspace = screen.getByRole("radiogroup", { name: "Espacio de trabajo" });
    expect(within(workspace).getByRole("radio", { name: "Pro" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(within(workspace).getByRole("radio", { name: "Pro" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: /Todos los temas/ }));
    expect(within(workspace).getByRole("radio", { name: "Biblioteca" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("builds from the whole library", async () => {
    await openBuilder();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Origen" }),
      screen.getByRole("option", { name: "Toda la biblioteca" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await screen.findByRole("list", { name: "Set" });
    expect(last<BuilderGenerateParams>("builder.generate")?.pool).toEqual({ library: true });
  });

  it("starts a set from the library selection", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Neon Cathedral");
    act(() => useLibraryStore.getState().setSelected([2, 3, 5]));
    const bar = await screen.findByRole("toolbar", { name: "Acciones de la selección" });
    await userEvent.click(within(bar).getByRole("button", { name: "Crear set" }));
    const source = await screen.findByRole("combobox", { name: "Origen" });
    expect(source).toHaveDisplayValue("Selección de la biblioteca (3 temas)");
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await screen.findByRole("list", { name: "Set" });
    expect(last<BuilderGenerateParams>("builder.generate")?.pool).toEqual({ trackIds: [2, 3, 5] });
  });

  it("keeps the same selection actions for one track, disabling what needs more", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Neon Cathedral");
    act(() => useLibraryStore.getState().setSelected([2]));
    const bar = await screen.findByRole("toolbar", { name: "Acciones de la selección" });
    // A short list keeps the bar right under its last row, near the selection.
    expect(bar.style.getPropertyValue("--rows-end")).toMatch(/^\d+px$/);
    expect(bar).toHaveClass("top-[min(var(--rows-end),calc(100%-60px))]");
    // Off but focusable, saying why (a disabled button would hide the reason from the keyboard).
    const build = within(bar).getByRole("button", { name: "Crear set" });
    expect(build).toHaveAttribute("aria-disabled", "true");
    expect(build).toHaveAccessibleDescription("Selecciona al menos 2 temas para crear un set");
    await userEvent.click(build);
    expect(useViewStore.getState().view).not.toBe("builder");
    await userEvent.click(within(bar).getByRole("button", { name: "Reanalizar" }));
    expect(last("analysis.reanalyze")).toEqual({ trackIds: [2] });
    expect(within(bar).getByRole("button", { name: "Tags…" })).toBeEnabled();
  });

  it("writes out why a menu action is off for several tracks", async () => {
    renderWithQuery(<App />);
    await screen.findByText("Neon Cathedral");
    act(() => useLibraryStore.getState().setSelected([1, 2]));
    const bar = await screen.findByRole("toolbar", { name: "Acciones de la selección" });
    await userEvent.click(within(bar).getByRole("button", { name: "Más acciones" }));
    const edit = screen.getByRole("menuitem", { name: "Editar info" });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAccessibleDescription("Solo con un tema seleccionado");
    expect(within(edit).getByText("Solo con un tema seleccionado")).toBeVisible();
    await userEvent.click(edit);
    expect(screen.queryByRole("dialog", { name: "Info del tema" })).toBeNull();
  });

  it("marks a key clash in red with a cross", async () => {
    const list = await generate();
    // Put the out-of-key track right after the first one.
    const names = () =>
      within(list)
        .getAllByRole("listitem")
        .map((r) => r.getAttribute("aria-label") ?? "");
    while (!names()[1]?.endsWith("Paper Satellites")) {
      const index = names().findIndex((n) => n.endsWith("Paper Satellites"));
      await userEvent.click(
        within(within(list).getAllByRole("listitem")[index] as HTMLElement).getByRole("button", {
          name: "Subir",
        }),
      );
    }
    const bar = await within(list).findByRole("group", { name: /^Transición 1 → 2: mala/ });
    expect(within(bar).getByText("Choque de tonalidad")).toBeInTheDocument();
    expect(within(bar).getByText("✕")).toBeInTheDocument();
  });

  it("saves the set as a playlist and exports it", async () => {
    await generate();
    await userEvent.click(screen.getByRole("button", { name: "Guardar como playlist" }));
    await waitFor(() => expect(last("playlists.addTracks")).toBeTruthy());
    const created = calls.filter((c) => c.method === "playlists.create").at(-1)?.params as {
      name: string;
      emoji: string;
    };
    expect(created.emoji).toBe("🧭");
    expect(created.name).toMatch(/^Set /);
    const added = last<{ playlistId: number; trackIds: number[] }>("playlists.addTracks");
    expect(added?.trackIds).toHaveLength(5);
    expect(await screen.findByText(/Guardado como playlist/)).toBeInTheDocument();

    vi.mocked(save).mockResolvedValueOnce("/Users/dj/Set.m3u8");
    await userEvent.click(screen.getByRole("button", { name: "Exportar set" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "M3U…" }));
    await waitFor(() =>
      expect(last("playlists.exportM3u")).toEqual({
        playlistId: added?.playlistId,
        path: "/Users/dj/Set.m3u8",
      }),
    );
    // Saved once: exporting again does not create another playlist.
    expect(calls.filter((c) => c.method === "playlists.create")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Exportar set" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rekordbox" }));
    expect(await screen.findByRole("heading", { name: /Exportar/ })).toBeInTheDocument();
    expect(useViewStore.getState().view).toBe("export");
  });

  it("builds from the library selection", async () => {
    useLibraryStore.setState({ selected: [1, 2, 5] });
    await openBuilder();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Origen" }),
      screen.getByRole("option", { name: "Selección de la biblioteca (3 temas)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Generar set" }));
    await waitFor(() =>
      expect(last<BuilderGenerateParams>("builder.generate")?.pool).toEqual({
        trackIds: [1, 2, 5],
      }),
    );
  });
});
