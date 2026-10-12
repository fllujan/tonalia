// Stem jobs (SPEC 2.16): the model download and one separation batch at a time. A
// separation asked for before the model exists waits here until the download finishes.
import { create } from "zustand";
import type { ProgressParams, Settings } from "../../lib/rpc.types";

export type StemModel = NonNullable<Settings["stemModel"]>;
export type StemDevice = NonNullable<Settings["stemDevice"]>;

interface StemsState {
  download: { jobId: string; model: StemModel; percent: number } | null;
  separation: { jobId: string; trackIds: number[]; percent: number; trackId: number | null } | null;
  /** Tracks to separate as soon as the model download finishes. */
  pendingSeparation: number[] | null;
  /** Model download dialog (DESIGN 6.15) open. */
  dialogOpen: boolean;
  startDownload: (jobId: string, model: StemModel) => void;
  startSeparation: (jobId: string, trackIds: number[]) => void;
  progress: (p: ProgressParams) => void;
  openDialog: (pending: number[] | null) => void;
  closeDialog: () => void;
}

export const useStemsStore = create<StemsState>((set, get) => ({
  download: null,
  separation: null,
  pendingSeparation: null,
  dialogOpen: false,
  startDownload: (jobId, model) => set({ download: { jobId, model, percent: 0 } }),
  startSeparation: (jobId, trackIds) =>
    set({ separation: { jobId, trackIds, percent: 0, trackId: null } }),
  progress: (p) => {
    const { download, separation } = get();
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
}));
