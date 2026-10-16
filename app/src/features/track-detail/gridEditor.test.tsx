// Beatgrid editor (SPEC 12.4): open it from the detail, nudge with the keyboard, undo,
// set the first downbeat, add an anchor, save (locked), snap off-beat cues, lock, reset.
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

const saved = () =>
  calls
    .filter((c) => c.method === "grid.update")
    .map((c) => (c.params as { grid: { bpm: number; firstDownbeat: number } }).grid);

beforeEach(async () => {
  resetEngine();
  closePlayer();
  useToastStore.setState({ toasts: [] });
  engine.tracks = [
    track(1, { title: "Midnight Bloom", status: "ready", keyRoot: 9, keyMode: "minor", bpm: 120 }),
  ];
  engine.details.set(1, {
    beatGrid: { kind: "constant", bpm: 120, first_downbeat: 0.5 },
    gridSource: "auto",
    gridLocked: false,
    segments: [
      { start: 0, end: 30, label: "intro", energy: 4 },
      { start: 30, end: 90, label: "drop", energy: 8 },
    ],
    waveformPath: null,
  });
  // A user cue on a beat of the analysed grid (0.5 + 4 × 0.5 s).
  engine.cues.set(1, [{ slot: 2, positionSec: 2.5, label: null, color: null, source: "user" }]);
  useViewStore.setState({ view: "detail", trackId: 1, back: "library" });
  await i18n.changeLanguage("es");
});

async function openEditor() {
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "Editar rejilla" }));
  const editor = await screen.findByRole("region", { name: "Rejilla de beats" });
  return { user, editor };
}

test("nudges with , and . (⇧ = 10 ms), undoes and redoes, and saves a locked grid", async () => {
  const { user, editor } = await openEditor();
  const save = within(editor).getByRole("button", { name: "Guardar rejilla" });
  expect(save).toBeDisabled();

  await user.keyboard("..{Shift>}.{/Shift}");
  expect(within(editor).getByText("+12 ms")).toBeInTheDocument();
  await user.keyboard("{Meta>}z{/Meta}");
  expect(within(editor).getByText("+2 ms")).toBeInTheDocument();
  await user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
  expect(within(editor).getByText("+12 ms")).toBeInTheDocument();
  await user.click(within(editor).getByRole("button", { name: "Mover -1 ms" }));
  expect(within(editor).getByText("+11 ms")).toBeInTheDocument();

  // BPM with decimals.
  const bpm = within(editor).getByRole("textbox", { name: "BPM" });
  await user.clear(bpm);
  await user.type(bpm, "121,5{Enter}");
  expect(bpm).toHaveValue("121.50");

  await user.click(save);
  await waitFor(() => expect(saved()).toHaveLength(1));
  const [grid] = saved();
  expect(grid?.bpm).toBe(121.5);
  expect(grid?.firstDownbeat).toBeCloseTo(0.511);
  // The editor closes; the header says the grid is by hand and locked.
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Rejilla de beats" })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Rejilla a mano")).toBeInTheDocument();
  const lock = screen.getByRole("button", { name: "Desbloquear la rejilla" });
  expect(lock).toHaveAttribute("aria-pressed", "true");

  // The user's cue no longer sits on a beat: the toast offers to snap it.
  const toast = (await screen.findByText("1 cue tuyo ya no cae en un beat")).closest(
    "[role=status]",
  ) as HTMLElement;
  await user.click(within(toast).getByRole("button", { name: "Ajustar al beat" }));
  expect(calls).toContainEqual({ method: "grid.snapCues", params: { trackId: 1, slots: [2] } });

  await user.click(lock);
  expect(calls).toContainEqual({ method: "grid.lock", params: { trackId: 1, locked: false } });
  expect(await screen.findByRole("button", { name: "Bloquear la rejilla" })).toBeInTheDocument();
});

test("first downbeat here, anchors and reset to the analysis", async () => {
  const { user, editor } = await openEditor();
  // The playhead is at 0:00: the downbeat moves there.
  await user.click(within(editor).getByRole("button", { name: /Primer downbeat aquí/ }));
  expect(within(editor).getByText("-500 ms")).toBeInTheDocument();

  // An anchor needs a beat after the first downbeat: move the playhead with the slider.
  const zoomed = within(editor).getByRole("slider", { name: "Rejilla ampliada" });
  zoomed.focus();
  await user.keyboard("{ArrowRight}{ArrowRight}");
  await user.keyboard("a");
  expect(within(editor).getByText(/1 ancla · tempo variable/)).toBeInTheDocument();
  expect(within(editor).getByRole("textbox", { name: "BPM" })).toBeDisabled();
  expect(within(editor).getByRole("button", { name: /Ancla en el beat 20/ })).toBeInTheDocument();
  await user.click(within(editor).getByRole("button", { name: "Quitar ancla" }));
  expect(within(editor).getByText("Tempo fijo")).toBeInTheDocument();

  await user.click(within(editor).getByRole("button", { name: "Guardar rejilla" }));
  await waitFor(() => expect(saved()).toHaveLength(1));
  expect(saved()[0]?.firstDownbeat).toBe(0);

  // Reopened, a user grid can go back to the analysis.
  await user.click(await screen.findByRole("button", { name: "Editar rejilla" }));
  const again = await screen.findByRole("region", { name: "Rejilla de beats" });
  await user.click(within(again).getByRole("button", { name: "Restablecer al análisis" }));
  expect(calls).toContainEqual({ method: "grid.reset", params: { trackId: 1 } });
  await waitFor(() => expect(screen.queryByText("Rejilla a mano")).not.toBeInTheDocument());
});

test("Escape closes the editor without leaving the detail", async () => {
  const { user } = await openEditor();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Rejilla de beats" })).not.toBeInTheDocument(),
  );
  expect(useViewStore.getState().view).toBe("detail");
  expect(calls.some((c) => c.method === "grid.update")).toBe(false);
});
