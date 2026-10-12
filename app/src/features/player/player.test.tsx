// Library player (DESIGN, Layout: bottom player; SPEC 2.14: space = play/pause).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import { claimAudio } from "../../lib/audioFocus";
import type { Cue } from "../../lib/rpc.types";
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
import { cueStep } from "./cueStep";
import { closePlayer, loadTrack, togglePlayback, usePlayerStore } from "./playerStore";

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

const cue = (slot: number, positionSec: number): Cue => ({
  slot,
  positionSec,
  label: null,
  color: null,
  source: "auto",
});

// jsdom does not play media: make play()/pause() fire the events a real element would.
beforeEach(async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  closePlayer();
  resetEngine();
  useLibraryStore.setState({
    search: "",
    sort: "title",
    descending: false,
    filter: {},
    selected: [],
  });
  useViewStore.setState({ view: "library", playlistId: null });
  engine.tracks = [
    track(1, { title: "Midnight Bloom", keyRoot: 9, keyMode: "minor", bpm: 124, energy: 7 }),
    track(2, { title: "Golden Hour Tide", keyRoot: 4, keyMode: "minor", bpm: 124, energy: 6 }),
  ];
  await i18n.changeLanguage("es");
});

describe("cueStep", () => {
  const cues = [cue(1, 60), cue(0, 0.5), cue(2, 120)];
  it("goes to the next cue after the playhead", () => {
    expect(cueStep(cues, 10, 1)).toBe(60);
    expect(cueStep(cues, 60, 1)).toBe(120);
    expect(cueStep(cues, 130, 1)).toBeNull();
  });
  it("goes back past a cue that just played, and to the start before the first", () => {
    expect(cueStep(cues, 60.2, -1)).toBe(0.5);
    expect(cueStep(cues, 90, -1)).toBe(60);
    expect(cueStep(cues, 0.6, -1)).toBe(0);
    expect(cueStep([], 30, -1)).toBe(0);
  });
});

describe("player store", () => {
  const a = track(1, { title: "Midnight Bloom" });
  const b = track(2, { title: "Golden Hour Tide" });

  it("loads, plays, pauses and switches tracks", async () => {
    loadTrack(a, { play: true });
    expect(usePlayerStore.getState().track?.id).toBe(1);
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));
    togglePlayback();
    expect(usePlayerStore.getState().playing).toBe(false);
    togglePlayback(b);
    expect(usePlayerStore.getState().track?.id).toBe(2);
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));
  });

  it("stops when the Pro decks take the output, and closes cleanly", async () => {
    loadTrack(a, { play: true });
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));
    const stopDecks = vi.fn();
    claimAudio("decks", stopDecks);
    expect(usePlayerStore.getState().playing).toBe(false);
    togglePlayback();
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));
    expect(stopDecks).toHaveBeenCalledOnce();
    closePlayer();
    expect(usePlayerStore.getState()).toMatchObject({ track: null, playing: false, time: 0 });
  });
});

describe("bottom player", () => {
  async function showLibrary() {
    renderWithQuery(<App />);
    await screen.findByText("Midnight Bloom");
  }

  it("appears when a row is played and shows the track", async () => {
    await showLibrary();
    expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
    const bar = await screen.findByRole("region", { name: "Reproductor" });
    expect(within(bar).getByText("Midnight Bloom")).toBeInTheDocument();
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Pausa" })).toBeVisible());
    expect(screen.getByRole("button", { name: "Pausar «Midnight Bloom»" })).toBeInTheDocument();
  });

  it("plays the focused row with space and pauses with space again", async () => {
    await showLibrary();
    const row = screen.getByText("Golden Hour Tide").closest("[role=row]") as HTMLElement;
    act(() => row.focus());
    await userEvent.keyboard(" ");
    await waitFor(() => expect(usePlayerStore.getState()).toMatchObject({ playing: true }));
    expect(usePlayerStore.getState().track?.id).toBe(2);
    await userEvent.keyboard(" ");
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it("hides in Pro and in the detail of the playing track, and keeps playing there", async () => {
    await showLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
    await screen.findByRole("region", { name: "Reproductor" });

    act(() => useViewStore.getState().openDetail(1));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull());
    // The detail view shows the same playback: its button pauses.
    expect(await screen.findByRole("button", { name: "Pausa" })).toBeInTheDocument();

    act(() => useViewStore.getState().show("pro"));
    expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull();
    act(() => useViewStore.getState().show("library"));
    expect(await screen.findByRole("region", { name: "Reproductor" })).toBeInTheDocument();
  });

  it("shrinks to a now-playing strip in the detail of another track", async () => {
    await showLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
    await screen.findByRole("region", { name: "Reproductor" });

    act(() => useViewStore.getState().openDetail(2));
    const strip = await screen.findByRole("region", { name: "Reproductor" });
    // One transport on screen: the strip has no cue buttons or waveform of its own.
    await waitFor(() => expect(within(strip).getByText("Sonando:")).toBeInTheDocument());
    expect(within(strip).getByText("Midnight Bloom")).toBeInTheDocument();
    expect(within(strip).queryByRole("button", { name: "Cue anterior" })).toBeNull();
    await userEvent.click(within(strip).getByRole("button", { name: "Pausar «Midnight Bloom»" }));
    expect(usePlayerStore.getState().playing).toBe(false);
    expect(within(strip).getByText("En pausa:")).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole("button", { name: "Ir al tema" }));
    expect(useViewStore.getState().trackId).toBe(1);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull());
  });

  it("pauses the library track on entering Pro, where nothing would show it", async () => {
    await showLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));

    act(() => useViewStore.getState().show("pro"));
    await waitFor(() => expect(usePlayerStore.getState().playing).toBe(false));
    // Still loaded: back in the library the bar offers to carry on.
    act(() => useViewStore.getState().show("library"));
    const bar = await screen.findByRole("region", { name: "Reproductor" });
    expect(within(bar).getByRole("button", { name: "Reproducir" })).toBeInTheDocument();
  });

  it.each(["favorites", "builder"] as const)(
    "hides and pauses in %s, which belongs to the Pro section",
    async (view) => {
      await showLibrary();
      await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
      await waitFor(() => expect(usePlayerStore.getState().playing).toBe(true));
      act(() => useViewStore.getState().show(view));
      await waitFor(() => expect(usePlayerStore.getState().playing).toBe(false));
      expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull();
    },
  );

  it("closes with its button", async () => {
    await showLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Reproducir «Midnight Bloom»" }));
    const bar = await screen.findByRole("region", { name: "Reproductor" });
    await userEvent.click(within(bar).getByRole("button", { name: "Cerrar el reproductor" }));
    expect(screen.queryByRole("region", { name: "Reproductor" })).toBeNull();
    expect(usePlayerStore.getState().track).toBeNull();
  });
});
