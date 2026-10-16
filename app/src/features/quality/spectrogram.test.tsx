// Quality spectrogram (SPEC 13.5, DESIGN 6.23): the sentence under the picture, the
// picture in the track detail and from the "Revisar calidad" chips.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TFunction } from "i18next";
import App from "../../App";
import i18n from "../../i18n";
import type { SpectrogramResult } from "../../lib/rpc.types";
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
import { explain } from "./api";

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

const base: SpectrogramResult = {
  trackId: 1, rows: 1, columns: 1, maxHz: 22050, duration: 300, data: "AA==",
  cutoffHz: 16031, likelyKbps: 128, format: "mp3", bitrate: 320, fakeHq: true,
}; // prettier-ignore

beforeEach(async () => {
  resetEngine();
  useLibraryStore.setState({ search: "", filter: {}, selected: [] });
  await i18n.changeLanguage("es");
});

describe("what the cut-off means", () => {
  const t = i18n.t.bind(i18n) as TFunction;
  it("says a high-quality claim is fake, and from what", () => {
    expect(explain(base, t, "es")).toEqual({
      verdict: "fake",
      text: "Corte en 16,0 kHz: este «320 kbps» probablemente viene de un archivo de 128 kbps. Busca otra fuente.",
    });
    expect(explain({ ...base, format: "flac", bitrate: null }, t, "es").text).toContain(
      "este «FLAC»",
    );
  });
  it("warns softly, explains a normal MP3 and clears a good file", () => {
    expect(explain({ ...base, fakeHq: false, cutoffHz: 17000 }, t, "es").verdict).toBe("suspect");
    expect(explain({ ...base, fakeHq: false, bitrate: 128 }, t, "es").text).toBe(
      "Corte en 16,0 kHz: lo normal en un MP3 de unos 128 kbps.",
    );
    expect(explain({ ...base, fakeHq: false, likelyKbps: null, cutoffHz: 20800 }, t, "es")).toEqual(
      {
        verdict: "clean",
        text: "Llega hasta 20,8 kHz: no hay señales de que venga de una copia de menos calidad.",
      },
    );
  });
});

const fakeFlac = () =>
  track(1, {
    status: "ready",
    title: "Midnight Bloom",
    format: "flac",
    bitrate: null,
    qualityFlags: ["fake_hq"],
    keyRoot: 9,
    keyMode: "minor",
    bpm: 124,
    energy: 7,
  });

test("the track detail shows the spectrogram with its cut-off and what it means", async () => {
  engine.tracks = [fakeFlac()];
  useViewStore.setState({ view: "detail", trackId: 1, back: "library" });
  renderWithQuery(<App />);
  const section = await screen.findByRole("region", { name: "Espectrograma" });
  expect(
    await within(section).findByText(/este «FLAC» probablemente viene de un archivo de 128 kbps/),
  ).toBeVisible();
  expect(within(section).getByRole("img", { name: /Espectrograma/ })).toBeInTheDocument();
  expect(within(section).getByTestId("cutoff-line")).toHaveClass("border-warning");
  expect(calls).toContainEqual({ method: "quality.spectrogram", params: { trackId: 1 } });
});

test("in Revisar calidad the cut-off chip opens the spectrogram", async () => {
  engine.tracks = [fakeFlac()];
  useViewStore.setState({ view: "review" });
  const user = userEvent.setup();
  renderWithQuery(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Ver el espectrograma de «Midnight Bloom»" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Espectrograma" });
  await waitFor(() =>
    expect(within(dialog).getByText(/probablemente viene de un archivo de 128 kbps/)).toBeVisible(),
  );
  // Opening it neither selects nor opens the track.
  expect(useLibraryStore.getState().selected).toEqual([]);
  expect(useViewStore.getState().view).toBe("review");
});
