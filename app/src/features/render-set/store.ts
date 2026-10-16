// "Render set…" (SPEC 14.2): what is about to be rendered (the dialog opens when it is
// set), the running job with its progress, and the outcome. A preview of one transition is
// the same job on a small window, played as soon as it is ready.
import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import { request } from "../../lib/rpc";
import type {
  ErrorInfo,
  JobFinished,
  ProgressParams,
  RenderSetParams,
  RenderSetResult,
} from "../../lib/rpc.types";

export interface RenderTarget {
  /** The set's tracks with their key changes (from the builder). */
  items?: { trackId: number; shift: number }[];
  /** Or a playlist, in its order. */
  playlistId?: number;
  name: string;
  /** The tracks' titles, to name the transitions. */
  titles: string[];
  /** The first track's BPM: the default of a fixed tempo. */
  firstBpm?: number | undefined;
}

export type RenderOutcome =
  | { status: "done"; result: RenderSetResult }
  | { status: "cancelled" }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null };

interface Running {
  jobId: string;
  preview: number | null;
  percent: number;
  done: number;
  total: number;
}

interface RenderSetState {
  target: RenderTarget | null;
  running: Running | null;
  outcome: RenderOutcome | null;
  /** The transition being listened to (its index) while it plays. */
  playing: number | null;
  previewError: string | null;
  open: (target: RenderTarget) => void;
  close: () => void;
  start: (jobId: string, preview: number | null) => void;
  progress: (p: ProgressParams) => void;
  finish: (job: JobFinished) => void;
}

// A short job (a cached preview) can finish before its id comes back.
const early = new Map<string, JobFinished>();
let audio: HTMLAudioElement | null = null;

export function stopPreview(): void {
  audio?.pause();
  audio = null;
  useRenderSet.setState({ playing: null });
}

function playPreview(path: string, index: number): void {
  stopPreview();
  try {
    const element = new Audio(convertFileSrc(path));
    audio = element;
    element.onended = () => audio === element && stopPreview();
    useRenderSet.setState({ playing: index });
    void element.play()?.catch(() => stopPreview());
  } catch {
    stopPreview();
  }
}

export const useRenderSet = create<RenderSetState>((set, get) => ({
  target: null,
  running: null,
  outcome: null,
  playing: null,
  previewError: null,
  open: (target) => set({ target, outcome: null, previewError: null }),
  close: () => {
    stopPreview();
    set({ target: null });
  },
  start: (jobId, preview) => {
    set({
      running: { jobId, preview, percent: 0, done: 0, total: 0 },
      ...(preview == null ? { outcome: null } : { previewError: null }),
    });
    const done = early.get(jobId);
    if (done) {
      early.delete(jobId);
      get().finish(done);
    }
  },
  progress: (p) => {
    const running = get().running;
    if (running?.jobId !== p.jobId) return;
    set({
      running: { ...running, percent: p.percent, done: p.done ?? 0, total: p.total ?? 0 },
    });
  },
  finish: (job) => {
    const running = get().running;
    if (running?.jobId !== job.jobId) {
      early.set(job.jobId, job);
      return;
    }
    set({ running: null });
    if (running.preview != null) {
      if (job.status === "done" && job.result)
        playPreview((job.result as unknown as RenderSetResult).path, running.preview);
      else if (job.status === "failed") set({ previewError: job.error ?? "?" });
      return;
    }
    set({
      outcome:
        job.status === "done"
          ? { status: "done", result: job.result as unknown as RenderSetResult }
          : job.status === "cancelled"
            ? { status: "cancelled" }
            : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null },
    });
  },
}));

export async function startRender(params: RenderSetParams, preview: number | null) {
  stopPreview();
  const { jobId } = await request("render.set", params);
  useRenderSet.getState().start(jobId, preview);
}
