// render.preview as a promise: a cache hit answers at once, otherwise the engine renders
// in a job and `job.finished` (routed here by useLibraryEvents) carries the result.
import { request } from "../../lib/rpc";
import type { JobFinished, RenderResult, RenderSpec } from "../../lib/rpc.types";

interface Waiter {
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
}

const waiting = new Map<string, Waiter>();
// A job can finish before its id comes back to us; keep the last few results.
const early = new Map<string, JobFinished>();
const EARLY_KEEP = 32;

function settle(job: JobFinished, waiter: Waiter) {
  if (job.status === "done" && job.result) waiter.resolve(job.result as unknown as RenderResult);
  else waiter.reject(new Error(job.error ?? job.status));
}

export function finishRender(job: JobFinished): void {
  const waiter = waiting.get(job.jobId);
  if (waiter) {
    waiting.delete(job.jobId);
    settle(job, waiter);
    return;
  }
  early.set(job.jobId, job);
  while (early.size > EARLY_KEEP) early.delete(early.keys().next().value as string);
}

export async function renderPreview(spec: RenderSpec): Promise<RenderResult> {
  const reply = await request("render.preview", spec);
  if (reply.result) return reply.result;
  const jobId = reply.jobId;
  if (!jobId) throw new Error("render.preview returned neither a result nor a job");
  return new Promise<RenderResult>((resolve, reject) => {
    const waiter = { resolve, reject };
    const done = early.get(jobId);
    if (done) {
      early.delete(jobId);
      settle(done, waiter);
    } else waiting.set(jobId, waiter);
  });
}
