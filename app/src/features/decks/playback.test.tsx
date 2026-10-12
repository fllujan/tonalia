// Synchronized playback of the Pro decks (SPEC 2.15, task 8.3): cue clicks, "Try mashup",
// "Try mix" with the automatic crossfade, and renders lined up on their downbeats.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { JobFinished, RenderSpec } from "../../lib/rpc.types";
import { FakeAudioContext } from "../../test/fakeAudio";
import {
  calls,
  engine,
  invoke,
  listeners,
  renderWithQuery,
  resetEngine,
  stemSet,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { EMPTY_FILTERS, useDecksStore } from "./decksStore";
import { finishRender, renderPreview } from "./renderJobs";
import { player, setAudioContextFactory, usePlaybackStore } from "./syncPlayer";

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

const BAR = 240 / 124;
const ready = { status: "ready" as const };
let ctx: FakeAudioContext;

beforeEach(async () => {
  resetEngine();
  engine.tracks = [
    track(1, {
      ...ready,
      title: "Midnight Bloom",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 7,
    }),
    track(4, {
      ...ready,
      title: "Run The Signal",
      keyRoot: 9,
      keyMode: "minor",
      bpm: 124,
      energy: 8,
    }),
  ];
  engine.details.set(1, {
    beatGrid: { kind: "constant", bpm: 124, first_downbeat: 0.3, beats: null },
    segments: [
      { start: 0.3, end: 62.235, label: "intro", energy: 4 },
      { start: 300.3, end: 372, label: "outro", energy: 3 },
    ],
  });
  engine.cues.set(1, [
    { slot: 0, positionSec: 0.3, label: "intro", color: null, source: "auto" },
    { slot: 2, positionSec: 62.235, label: "drop", color: null, source: "auto" },
  ]);
  engine.details.set(4, {
    beatGrid: { kind: "constant", bpm: 124, first_downbeat: 0.9, beats: null },
  });
  ctx = new FakeAudioContext();
  setAudioContextFactory(() => ctx as unknown as AudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ),
  );
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useDecksStore.setState({
    mode: "mashup",
    trackA: 1,
    idea: 0,
    filters: EMPTY_FILTERS,
    allowShift: true,
    energyDirection: "up",
    filtersOpen: false,
    anchors: { a: null, b: null },
    crossfadeBars: 16,
    shifts: { a: 0, b: 0 },
    stems: { a: "mix", b: "mix" },
    loops: { a: null, b: null },
    freeLoops: { a: null, b: null },
  });
  useViewStore.setState({ view: "pro" });
  usePlaybackStore.setState({ status: "idle", kind: null, clocks: {}, error: null });
  await i18n.changeLanguage("es");
});

afterEach(() => {
  player.stop();
  vi.unstubAllGlobals();
});

const renders = () =>
  calls.filter((c) => c.method === "render.preview").map((c) => c.params as RenderSpec);

/** First downbeat the fake engine reports for a track, in seconds. */
const downbeat = (trackId: number) => Math.round(((trackId * 0.173) % 1) * 44100) / 44100;

async function openStudio() {
  renderWithQuery(<App />);
  return screen.findByRole("region", { name: "Deck B: Run The Signal" });
}

describe("synchronized playback", () => {
  it("plays the mashup with both downbeats on the same instant", async () => {
    await openStudio();
    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    expect(renders().slice(-2)).toEqual([
      { trackId: 1, source: "mix", start: 0.3, duration: 30.968, semitones: 0, targetBpm: null },
      { trackId: 4, source: "mix", start: 0.9, duration: 30.968, semitones: 0, targetBpm: 124 },
    ]);
    const [a, b] = ctx.started;
    expect(a && b).toBeTruthy();
    // Downbeat of A = downbeat of B, to well under the 5 ms of the acceptance criterion.
    const offset = (a?.when ?? 0) + downbeat(1) - ((b?.when ?? 0) + downbeat(4));
    expect(Math.abs(offset)).toBeLessThan(1e-9);
    expect(Math.min(a?.when ?? 0, b?.when ?? 0)).toBeGreaterThanOrEqual(ctx.currentTime);

    await userEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(usePlaybackStore.getState().status).toBe("idle");
  });

  it("plays a cue's segment synchronized with the other deck", async () => {
    await openStudio();
    const pads = screen.getByRole("group", { name: "Cues de Deck A" });
    await userEvent.click(within(pads).getByRole("button", { name: /^Cue 3/ }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    expect(
      renders()
        .slice(-2)
        .map((s) => [s.trackId, s.start]),
    ).toEqual([
      [1, 62.235],
      [4, 0.9],
    ]);
    expect(usePlaybackStore.getState().kind).toBe("mashup");
    expect(useDecksStore.getState().anchors.a).toBe(62.235);
  });

  it("tries the mix from the outro with a 32-bar equal-power crossfade", async () => {
    await openStudio();
    await userEvent.click(screen.getByRole("radio", { name: "DJ Mix" }));
    await screen.findByRole("region", { name: /^Deck B: / });
    await userEvent.click(screen.getByRole("radio", { name: "32 compases" }));
    await userEvent.click(screen.getByRole("button", { name: "Probar mezcla" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    const [specA, specB] = renders().slice(-2);
    expect(specA?.start).toBeCloseTo(300.3 - 8 * BAR, 2);
    expect(specA?.duration).toBeCloseTo(40 * BAR, 2);
    expect(specB).toMatchObject({ trackId: 4, start: 0.9, targetBpm: 124 });
    // Both fades span 32 bars and start on A's outro (8 bars after the common downbeat).
    expect(ctx.curves.map((c) => c.length)).toEqual(
      [32 * BAR, 32 * BAR].map((x) => expect.closeTo(x, 6)),
    );
    const [fadeOut, fadeIn] = ctx.curves;
    expect(fadeOut?.curve[0]).toBe(1);
    expect(fadeIn?.curve[0]).toBe(0);
    const common = (ctx.started[0]?.when ?? 0) + downbeat(1);
    expect(fadeOut?.at).toBeCloseTo(common + 8 * BAR, 6);
    // B's first downbeat lands exactly on A's outro.
    expect((ctx.started[1]?.when ?? 0) + downbeat(4)).toBeCloseTo(common + 8 * BAR, 9);
  });

  it("plays one deck alone and moves its anchor to the clicked bar", async () => {
    await openStudio();
    const deckA = screen.getByRole("region", { name: "Deck A: Midnight Bloom" });
    await userEvent.click(within(deckA).getByRole("button", { name: "Reproducir Deck A" }));
    await waitFor(() => expect(usePlaybackStore.getState().kind).toBe("a"));
    expect(renders().at(-1)).toMatchObject({ trackId: 1, start: 0.3, semitones: 0 });
    expect(ctx.started).toHaveLength(1);
  });

  it("shows why the audio could not be prepared", async () => {
    engine.renderError = "rubberband not found";
    await openStudio();
    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo preparar el audio: rubberband not found",
    );
  });
});

describe("render jobs", () => {
  const done = (jobId: string): JobFinished => ({
    jobId,
    kind: "render.preview",
    status: "done",
    result: {
      path: "/x.wav",
      sampleRate: 44100,
      frames: 1,
      duration: 0,
      bpm: null,
      timeRatio: 1,
      firstDownbeat: 0,
      cached: false,
    },
  });

  it("waits for job.finished when the render is not cached", async () => {
    const spy = vi.spyOn(await import("../../lib/rpc"), "request");
    spy.mockResolvedValueOnce({ jobId: "job-7" });
    const pending = renderPreview({ trackId: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    finishRender(done("job-7"));
    await expect(pending).resolves.toMatchObject({ path: "/x.wav" });

    // A job that finishes before its id comes back is not lost.
    finishRender(done("job-8"));
    spy.mockResolvedValueOnce({ jobId: "job-8" });
    await expect(renderPreview({ trackId: 1 })).resolves.toMatchObject({ path: "/x.wav" });

    spy.mockResolvedValueOnce({ jobId: "job-9" });
    const failing = renderPreview({ trackId: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    finishRender({ jobId: "job-9", kind: "render.preview", status: "failed", error: "boom" });
    await expect(failing).rejects.toThrow("boom");
    spy.mockRestore();
  });

  it("plays each deck with its key change and follows a new key of B", async () => {
    await openStudio();
    const pitchA = screen.getByRole("group", { name: "Tono de Deck A" });
    await userEvent.click(within(pitchA).getByRole("button", { name: "Subir un semitono" }));
    // A in 3A: the idea moves B (8A) up 1 to 3A; the user adds one more.
    const deckB = await screen.findByRole("region", { name: "Deck B: Run The Signal" });
    await waitFor(() => expect(within(deckB).getByText("+1 st")).toBeInTheDocument());
    const pitchB = screen.getByRole("group", { name: "Tono de Deck B" });
    await userEvent.click(within(pitchB).getByRole("button", { name: "Subir un semitono" }));

    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    const [a, b] = renders().slice(-2);
    expect(a).toMatchObject({ trackId: 1, semitones: 1, targetBpm: null });
    expect(b).toMatchObject({ trackId: 4, semitones: 2, targetBpm: 124 });

    // B's key changes under the mashup: it plays again with the new key.
    await userEvent.click(within(pitchB).getByRole("button", { name: "Bajar un semitono" }));
    await waitFor(() => expect(renders().at(-1)).toMatchObject({ trackId: 4, semitones: 1 }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    // A new key for A means new ideas: the playback stops.
    await userEvent.click(within(pitchA).getByRole("button", { name: "Subir un semitono" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("idle"));
  });

  it("plays the chosen stem and the full track while a deck has no stems", async () => {
    engine.stems.sets.set(1, stemSet(1));
    engine.stems.models = engine.stems.models.map((m) => ({ ...m, installed: true }));
    await openStudio();
    const deckA = screen.getByRole("region", { name: "Deck A: Midnight Bloom" });
    const deckB = screen.getByRole("region", { name: "Deck B: Run The Signal" });
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Stem de Deck A" })).getByRole("radio", {
        name: "Voz",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Stem de Deck B" })).getByRole("radio", {
        name: "Instrumental",
      }),
    );
    expect(within(deckB).getByText("Sin stems: suena el tema completo")).toBeInTheDocument();
    expect(within(deckA).queryByText("Sin stems: suena el tema completo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    const [a, b] = renders().slice(-2);
    expect(a).toMatchObject({ trackId: 1, source: "vocals" });
    expect(b).toMatchObject({ trackId: 4, source: "mix" });

    await userEvent.click(within(deckB).getByRole("button", { name: "Separar stems" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "stems.separate")?.params).toEqual({ trackIds: [4] }),
    );
    expect(await within(deckB).findByText("Separando stems… 0 %")).toBeInTheDocument();
  });

  it("loops a deck until stopped, with whole bars or a free loop on the beat", async () => {
    await openStudio();
    const deckA = screen.getByRole("region", { name: "Deck A: Midnight Bloom" });
    await userEvent.selectOptions(
      within(deckA).getByRole("combobox", { name: "Loop de Deck A" }),
      "4",
    );
    expect(within(deckA).getByTestId("loop-region")).toBeInTheDocument();
    await userEvent.click(within(deckA).getByRole("button", { name: "Reproducir Deck A" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    expect(renders().at(-1)).toMatchObject({ trackId: 1, start: 0.3, duration: 7.992 });
    expect(ctx.started.at(-1)).toMatchObject({ loop: true, loopStart: 0 });
    expect(ctx.started.at(-1)?.loopEnd).toBeCloseTo(7.742, 3);

    // "Try mashup" loops A and plays B's 16 bars.
    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    await waitFor(() => expect(ctx.started).toHaveLength(3));
    expect(ctx.started[1]?.loop).toBe(true);
    expect(ctx.started[2]?.loop).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Parar" }));

    // Free loop: starts as 4 bars; the waveform moves its nearer edge to the beat.
    await userEvent.selectOptions(
      within(deckA).getByRole("combobox", { name: "Loop de Deck A" }),
      "free",
    );
    const wave = within(deckA).getByRole("slider", { name: "Posición en Deck A" });
    wave.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(within(deckA).getByRole("button", { name: "Reproducir Deck A" }));
    await waitFor(() => expect(usePlaybackStore.getState().kind).toBe("a"));
    // End moved from 8.042 to the beat nearest 5.3 s: 0.3 + 10 beats of 0.4839 s.
    expect(renders().at(-1)?.start).toBe(0.3);
    expect(renders().at(-1)?.duration).toBeCloseTo(4.839 + 0.25, 3);
  });

  it("keeps a looped deck playing while the ideas of B change", async () => {
    engine.tracks.push(
      track(7, {
        ...ready,
        title: "Golden Hour",
        keyRoot: 9,
        keyMode: "minor",
        bpm: 124,
        energy: 7,
      }),
    );
    await openStudio();
    const deckA = screen.getByRole("region", { name: "Deck A: Midnight Bloom" });
    await userEvent.selectOptions(
      within(deckA).getByRole("combobox", { name: "Loop de Deck A" }),
      "4",
    );
    await userEvent.click(screen.getByRole("button", { name: "Probar mashup" }));
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    const firstB = renders().at(-1)?.trackId;

    await userEvent.click(screen.getByRole("button", { name: "Idea siguiente" }));
    await waitFor(() => {
      const [a, b] = renders().slice(-2);
      expect(a).toMatchObject({ trackId: 1, start: 0.3 });
      expect(b?.trackId).not.toBe(firstB);
    });
    await waitFor(() => expect(usePlaybackStore.getState().status).toBe("playing"));
    expect(usePlaybackStore.getState().kind).toBe("mashup");
  });
});
