// Limits of the analysis settings, mirrored from the engine (rpc_schema.Settings) so the
// form can explain a value before the engine rejects it.
import { CUE_PALETTE } from "../../lib/sections";
import type { AppSettings } from "./api";

export const BPM_LIMITS = { min: 40, max: 250, span: 20 } as const;

export const DEFAULT_CUE_COLORS = [...CUE_PALETTE] as AppSettings["cueColors"];

export function bpmRangeError(lo: number, hi: number): "range" | "span" | null {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "range";
  if (lo < BPM_LIMITS.min || hi > BPM_LIMITS.max || lo >= hi) return "range";
  if (hi - lo < BPM_LIMITS.span) return "span";
  return null;
}
