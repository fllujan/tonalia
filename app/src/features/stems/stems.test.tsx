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
import type { GpuRuntimeStatus } from "../../lib/rpc.types";

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
    dialogOpen: false,
    download: null,
    gpuDownload: null,
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

function installModel(model: "htdemucs_ft" | "htdemucs" = "htdemucs") {
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
    // "Rápido" first and by default (SPEC 11.1).
    expect(
      within(model)
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.querySelector("span")?.textContent),
    ).toEqual(["Rápido", "Calidad máxima"]);
    expect(within(model).getByRole("radio", { name: /Rápido/ })).toBeChecked();
    expect(model).toHaveTextContent("337 MB");
    // Nothing measured yet: no made-up times.
    expect(model).not.toHaveTextContent("≈");
    await userEvent.click(within(model).getByRole("radio", { name: /Calidad máxima/ }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemModel: "htdemucs_ft" } });
    const accel = screen.getByRole("group", { name: "Aceleración" });
    expect(accel).toHaveTextContent("Apple Silicon (MPS)");
    await userEvent.click(within(accel).getByRole("radio", { name: /Solo CPU/ }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemDevice: "cpu" } });
  });

  it("downloads the model with progress", async () => {
    await openSettingsStems();
    await userEvent.click(screen.getByRole("button", { name: "Descargar modelo (84,1 MB)" }));
    expect(calls).toContainEqual({
      method: "stems.downloadModel",
      params: { model: "htdemucs" },
    });
    progress("job-1", "download", 42);
    expect(screen.getByRole("progressbar", { name: "Descargando el modelo" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    installModel();
    finish("job-1", "stems.download", { model: "htdemucs", downloadedBytes: 1 });
    expect(await screen.findByText("Descargado")).toBeInTheDocument();
  });

  it("says how long each model takes on this computer", async () => {
    engine.stems.models = engine.stems.models.map((m) =>
      m.model === "htdemucs"
        ? { ...m, secondsPerMinute: 9.5, estimateMeasured: true }
        : { ...m, secondsPerMinute: 36.6, estimateMeasured: false },
    );
    await openSettingsStems();
    const cards = screen.getByRole("group", { name: "Modelo" });
    expect(cards).toHaveTextContent("≈ 40 s por tema de 4 min en este equipo");
    expect(cards).toHaveTextContent("≈ 2½ min por tema de 4 min (estimado)");
  });

  describe("GPU acceleration on Windows (SPEC 11.2)", () => {
    const gpu = (over: Partial<GpuRuntimeStatus> = {}): GpuRuntimeStatus => ({
      gpu: { name: "NVIDIA GeForce RTX 3060", driver: "566.36" },
      state: "not_installed",
      totalBytes: 2_596_413_186,
      downloadedBytes: 0,
      installedBytes: 0,
      minDriver: "560.76",
      restartRequired: false,
      detail: null,
      ...over,
    });

    it("is not offered without an NVIDIA GPU", async () => {
      await openSettingsStems();
      expect(screen.queryByRole("region", { name: "Aceleración GPU de NVIDIA" })).toBeNull();
    });

    it("downloads, installs and checks it with progress, and can cancel", async () => {
      engine.stems.gpuRuntime = gpu();
      engine.stems.accelerator = null;
      await openSettingsStems();
      const box = screen.getByRole("region", { name: "Aceleración GPU de NVIDIA" });
      expect(box).toHaveTextContent("Tu NVIDIA GeForce RTX 3060 puede separar");
      expect(
        screen.getByText("Usará la CPU hasta que descargues la aceleración GPU"),
      ).toBeInTheDocument();
      await userEvent.click(
        within(box).getByRole("button", { name: "Descargar aceleración GPU (≈ 2,6 GB)" }),
      );
      expect(calls).toContainEqual({ method: "stems.downloadGpu", params: null });
      progress("job-1", "download", 30);
      expect(
        within(box).getByRole("progressbar", { name: "Descargando la aceleración GPU" }),
      ).toHaveAttribute("aria-valuenow", "30");
      expect(box).toHaveTextContent("continuará donde se quedó");
      await userEvent.click(within(box).getByRole("button", { name: "Cancelar" }));
      expect(calls).toContainEqual({ method: "job.cancel", params: { jobId: "job-1" } });
      progress("job-1", "install", 94);
      expect(
        within(box).getByRole("progressbar", { name: "Instalando la aceleración GPU" }),
      ).toBeInTheDocument();
      engine.stems.gpuRuntime = gpu({ state: "active", installedBytes: 3_400_000_000 });
      finish("job-1", "stems.downloadGpu", engine.stems.gpuRuntime);
      expect(await screen.findByText("Aceleración GPU lista")).toBeInTheDocument();
      expect(
        await within(box).findByText("Activa en tu NVIDIA GeForce RTX 3060"),
      ).toBeInTheDocument();
      await userEvent.click(within(box).getByRole("button", { name: "Desinstalar (3,4 GB)" }));
      expect(calls).toContainEqual({ method: "stems.removeGpu", params: null });
      expect(
        await within(box).findByRole("button", { name: "Descargar aceleración GPU (≈ 2,6 GB)" }),
      ).toBeInTheDocument();
    });

    it("resumes a partial download", async () => {
      engine.stems.gpuRuntime = gpu({ downloadedBytes: 1_596_413_186 });
      await openSettingsStems();
      expect(
        screen.getByRole("button", { name: "Continuar la descarga (faltan 1 GB)" }),
      ).toBeInTheDocument();
    });

    it("says when it needs a restart, a newer driver, or did not work", async () => {
      engine.stems.gpuRuntime = gpu({
        state: "installed",
        restartRequired: true,
        installedBytes: 1,
      });
      await openSettingsStems();
      const box = screen.getByRole("region", { name: "Aceleración GPU de NVIDIA" });
      expect(box).toHaveTextContent("Se usará la próxima vez que abras Tonalia");
    });

    it("asks for a newer driver", async () => {
      engine.stems.gpuRuntime = gpu({
        state: "driver_too_old",
        gpu: { name: "RTX", driver: "531.18" },
      });
      await openSettingsStems();
      expect(screen.getByRole("region", { name: "Aceleración GPU de NVIDIA" })).toHaveTextContent(
        "tienes la versión 531.18 y hace falta la 560.76 o posterior",
      );
      expect(screen.queryByRole("button", { name: /Descargar aceleración/ })).toBeNull();
    });

    it("falls back to the CPU when the check fails", async () => {
      engine.stems.gpuRuntime = gpu({
        state: "failed",
        detail: "CUDA is not available to PyTorch",
        installedBytes: 3_400_000_000,
      });
      await openSettingsStems();
      const box = screen.getByRole("region", { name: "Aceleración GPU de NVIDIA" });
      expect(box).toHaveTextContent("No ha funcionado en este equipo: se usa la CPU.");
      expect(box).toHaveTextContent("CUDA is not available to PyTorch");
      expect(within(box).getByRole("button", { name: "Volver a intentarlo" })).toBeInTheDocument();
      expect(within(box).getByRole("button", { name: "Desinstalar (3,4 GB)" })).toBeInTheDocument();
    });
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
    expect(dialog).toHaveTextContent("«Rápido» (84,1 MB)");
    expect(dialog).toHaveTextContent("Solo se descarga una vez");
    await userEvent.click(within(dialog).getByRole("button", { name: "Descargar" }));
    expect(calls).toContainEqual({
      method: "stems.downloadModel",
      params: { model: "htdemucs" },
    });
    progress("job-1", "download", 50);
    expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    // The model cannot change while it downloads.
    expect(within(dialog).getByRole("radio", { name: /Calidad máxima/ })).toBeDisabled();

    installModel();
    finish("job-1", "stems.download", { model: "htdemucs", downloadedBytes: 1 });
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

  it("offers «Calidad máxima» in the separation dialog", async () => {
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    const dialog = await screen.findByRole("dialog", { name: "Descargar el modelo de stems" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Calidad máxima/ }));
    expect(calls).toContainEqual({ method: "settings.set", params: { stemModel: "htdemucs_ft" } });
    await waitFor(() => expect(dialog).toHaveTextContent("«Calidad máxima» (337 MB)"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Descargar" }));
    expect(calls).toContainEqual({
      method: "stems.downloadModel",
      params: { model: "htdemucs_ft" },
    });
  });

  it("says how long separating this track will take", async () => {
    installModel();
    engine.stems.models = engine.stems.models.map((m) =>
      m.model === "htdemucs" ? { ...m, secondsPerMinute: 9.5, estimateMeasured: true } : m,
    );
    await openDetail();
    // Track 1 lasts 6:12: 6,2 min × 9,5 s.
    expect(screen.getByRole("region", { name: "Stems" })).toHaveTextContent(
      "Rápido · ≈ 1 min en este equipo",
    );
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

  it("says when the GPU failed and the CPU took over", async () => {
    installModel();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Separar stems" }));
    finish("job-1", "stems.separate", {
      model: "htdemucs",
      device: "cpu",
      separated: [1],
      cached: [],
      failed: [],
      gpuFallback: "CUDA out of memory",
    });
    expect(
      await screen.findByText("La GPU ha fallado: los stems se han separado con la CPU"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stems listos para 1 tema")).toBeInTheDocument();
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
  await userEvent.click(await screen.findByRole("button", { name: "Más acciones" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Preparar stems" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "Más acciones" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Exportar stems…" }));
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
