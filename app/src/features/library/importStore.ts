import { create } from "zustand";
import type { ProgressParams } from "../../lib/rpc.types";

interface ImportState {
  jobId: string | null;
  stage: string | null;
  done: number;
  total: number;
  percent: number;
  start: (jobId: string) => void;
  progress: (p: ProgressParams) => void;
  finish: (jobId: string) => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  jobId: null,
  stage: null,
  done: 0,
  total: 0,
  percent: 0,
  start: (jobId) => set({ jobId, stage: "scanning", done: 0, total: 0, percent: 0 }),
  progress: (p) => {
    if (p.jobId !== get().jobId) return;
    set({ stage: p.stage, done: p.done ?? 0, total: p.total ?? 0, percent: p.percent });
  },
  finish: (jobId) => {
    if (jobId === get().jobId) set({ jobId: null, stage: null, done: 0, total: 0, percent: 0 });
  },
}));
