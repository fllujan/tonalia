import { create } from "zustand";
import type { ProgressParams } from "../../lib/rpc.types";

/** The engine's per-track analysis stages, in order (analysis/pipeline.py). */
export const ANALYSIS_STAGES = [
  "decoding",
  "key",
  "tempo",
  "energy",
  "structure",
  "quality",
  "waveform",
] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

const isStage = (stage: string): stage is AnalysisStage =>
  (ANALYSIS_STAGES as readonly string[]).includes(stage);

/** How far along one track is (0–1) once it has entered `stage`. */
export function stageProgress(stage: AnalysisStage): number {
  return ANALYSIS_STAGES.indexOf(stage) / ANALYSIS_STAGES.length;
}

interface AnalysisState {
  jobId: string | null;
  done: number;
  total: number;
  percent: number;
  /** Current stage of each track being analysed (DESIGN 5.6: ring with %). */
  stages: Record<number, AnalysisStage>;
  start: (jobId: string) => void;
  progress: (p: ProgressParams) => void;
  finish: (jobId: string) => void;
}

const IDLE = { jobId: null, done: 0, total: 0, percent: 0, stages: {} };

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  ...IDLE,
  start: (jobId) => {
    if (get().jobId !== jobId) set({ ...IDLE, jobId });
  },
  progress: (p) => {
    if (p.jobId !== get().jobId) return;
    let stages = get().stages;
    const id = p.trackId;
    if (id != null) {
      stages = Object.fromEntries(
        Object.entries(stages).filter(([key]) => Number(key) !== id),
      ) as Record<number, AnalysisStage>;
      if (isStage(p.stage)) stages[id] = p.stage;
    }
    set({ done: p.done ?? 0, total: p.total ?? 0, percent: p.percent, stages });
  },
  finish: (jobId) => {
    if (jobId === get().jobId) set(IDLE);
  },
}));
