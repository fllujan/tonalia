import { create } from "zustand";
import type { AnalysisSummary, AnalysisTrackDone, ProgressParams } from "../../lib/rpc.types";

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

/**
 * Seconds left in a job that is `percent` % done after `elapsedMs`, assuming the pace so
 * far holds; null while there is too little to go on (the first seconds, or under 1 %).
 */
export function remainingSeconds(percent: number, elapsedMs: number): number | null {
  if (percent < 1 || percent >= 100 || elapsedMs < 3000) return null;
  return ((elapsedMs / 1000) * (100 - percent)) / percent;
}

interface AnalysisState {
  jobId: string | null;
  /** When the job started (ms since the epoch), for the time left. */
  startedAt: number;
  done: number;
  total: number;
  percent: number;
  /** Current stage of each track being analysed (DESIGN 5.6: ring with %). */
  stages: Record<number, AnalysisStage>;
  /** The last tracks that finished (newest first, at most RECENT_MAX), so they leave
   * a trace when they drop out of the Analyse list. Survives the end of the job. */
  recent: AnalysisTrackDone[];
  /** What the last finished run did, kept as a line in the Analyse view (the toast goes
   * away) until the next run starts or the user closes it. */
  last: AnalysisSummary | null;
  trackDone: (done: AnalysisTrackDone) => void;
  start: (jobId: string) => void;
  progress: (p: ProgressParams) => void;
  finish: (jobId: string, summary?: AnalysisSummary) => void;
  dismissLast: () => void;
}

const IDLE = { jobId: null, startedAt: 0, done: 0, total: 0, percent: 0, stages: {} };

export const RECENT_MAX = 5;

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  ...IDLE,
  recent: [],
  last: null,
  trackDone: (done) =>
    set({
      recent: [done, ...get().recent.filter((r) => r.trackId !== done.trackId)].slice(
        0,
        RECENT_MAX,
      ),
    }),
  start: (jobId) => {
    if (get().jobId !== jobId) set({ ...IDLE, jobId, startedAt: Date.now(), last: null });
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
  finish: (jobId, summary) => {
    if (jobId === get().jobId) set({ ...IDLE, last: summary ?? null });
  },
  dismissLast: () => set({ last: null }),
}));
