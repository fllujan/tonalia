// Stem jobs (SPEC 2.16): the model download and one separation batch at a time. A
// separation asked for before the model exists waits here until the download finishes.
import { create } from "zustand";
import type { ProgressParams, Settings } from "../../lib/rpc.types";

export type StemModel = NonNullable<Settings["stemModel"]>;
export type StemDevice = NonNullable<Settings["stemDevice"]>;

interface StemsState {
  download: { jobId: string; model: StemModel; percent: number } | null;
  /** Optional CUDA runtime download on Windows (SPEC 11.2): download → install → check. */
  gpuDownload: { jobId: string; percent: number; stage: string } | null;
  separation: { jobId: string; trackIds: number[]; percent: number; trackId: number | null } | null;
  /** Tracks to separate as soon as the model download finishes. */
  pendingSeparation: number[] | null;
  /** Model download dialog (DESIGN 6.15) open. */
  dialogOpen: boolean;
  /** Tracks of the open "Export stems" dialog, and the running export job. */
  exportTracks: number[] | null;
  exportJob: { jobId: string; percent: number } | null;
  startDownload: (jobId: string, model: StemModel) => void;
  startSeparation: (jobId: string, trackIds: number[]) => void;
  progress: (p: ProgressParams) => void;
  openDialog: (pending: number[] | null) => void;
  closeDialog: () => void;
  openExport: (trackIds: number[]) => void;
  closeExport: () => void;
}

export const useStemsStore = create<StemsState>((set, get) => ({
  download: null,
  gpuDownload: null,
  separation: null,
  pendingSeparation: null,
  dialogOpen: false,
  exportTracks: null,
  exportJob: null,
  startDownload: (jobId, model) => set({ download: { jobId, model, percent: 0 } }),
  startSeparation: (jobId, trackIds) =>
    set({ separation: { jobId, trackIds, percent: 0, trackId: null } }),
  progress: (p) => {
    const { download, gpuDownload, separation, exportJob } = get();
    if (gpuDownload?.jobId === p.jobId) {
      set({ gpuDownload: { ...gpuDownload, percent: p.percent, stage: p.stage } });
      return;
    }
    if (p.stage === "export" && exportJob?.jobId === p.jobId) {
      set({ exportJob: { ...exportJob, percent: p.percent } });
      return;
    }
    if (p.stage === "download" && download?.jobId === p.jobId) {
      set({ download: { ...download, percent: p.percent } });
    } else if (p.stage === "stems" && separation?.jobId === p.jobId) {
      set({
        separation: { ...separation, percent: p.percent, trackId: p.trackId ?? separation.trackId },
      });
    }
  },
  openDialog: (pending) => set({ dialogOpen: true, pendingSeparation: pending }),
  closeDialog: () => set({ dialogOpen: false, pendingSeparation: null }),
  openExport: (trackIds) => set({ exportTracks: trackIds }),
  closeExport: () => set({ exportTracks: null }),
}));
