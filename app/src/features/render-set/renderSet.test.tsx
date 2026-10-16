// Render a set to audio (SPEC 14.2, DESIGN 6.26): from the set builder and a playlist,
// the options, a preview of a transition, the progress, the outcome and cancelling.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { RenderSetParams } from "../../lib/rpc.types";
import {
  addPlaylist,
  calls,
  emit,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  revealed,
  track,
} from "../../test/fakeEngine";
import { useBuilderStore } from "../playlist-builder/builderStore";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { useRenderSet } from "./store";

const saveDialog = vi.fn();
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
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: (...a: unknown[]) => saveDialog(...a) as unknown,
}));

const played: string[] = [];
class FakeAudio {
  onended: (() => void) | null = null;
  constructor(public src: string) {}
  play() {
    played.push(this.src);
    return Promise.resolve();
  }
  pause() {}
}

const ready = { status: "ready" as const, keyRoot: 9, keyMode: "minor" as const, energy: 6 };
const last = () =>
  calls.filter((c) => c.method === "render.set").at(-1)?.params as RenderSetParams | undefined;

function finish(result: Partial<Record<string, unknown>>, status = "done") {
  const jobId = useRenderSet.getState().running?.jobId ?? "";
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: { jobId, kind: "render.set", status, error: null, result },
    }),
  );
}

const RESULT = {
  path: "/Users/dj/Sets/Bolo.flac",
  txtPath: "/Users/dj/Sets/Bolo.txt",
  cuePath: "/Users/dj/Sets/Bolo.cue",
  format: "flac",
  duration: 3452,
  tracks: [
    { trackId: 1, title: "Midnight Bloom", artist: null, start: 0 },
    { trackId: 2, title: "Golden Hour Tide", artist: null, start: 300 },
  ],
  loudnessLufs: -14.02,
  truePeakDb: -1.21,
  lowered: 2,
  rendered: 2,
  cached: 0,
  preview: false,
  elapsedMs: 84000,
};

beforeEach(async () => {
  resetEngine();
  saveDialog.mockReset();
  played.length = 0;
  localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
  engine.tracks = [
    track(1, { ...ready, title: "Midnight Bloom", bpm: 124 }),
    track(2, { ...ready, title: "Golden Hour Tide", bpm: 124 }),
    track(3, { ...ready, title: "Neon Cathedral", bpm: 126 }),
  ];
  useRenderSet.setState({ target: null, running: null, outcome: null, playing: null });
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useBuilderStore.getState().reset();
  await i18n.changeLanguage("es");
});

afterEach(() => vi.unstubAllGlobals());

test("from the set builder: options, render with its track list, and show the file", async () => {
  useViewStore.setState({ view: "builder" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Generar set" }));
  await screen.findByRole("list", { name: "Set" });
  await user.click(screen.getByRole("button", { name: "Renderizar set…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/3 temas en un solo archivo de audio/)).toBeVisible();
  // MP3 is offered because this FFmpeg can write it; WAV has no chapters.
  expect(within(dialog).getByRole("switch", { name: /Capítulos/ })).toBeDisabled();
  await user.click(within(dialog).getByRole("radio", { name: "FLAC 24 bits" }));
  await user.click(within(dialog).getByRole("switch", { name: /Capítulos/ }));
  await user.click(within(dialog).getByRole("switch", { name: /Intercambio de graves/ }));
  await user.click(within(dialog).getByRole("radio", { name: "BPM fijo" }));
  expect(within(dialog).getByRole("spinbutton", { name: "BPM del set" })).toHaveValue(124);

  saveDialog.mockResolvedValue("/Users/dj/Sets/Bolo.flac");
  await user.click(within(dialog).getByRole("button", { name: "Renderizar…" }));
  await waitFor(() => expect(last()).toBeDefined());
  expect(last()).toMatchObject({
    path: "/Users/dj/Sets/Bolo.flac",
    format: "flac",
    chapters: true,
    bassSwap: true,
    tempo: "fixed",
    fixedBpm: 124,
    targetLufs: -14,
    normalize: true,
    style: "intro_outro",
  });
  expect(last()?.items).toHaveLength(3);
  // Progress per track, then the outcome.
  const jobId = useRenderSet.getState().running?.jobId ?? "";
  act(() =>
    emit("engine://progress", { jobId, stage: "rendering", percent: 45, done: 2, total: 3 }),
  );
  expect(await within(dialog).findByText("Renderizando tema 2 de 3")).toBeVisible();
  finish(RESULT);
  expect(await within(dialog).findByText("Set renderizado")).toBeVisible();
  expect(within(dialog).getByText(/2 temas · 57:32 · −14,0 LUFS · pico −1,2 dBTP/)).toBeVisible();
  expect(within(dialog).getByText(/2 tramos con un poco menos de volumen/)).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Mostrar archivo" }));
  expect(revealed).toEqual(["/Users/dj/Sets/Bolo.flac"]);
  // The options are remembered for the next time.
  expect(JSON.parse(localStorage.getItem("tonalia.renderSet.options") ?? "{}")).toMatchObject({
    format: "flac",
    bassSwap: true,
  });
});

test("listen to one transition before rendering", async () => {
  act(() =>
    useRenderSet.getState().open({
      items: [
        { trackId: 1, shift: 0 },
        { trackId: 2, shift: 2 },
        { trackId: 3, shift: 0 },
      ],
      name: "Bolo",
      titles: ["Midnight Bloom", "Golden Hour Tide", "Neon Cathedral"],
    }),
  );
  useViewStore.setState({ view: "library" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  const dialog = await screen.findByRole("dialog");
  // The set shifts a key: the option to apply it shows.
  expect(within(dialog).getByRole("switch", { name: /cambios de tono/ })).toBeChecked();
  const rows = within(
    within(dialog).getByRole("region", { name: "Escuchar las transiciones" }),
  ).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[1]).toHaveTextContent("Golden Hour Tide → Neon Cathedral");
  await user.click(within(dialog).getByRole("button", { name: "Escuchar la transición 2" }));
  await waitFor(() => expect(last()).toMatchObject({ previewTransition: 1 }));
  finish({ ...RESULT, path: "/data/cache/render_set/preview-1.wav", preview: true });
  await waitFor(() =>
    expect(played).toEqual(["asset://localhost/%2Fdata%2Fcache%2Frender_set%2Fpreview-1.wav"]),
  );
  expect(within(dialog).getByRole("button", { name: "Parar la transición 2" })).toBeVisible();
  // A preview never counts as the render's outcome.
  expect(within(dialog).queryByText("Set renderizado")).toBeNull();
});

test("from a playlist's menu, in its order; cancelling saves nothing", async () => {
  const set = addPlaylist("Bolo sábado", { emoji: "🔥" }, [3, 1, 2]);
  useViewStore.setState({ view: "library" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Acciones de «Bolo sábado»" }));
  await user.click(await screen.findByRole("menuitem", { name: /Renderizar set/ }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Neon Cathedral → Midnight Bloom/)).toBeVisible();
  saveDialog.mockResolvedValue("/Users/dj/Sets/Bolo.wav");
  await user.click(within(dialog).getByRole("button", { name: "Renderizar…" }));
  await waitFor(() => expect(last()).toMatchObject({ playlistId: set.id, format: "wav" }));
  await user.click(within(dialog).getByRole("button", { name: "Cancelar render" }));
  await waitFor(() => expect(calls.some((c) => c.method === "job.cancel")).toBe(true));
  finish({}, "cancelled");
  expect(await within(dialog).findByText(/Render cancelado/)).toBeVisible();
});
