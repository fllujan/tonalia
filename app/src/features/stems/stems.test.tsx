// Stems (SPEC 2.16, DESIGN 6.13 and 6.15): settings, model download, separation, cache.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import i18n from "../../i18n";
import {
  calls,
  emit,
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
import { useStemsStore } from "./stemsStore";

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
  engine.tracks = [
    track(1, { title: "Midnight Bloom", status: "ready", keyRoot: 9, keyMode: "minor" }),
    track(2, { title: "Golden Hour Tide", status: "ready" }),
  ];
  useLibraryStore.setState({ search: "", filter: {}, selected: [], sort: "title" });
  useViewStore.setState({ view: "library" });
  useStemsStore.setState({ download: null, separation: null, pendingSeparation: null });
  await i18n.changeLanguage("es");
});

const finish = (jobId: string, kind: string, result: unknown, status = "done") =>
  act(() =>
    emit("engine://event", {
      type: "job.finished",
      payload: { jobId, kind, status, result, error: status === "failed" ? "boom" : null },
    }),
  );
const progress = (jobId: string, stage: string, percent: number, trackId?: number) =>
  act(() => emit("engine://progress", { jobId, stage, percent, trackId: trackId ?? null }));

function installModel(model: "htdemucs_ft" | "htdemucs" = "htdemucs_ft") {
  engine.stems.models = engine.stems.models.map((m) =>
    m.model === model ? { ...m, installed: true, missingBytes: 0 } : m,
  );
}

async function openSettingsStems() {
  renderWithQuery(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
  await userEvent.click(screen.getByRole("button", { name: "Stems" }));
}

describe("settings", () => {
  it("chooses model and acceleration, shows sizes and the detected accelerator", async () => {
    await openSettingsStems();
    const model = screen.getByRole("group", { name: "Modelo" });
    expect(within(model).getByRole("radio", { name: /Calidad máxima/ })).toBeChecked();
    expect(model).toHaveTextContent("337 MB");
    await userEvent.click(within(model).getByRole("radio", { name: /Rápido/ }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemModel: "htdemucs" } });
    const accel = screen.getByRole("group", { name: "Aceleración" });
    expect(accel).toHaveTextContent("Apple Silicon (MPS)");
    await userEvent.click(within(accel).getByRole("radio", { name: /Solo CPU/ }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemDevice: "cpu" } });
  });

  it("downloads the model with progress", async () => {
    await openSettingsStems();
    await userEvent.click(screen.getByRole("button", { name: "Descargar modelo (337 MB)" }));
    expect(calls).toContainEqual({
      method: "stems.downloadModel",
      params: { model: "htdemucs_ft" },
    });
    progress("job-1", "download", 42);
    expect(screen.getByRole("progressbar", { name: "Descargando el modelo" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    installModel();
    finish("job-1", "stems.download", { model: "htdemucs_ft", downloadedBytes: 1 });
    expect(await screen.findByText("Descargado")).toBeInTheDocument();
  });

  it("shows the cache size and empties it", async () => {
    engine.stems.cache = { bytes: 1_250_000_000, tracks: 4 };
    await openSettingsStems();
    expect(screen.getByText(/1,3 GB · 4 temas/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vaciar" }));
    expect(calls).toContainEqual({ method: "stems.clearCache", params: null });
    expect(await screen.findByText(/0 B · 0 temas/)).toBeInTheDocument();
  });
});

describe("track detail", () => {
  async function openDetail() {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    useViewStore.getState().openDetail(1);
    return screen.findByRole("heading", { name: "Stems" });
  }

  it("downloads the model first, then separates with progress and lists the stems", async () => {
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    const dialog = await screen.findByRole("dialog", { name: "Descargar el modelo de stems" });
    expect(dialog).toHaveTextContent("337 MB");
    expect(dialog).toHaveTextContent("Solo se descarga una vez");
    await userEvent.click(within(dialog).getByRole("button", { name: "Descargar" }));
    expect(calls).toContainEqual({
      method: "stems.downloadModel",
      params: { model: "htdemucs_ft" },
    });
    progress("job-1", "download", 50);
    expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    installModel();
    finish("job-1", "stems.download", { model: "htdemucs_ft", downloadedBytes: 1 });
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "stems.separate", params: { trackIds: [1] } }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    progress("job-2", "stems", 42, 1);
    expect(await screen.findByText("Separando… 42 %")).toBeInTheDocument();

    engine.stems.sets.set(1, stemSet(1));
    finish("job-2", "stems.separate", {
      model: "htdemucs_ft",
      device: "mps",
      separated: [1],
      cached: [],
      failed: [],
    });
    const list = await screen.findByRole("list", { name: "Stems" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Voz", "Batería", "Bajo", "Otros", "Instrumental"]);
    expect(within(list).getByRole("button", { name: "Escuchar Voz" })).toBeInTheDocument();
  });

  it("separates directly when the model is there, and can cancel", async () => {
    installModel();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toContainEqual({ method: "stems.separate", params: { trackIds: [1] } });
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(calls).toContainEqual({ method: "job.cancel", params: { jobId: "job-1" } });
    finish("job-1", "stems.separate", null, "cancelled");
    expect(await screen.findByRole("button", { name: "Separar stems" })).toBeInTheDocument();
  });

  it("reports a failed separation", async () => {
    installModel();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    finish("job-1", "stems.separate", {
      model: "htdemucs_ft",
      device: "cpu",
      separated: [],
      cached: [],
      failed: [{ trackId: 1, error: "cannot decode" }],
    });
    expect(await screen.findByText("No se pudo separar 1 tema")).toBeInTheDocument();
  });

  it("shows the vocal presence, estimated first and measured after separating", async () => {
    installModel();
    engine.details.set(1, { vocalPresence: 0.18, vocalSource: "estimate" });
    await openDetail();
    const panel = screen.getByRole("region", { name: "Stems" });
    expect(panel).toHaveTextContent(/Presencia de voz: 18\s%\s· estimada/);
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    engine.stems.sets.set(1, stemSet(1));
    engine.details.set(1, { vocalPresence: 0.42, vocalSource: "stems" });
    finish("job-1", "stems.separate", {
      model: "htdemucs_ft",
      device: "mps",
      separated: [1],
      cached: [],
      failed: [],
    });
    await waitFor(() =>
      expect(panel).toHaveTextContent(/Presencia de voz: 42\s%\s· medida en las stems/),
    );
  });

  it("shows existing stems right away", async () => {
    engine.stems.sets.set(1, stemSet(1));
    await openDetail();
    expect(await screen.findByRole("list", { name: "Stems" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Separar stems" })).not.toBeInTheDocument();
  });
});

it("prepares stems for the selection from the library", async () => {
  installModel();
  renderWithQuery(<App />);
  await screen.findByText("2 temas");
  act(() => useLibraryStore.getState().setSelected([1, 2]));
  await userEvent.click(await screen.findByRole("button", { name: "Preparar stems" }));
  expect(calls).toContainEqual({ method: "stems.separate", params: { trackIds: [1, 2] } });
  progress("job-1", "stems", 50, 2);
  expect(await screen.findByRole("progressbar", { name: "Separando stems" })).toBeInTheDocument();
  finish("job-1", "stems.separate", {
    model: "htdemucs_ft",
    device: "mps",
    separated: [1],
    cached: [2],
    failed: [],
  });
  expect(await screen.findByText("Stems listos para 2 temas")).toBeInTheDocument();
});
