// ReplayGain (SPEC 13.6): the optional "Gain" column, the gain in the detail, writing the
// tags from Tags (off by default) and Traktor's LOUDNESS on export (opt-in).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import type { TagPreviewParams } from "../../lib/rpc.types";
import {
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

const ready = { status: "ready" as const, keyRoot: 9, keyMode: "minor" as const, bpm: 124 };

beforeEach(async () => {
  resetEngine();
  localStorage.clear();
  useLibraryStore.setState({ search: "", filter: {}, selected: [], gainColumn: false });
  engine.tracks = [
    track(1, { ...ready, title: "Midnight Bloom", replaygainDb: -9.82 }),
    track(2, { ...ready, title: "Paper Satellites", replaygainDb: 2.4 }),
  ];
  await i18n.changeLanguage("es");
});

test("the gain column is switched on in Settings and sorts the table", async () => {
  useViewStore.setState({ view: "settings" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("button", { name: "General" }));
  const toggle = screen.getByRole("switch", { name: "Columna «Ganancia»" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  await user.click(toggle);
  expect(localStorage.getItem("tonalia.library.gainColumn")).toBe("1");

  useViewStore.setState({ view: "library" });
  const header = await screen.findByRole("columnheader", { name: /Ganancia/ });
  expect(await screen.findByText("−9,8 dB")).toBeVisible();
  expect(screen.getByText("+2,4 dB")).toBeVisible();
  await user.click(within(header).getByRole("button"));
  await waitFor(() =>
    expect(calls.filter((c) => c.method === "library.list").at(-1)?.params).toMatchObject({
      sort: "replaygain",
    }),
  );
});

test("without the column switched on the table has no gain", async () => {
  useViewStore.setState({ view: "library" });
  renderWithQuery(<App />);
  await screen.findByText("Midnight Bloom");
  expect(screen.queryByRole("columnheader", { name: /Ganancia/ })).toBeNull();
});

test("Tags writes the gain only when asked, and the preview names the fields", async () => {
  useViewStore.setState({ view: "library" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByText("Midnight Bloom"));
  await user.click(screen.getByRole("button", { name: "Tags" }));
  const toggle = await screen.findByRole("switch", { name: "Ganancia (ReplayGain)" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  const previews = () =>
    calls.filter((c) => c.method === "tags.preview").map((c) => c.params as TagPreviewParams);
  await waitFor(() => expect(previews().at(-1)?.options?.writeReplaygain).toBe(false));
  await user.click(toggle);
  expect(screen.getByText(/el audio no cambia/)).toBeVisible();
  await waitFor(() => expect(previews().at(-1)?.options?.writeReplaygain).toBe(true));
  expect(await screen.findByText("-9.82 dB")).toBeVisible();
  expect(screen.getByText("Ganancia")).toBeVisible();
  expect(screen.getByText("Pico")).toBeVisible();
});

test("the detail shows the gain with its true peak", async () => {
  engine.details.set(1, { truePeakDb: 0.4, peakDb: -0.3, loudnessLufs: -8.18 });
  useViewStore.setState({ view: "detail", trackId: 1, back: "library" });
  renderWithQuery(<App />);
  const chip = await screen.findByText("Ganancia −9,8 dB");
  expect(chip.closest("[title]")).toHaveAttribute(
    "title",
    expect.stringMatching(/^Pico real 0,4 dBTP/),
  );
});

test("Traktor gets the gain only when the box is ticked", async () => {
  useViewStore.setState({ view: "export" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(await screen.findByRole("tab", { name: "Traktor" }));
  const card = await screen.findByRole("region", { name: "Traktor" });
  const box = within(card).getByRole("checkbox", { name: "Ganancia" });
  expect(box).not.toBeChecked();
  await user.click(box);
  expect(within(card).getByText(/Sustituye la ganancia que calcula Traktor/)).toBeVisible();
  await user.click(within(card).getByRole("button", { name: "Simular" }));
  await waitFor(() =>
    expect(calls.at(-1)).toMatchObject({ method: "export.traktor", params: { gain: true } }),
  );
});
