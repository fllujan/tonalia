import { create } from "zustand";
import type { ProgressParams } from "../../lib/rpc.types";

export type TagJobKind = "write" | "undo";

interface TagJobState {
  jobId: string | null;
  kind: TagJobKind | null;
  done: number;
  total: number;
  percent: number;
  start: (jobId: string, kind: TagJobKind) => void;
  progress: (p: ProgressParams) => void;
  finish: (jobId: string) => void;
}

export const useTagJobStore = create<TagJobState>((set, get) => ({
  jobId: null,
  kind: null,
  done: 0,
  total: 0,
  percent: 0,
  start: (jobId, kind) => set({ jobId, kind, done: 0, total: 0, percent: 0 }),
  progress: (p) => {
    if (p.jobId !== get().jobId) return;
    set({ done: p.done ?? 0, total: p.total ?? 0, percent: p.percent });
  },
  finish: (jobId) => {
    if (jobId === get().jobId) set({ jobId: null, kind: null, done: 0, total: 0, percent: 0 });
  },
}));
