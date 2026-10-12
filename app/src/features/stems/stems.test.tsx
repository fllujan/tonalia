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
  revealed,
  stemSet,
  track,
} from "../../test/fakeEngine";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
  useStemsStore.setState({
    download: null,
    separation: null,
    pendingSeparation: null,
    exportTracks: null,
    exportJob: null,
  });
  vi.mocked(openDialog).mockReset();
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

describe("export", () => {
  async function openExport() {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    act(() => useViewStore.getState().openDetail(1));
    await userEvent.click(await screen.findByRole("button", { name: "Exportar…" }));
    return screen.findByRole("dialog", { name: "Exportar stems" });
  }

  it("exports processed stems to a chosen folder and shows the result", async () => {
    engine.stems.sets.set(1, stemSet(1));
    vi.mocked(openDialog).mockResolvedValue("/Users/dj/Música/Proyecto ñ");
    const dialog = await openExport();
    const what = within(dialog).getByRole("group", { name: "Qué exportar" });
    await userEvent.click(within(what).getByRole("checkbox", { name: "Tema completo" }));
    await userEvent.click(within(what).getByRole("checkbox", { name: "Voz" }));
    await userEvent.click(within(what).getByRole("checkbox", { name: "Instrumental" }));
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Con cambio de tono y tempo" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Subir un semitono" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Subir un semitono" }));
    expect(within(dialog).getByText("+2 st")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "BPM" }), "126");
    await userEvent.click(within(dialog).getByRole("radio", { name: "FLAC" }));
    expect(within(dialog).getByRole("button", { name: "Exportar 2 archivos" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Elegir carpeta…" }));
    const names = await within(dialog).findByRole("list", { name: "Nombres de archivo" });
    expect(
      within(names)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Midnight Bloom (Voz).flac", "Midnight Bloom (Instrumental).flac"]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Exportar 2 archivos" }));
    const items = [
      { trackId: 1, source: "vocals", semitones: 2, targetBpm: 126 },
      { trackId: 1, source: "instrumental", semitones: 2, targetBpm: 126 },
    ];
    expect(calls).toContainEqual({
      method: "stems.export",
      params: expect.objectContaining({
        items,
        format: "flac",
        destination: "/Users/dj/Música/Proyecto ñ",
        stemLabels: expect.objectContaining({ vocals: "Voz", mix: "Tema completo" }),
      }),
    });
    progress("job-1", "export", 50, 1);
    expect(within(dialog).getByRole("progressbar", { name: "Exportando" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    const file = "/Users/dj/Música/Proyecto ñ/Midnight Bloom (Voz).flac";
    finish("job-1", "stems.export", {
      folder: "/Users/dj/Música/Proyecto ñ",
      files: [{ trackId: 1, source: "vocals", path: file }],
      failed: [{ trackId: 1, source: "instrumental", error: "disk full" }],
    });
    expect(await screen.findByText("1 archivo exportado")).toBeInTheDocument();
    expect(screen.getByText("No se pudo exportar 1 archivo")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(revealed).toEqual([file]);
  });

  it("offers only the full track until the stems exist, into the DAW folder", async () => {
    engine.settings.dawFolder = "/Users/dj/Ableton";
    const dialog = await openExport();
    const what = within(dialog).getByRole("group", { name: "Qué exportar" });
    expect(within(what).getByRole("checkbox", { name: "Voz" })).toBeDisabled();
    expect(within(what).getByRole("checkbox", { name: "Tema completo" })).toBeChecked();
    expect(dialog).toHaveTextContent("Separa las stems de 1 tema para exportarlas.");
    expect(dialog).toHaveTextContent("/Users/dj/Ableton");
    expect(
      await within(dialog).findByText("Midnight Bloom (Tema completo).wav"),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Exportar 1 archivo" }));
    expect(calls).toContainEqual({
      method: "stems.export",
      params: expect.objectContaining({
        items: [{ trackId: 1, source: "mix", semitones: 0, targetBpm: null }],
        destination: "/Users/dj/Ableton",
        format: "wav",
      }),
    });
  });

  it("is also offered for the library selection", async () => {
    renderWithQuery(<App />);
    await screen.findByText("2 temas");
    act(() => useLibraryStore.getState().setSelected([1, 2]));
    await userEvent.click(await screen.findByRole("button", { name: "Exportar…" }));
    const dialog = await screen.findByRole("dialog", { name: "Exportar stems" });
    expect(dialog).toHaveTextContent("Separa las stems de 2 temas para exportarlas.");
  });

  it("sets the DAW folder, format and name template in Settings", async () => {
    vi.mocked(openDialog).mockResolvedValue("/Users/dj/Proyectos DAW");
    await openSettingsStems();
    const group = screen.getByRole("group", { name: "Exportación" });
    expect(group).toHaveTextContent("Sin configurar");
    await userEvent.click(within(group).getByRole("button", { name: "Elegir carpeta…" }));
    expect(calls).toContainEqual({
      method: "settings.set",
      params: { dawFolder: "/Users/dj/Proyectos DAW" },
    });
    expect(await within(group).findByText("/Users/dj/Proyectos DAW")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("radio", { name: "AIFF" }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemExportFormat: "aiff" } });
    const template = within(group).getByRole("textbox", { name: "Nombre de archivo" });
    await userEvent.clear(template);
    await userEvent.type(template, "{{title} - {{stem}{Enter}");
    expect(calls).toContainEqual({
      method: "settings.set",
      params: { stemExportTemplate: "{title} - {stem}" },
    });
    await userEvent.click(within(group).getByRole("button", { name: "Quitar" }));
    expect(calls).toContainEqual({ method: "settings.set", params: { dawFolder: "" } });
  });
});
