import { create } from "zustand";
import type { ProgressParams } from "../../lib/rpc.types";

interface AnalysisState {
  jobId: string | null;
  done: number;
  total: number;
  percent: number;
  start: (jobId: string) => void;
  progress: (p: ProgressParams) => void;
  finish: (jobId: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  jobId: null,
  done: 0,
  total: 0,
  percent: 0,
  start: (jobId) => {
    if (get().jobId !== jobId) set({ jobId, done: 0, total: 0, percent: 0 });
  },
  progress: (p) => {
    if (p.jobId !== get().jobId) return;
    set({ done: p.done ?? 0, total: p.total ?? 0, percent: p.percent });
  },
  finish: (jobId) => {
    if (jobId === get().jobId) set({ jobId: null, done: 0, total: 0, percent: 0 });
  },
}));
