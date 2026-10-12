// Settings › Analysis (SPEC 2.14): BPM range, parallel processes and cue palette.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { bpmRangeError, DEFAULT_CUE_COLORS } from "./analysisLimits";

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

beforeEach(async () => {
  resetEngine();
  useViewStore.setState({ view: "library" });
  engine.tracks = [track(1, { title: "Midnight Bloom" })];
  document.documentElement.style.removeProperty("--color-cue-1");
  await i18n.changeLanguage("es");
});

async function openAnalysisSettings() {
  renderWithQuery(<App />);
  await screen.findByText("Midnight Bloom");
  act(() => useViewStore.getState().show("settings"));
  await userEvent.click(await screen.findByRole("button", { name: "Análisis" }));
}

describe("bpmRangeError", () => {
  it("mirrors the engine's limits", () => {
    expect(bpmRangeError(70, 180)).toBeNull();
    expect(bpmRangeError(180, 70)).toBe("range");
    expect(bpmRangeError(30, 180)).toBe("range");
    expect(bpmRangeError(70, 300)).toBe("range");
    expect(bpmRangeError(120, 130)).toBe("span");
    expect(bpmRangeError(Number.NaN, 130)).toBe("range");
  });
});

describe("analysis settings", () => {
  it("saves a valid BPM range and explains an invalid one", async () => {
    await openAnalysisSettings();
    const min = screen.getByRole("spinbutton", { name: "BPM mínimo" });
    await userEvent.clear(min);
    await userEvent.type(min, "85");
    await userEvent.tab();
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "settings.set", params: { bpmRange: [85, 180] } }),
    );

    calls.length = 0;
    const max = screen.getByRole("spinbutton", { name: "BPM máximo" });
    await userEvent.clear(max);
    await userEvent.type(max, "95");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Deja al menos 20 BPM");
    expect(max).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.method === "settings.set")).toBe(false);
  });

  it("chooses the number of parallel processes", async () => {
    await openAnalysisSettings();
    const select = screen.getByRole("combobox", { name: /Procesos en paralelo/ });
    expect(select).toHaveDisplayValue(/^Automático/);
    await userEvent.selectOptions(select, "2");
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "settings.set", params: { analysisWorkers: 2 } }),
    );
  });

  it("edits the cue palette, repaints the cue tokens and resets", async () => {
    await openAnalysisSettings();
    fireEvent.input(screen.getByLabelText("Color de Intro"), { target: { value: "#112233" } });
    const palette = ["#112233", ...DEFAULT_CUE_COLORS.slice(1)];
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "settings.set", params: { cueColors: palette } }),
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-cue-1")).toBe("#112233"),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Restablecer colores" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "settings.set",
        params: { cueColors: [...DEFAULT_CUE_COLORS] },
      }),
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-cue-1")).toBe(""),
    );
  });
});
