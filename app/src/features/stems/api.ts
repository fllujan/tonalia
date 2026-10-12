// Stems RPC (SPEC 2.16): status, per-track stem sets, model download and separation jobs.
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { request } from "../../lib/rpc";
import { revealFile } from "../../lib/reveal";
import type {
  JobFinished,
  StemExportParams,
  StemExportResult,
  StemModelDownloaded,
  StemsSeparateResult,
  StemsStatus,
} from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { isNonEmpty } from "../library/api";
import { detailKey } from "../track-detail/api";
import { type StemModel, useStemsStore } from "./stemsStore";

export const stemsKeys = {
  all: ["stems"] as const,
  status: ["stems", "status"] as const,
  track: (trackId: number) => ["stems", "track", trackId] as const,
};

export function useStemsStatus() {
  return useQuery({ queryKey: stemsKeys.status, queryFn: () => request("stems.status") });
}

export function useTrackStems(trackId: number) {
  return useQuery({
    queryKey: stemsKeys.track(trackId),
    queryFn: async () => (await request("stems.get", { trackId })).stems ?? null,
  });
}

export function useClearStemsCache() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request("stems.clearCache"),
    onSuccess: (cache) => {
      client.setQueryData<StemsStatus>(stemsKeys.status, (s) => (s ? { ...s, cache } : s));
      void client.invalidateQueries({ queryKey: ["stems", "track"] });
    },
  });
}

export async function startModelDownload(model: StemModel): Promise<void> {
  const { jobId } = await request("stems.downloadModel", { model });
  useStemsStore.getState().startDownload(jobId, model);
}

export async function startSeparation(trackIds: number[]): Promise<void> {
  if (!isNonEmpty(trackIds)) return;
  const { jobId } = await request("stems.separate", { trackIds });
  useStemsStore.getState().startSeparation(jobId, trackIds);
}

/** Separate now, or open the download dialog first when the model is missing. */
export function requestSeparation(
  trackIds: number[],
  status: StemsStatus | undefined,
  model: StemModel,
): void {
  const installed = status?.models.find((m) => m.model === model)?.installed ?? false;
  if (installed) void startSeparation(trackIds);
  else useStemsStore.getState().openDialog(trackIds);
}

export function useExportPreview(params: StemExportParams | null) {
  return useQuery({
    queryKey: ["stems", "exportPreview", params],
    enabled: params != null,
    queryFn: () => {
      if (!params) throw new Error("nothing to export");
      return request("stems.exportPreview", params);
    },
    retry: false,
  });
}

export async function startExport(params: StemExportParams): Promise<void> {
  const { jobId } = await request("stems.export", params);
  useStemsStore.setState({ exportJob: { jobId, percent: 0 } });
}

function handleExportFinished(job: JobFinished, t: TFunction): void {
  const push = useToastStore.getState().push;
  useStemsStore.setState({ exportJob: null });
  if (job.status === "done" && job.result) {
    const result = job.result as unknown as StemExportResult;
    useStemsStore.getState().closeExport();
    const first = result.files[0]?.path;
    if (result.failed.length)
      push({
        title: t("stems.export.failed", { count: result.failed.length }),
        detail: result.failed.map((f) => f.error).join(" · "),
        tone: "warning",
      });
    if (first)
      push({
        title: t("stems.export.done", { count: result.files.length }),
        detail: result.folder,
        tone: "success",
        action: { label: t("stems.export.reveal"), run: () => void revealFile(first) },
      });
  } else if (job.status === "failed") {
    push({ title: t("stems.export.error", { error: job.error ?? "?" }), tone: "danger" });
  }
}

export async function cancelStemJob(jobId: string): Promise<void> {
  await request("job.cancel", { jobId });
}

export function handleStemsFinished(job: JobFinished, qc: QueryClient, t: TFunction): void {
  const store = useStemsStore.getState();
  const push = useToastStore.getState().push;
  if (job.kind === "stems.export") {
    if (store.exportJob?.jobId === job.jobId) handleExportFinished(job, t);
    return;
  }
  void qc.invalidateQueries({ queryKey: stemsKeys.all });
  if (job.kind === "stems.download") {
    if (store.download?.jobId !== job.jobId) return;
    const pending = store.pendingSeparation;
    useStemsStore.setState({ download: null });
    if (job.status === "done") {
      const result = job.result as unknown as StemModelDownloaded | null;
      useStemsStore.getState().closeDialog();
      if (pending?.length) void startSeparation(pending);
      else if (result) push({ title: t("stems.downloaded"), tone: "success" });
    } else if (job.status === "failed") {
      push({ title: t("stems.downloadFailed", { error: job.error ?? "?" }), tone: "danger" });
    }
    return;
  }
  if (job.kind !== "stems.separate" || store.separation?.jobId !== job.jobId) return;
  useStemsStore.setState({ separation: null });
  // Separating measures the vocal presence shown in the track detail.
  for (const id of store.separation.trackIds)
    void qc.invalidateQueries({ queryKey: detailKey(id) });
  if (job.status === "done" && job.result) {
    const result = job.result as unknown as StemsSeparateResult;
    const ready = result.separated.length + result.cached.length;
    if (result.failed.length)
      push({
        title: t("stems.failed", { count: result.failed.length }),
        detail: result.failed.map((f) => f.error).join(" · "),
        tone: "warning",
      });
    else push({ title: t("stems.ready", { count: ready }), tone: "success" });
  } else if (job.status === "failed") {
    push({ title: t("stems.separateFailed", { error: job.error ?? "?" }), tone: "danger" });
  }
}
