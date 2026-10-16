// "Revisar cues" (SPEC 12.5): verdicts with the keyboard, correcting a misplaced cue,
// marking a missing one, undo, the report, and the way in from the detail and Analyse.
import { screen, waitFor, within } from "@testing-library/react";
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
import { closePlayer } from "../player/playerStore";
import { useToastStore } from "../toast/toastStore";

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

const verdicts = () =>
  calls
    .filter((c) => c.method === "cueReview.set")
    .map((c) => c.params as { slot?: number; verdict: string });

beforeEach(async () => {
  resetEngine();
  closePlayer();
  useToastStore.setState({ toasts: [] });
  engine.tracks = [1, 2].map((id) =>
    track(id, { title: `Tema ${id}`, status: "ready", keyRoot: 9, keyMode: "minor", bpm: 120 }),
  );
  for (const id of [1, 2]) {
    engine.details.set(id, {
      beatGrid: { kind: "constant", bpm: 120, first_downbeat: 0 },
      segments: [
        { start: 0, end: 32, label: "intro", energy: 4 },
        { start: 32, end: 96, label: "drop", energy: 8 },
      ],
      waveformPath: null,
    });
    engine.cues.set(id, [
      { slot: 0, positionSec: 0, label: "intro", color: "#4CC3FF", source: "auto" },
      { slot: 1, positionSec: 32, label: "drop", color: "#FF5F8A", source: "auto" },
    ]);
  }
  await i18n.changeLanguage("es");
});

test("reviews a batch with the keyboard: correct, misplaced (and fixed), missing, undo", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "queue", back: "library" });
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Revisar cues…" }));
  const card = await screen.findByRole("article", { name: "Cue 1 de 2" });
  expect(within(card).getByText("Tema 1 de 2 · cue 1 de 2")).toBeInTheDocument();
  // The cue plays as it appears.
  await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());

  await user.keyboard("1");
  expect(await screen.findByRole("article", { name: "Cue 2 de 2" })).toBeInTheDocument();
  await user.keyboard("2");
  // Misplaced: put it in place, then go on.
  await user.click(await screen.findByRole("button", { name: /Fijar cue aquí/ }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "cues.set",
      params: expect.objectContaining({ trackId: 1, slot: 1, label: "drop" }),
    }),
  );
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Tema 2 de 2 · cue 1 de 2")).toBeInTheDocument();
  // On a cue, nothing is missing; 5 s later (bar 3, no cue) it is noted.
  await user.keyboard("3");
  expect(await screen.findByText(/Ya hay un cue en ese compás/)).toBeInTheDocument();
  screen.getByRole("slider", { name: "Forma de onda del tema revisado" }).focus();
  await user.keyboard("{ArrowRight}");
  await user.keyboard("3");
  expect(await screen.findByText(/Anotado: falta un cue en/)).toBeInTheDocument();
  await waitFor(() =>
    expect(verdicts()).toEqual([
      { trackId: 1, slot: 0, verdict: "ok" },
      { trackId: 1, slot: 1, verdict: "wrong" },
      expect.objectContaining({ trackId: 2, verdict: "missing" }),
    ]),
  );

  // The report: 1 of 2 correct, the drop misplaced, a cue missing in the intro.
  const report = screen.getByRole("region", { name: "Informe" });
  expect(within(report).getByText("50 %")).toBeInTheDocument();
  const drop = within(report).getByRole("row", { name: /Drop/ });
  expect(drop).toHaveTextContent("Drop110");

  // ⌘Z takes the missing mark back.
  await user.keyboard("{Meta>}z{/Meta}");
  await waitFor(() => expect(calls.some((c) => c.method === "cueReview.delete")).toBe(true));

  // Off the waveform, → skips a cue.
  (document.activeElement as HTMLElement | null)?.blur();
  await user.keyboard("{ArrowRight}{ArrowRight}");
  expect(await screen.findByText("Tanda revisada")).toBeInTheDocument();
});

test("opens from the detail for that track and Back returns to it", async () => {
  const user = userEvent.setup();
  useViewStore.setState({ view: "detail", trackId: 2, back: "library" });
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Revisar cues" }));
  expect(await screen.findByText("Tema 1 de 1 · cue 1 de 2")).toBeInTheDocument();
  expect(calls).toContainEqual({ method: "cueReview.queue", params: { n: 20, trackIds: [2] } });
  await user.click(screen.getByRole("button", { name: "Volver" }));
  expect(useViewStore.getState()).toMatchObject({ view: "detail", trackId: 2 });
});
