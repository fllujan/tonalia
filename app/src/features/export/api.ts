import { request } from "../../lib/rpc";
import type { ExportOptions } from "../../lib/rpc.types";
import { type ExportTarget, useExportStore } from "./exportStore";

const METHODS = { rekordbox: "export.rekordbox" } as const;

export type SupportedTarget = keyof typeof METHODS;

export async function startExport(target: SupportedTarget, options: ExportOptions): Promise<void> {
  const { jobId } = await request(METHODS[target], options);
  useExportStore.getState().start(target as ExportTarget, jobId, options.simulate ?? true);
}
