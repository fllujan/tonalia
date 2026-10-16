// Clear error messages (SPEC 10.1, 11.4): every engine error carries a stable code
// (`reason`) and the UI translates by it; the English message is only the technical
// detail. Errors from outside the engine (the Rust bridge, the updater) are recognised by
// their bridge code or, as a fallback, their text. Unknown text is shown as it is, so
// nothing is ever hidden.
import type { TFunction } from "i18next";
import i18n from "../i18n";
import { RpcError } from "./rpc";
import type { ErrorInfo } from "./rpc.types";

export type ErrorReason = ErrorInfo["reason"];

/** The sentence of every engine error code. A Record, so a new code does not compile
 * until it has its key (and a test checks that each key has its es/en text). */
export const REASON_KEYS: Record<ErrorReason, string> = {
  internal: "errors.reasons.internal",
  invalid_params: "errors.reasons.invalid_params",
  method_not_found: "errors.reasons.method_not_found",
  track_not_found: "errors.reasons.track_not_found",
  playlist_not_found: "errors.reasons.playlist_not_found",
  favorite_not_found: "errors.reasons.favorite_not_found",
  batch_not_found: "errors.reasons.batch_not_found",
  file_not_found: "errors.reasons.file_not_found",
  folder_not_found: "errors.reasons.folder_not_found",
  file_exists: "errors.reasons.file_exists",
  decode_failed: "errors.reasons.decode_failed",
  no_audio: "errors.reasons.no_audio",
  unsupported_format: "errors.reasons.unsupported_format",
  read_failed: "errors.reasons.read_failed",
  write_failed: "errors.reasons.write_failed",
  verify_failed: "errors.reasons.verify_failed",
  ffmpeg_missing: "errors.reasons.ffmpeg_missing",
  rubberband_failed: "errors.reasons.rubberband_failed",
  process_crashed: "errors.reasons.process_crashed",
  program_running: "errors.reasons.program_running",
  collection_not_found: "errors.reasons.collection_not_found",
  unsupported_version: "errors.reasons.unsupported_version",
  database_busy: "errors.reasons.database_busy",
  schema_too_new: "errors.reasons.schema_too_new",
  model_missing: "errors.reasons.model_missing",
  stems_missing: "errors.reasons.stems_missing",
  download_failed: "errors.reasons.download_failed",
  network: "errors.reasons.network",
  gpu_unavailable: "errors.reasons.gpu_unavailable",
  driver_too_old: "errors.reasons.driver_too_old",
  disk_full: "errors.reasons.disk_full",
  permission_denied: "errors.reasons.permission_denied",
  not_analysed: "errors.reasons.not_analysed",
  bpm_out_of_range: "errors.reasons.bpm_out_of_range",
  out_of_track: "errors.reasons.out_of_track",
  pool_empty: "errors.reasons.pool_empty",
  invalid_set: "errors.reasons.invalid_set",
  choose_folder: "errors.reasons.choose_folder",
  name_empty: "errors.reasons.name_empty",
  undo_changed: "errors.reasons.undo_changed",
  undo_mismatch: "errors.reasons.undo_mismatch",
  m3u_only: "errors.reasons.m3u_only",
  folder_no_tracks: "errors.reasons.folder_no_tracks",
  folder_inside: "errors.reasons.folder_inside",
  playlist_kind: "errors.reasons.playlist_kind",
  favorite_same: "errors.reasons.favorite_same",
  not_enough_ratings: "errors.reasons.not_enough_ratings",
  group_not_found: "errors.reasons.group_not_found",
};

/** Codes of the Rust bridge (engine.rs), which has no engine to give a reason. */
const BY_CODE: Record<number, string> = {
  [-32000]: "errors.engineNotRunning",
  [-32001]: "errors.engineExited",
  [-32002]: "errors.engineTimeout",
  [-32003]: "errors.engineIo",
};

/** Errors from outside the engine (Rust commands, tauri-plugin-updater), by their text. */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/^(third-party list not found|invalid third-party list)/, "errors.licensesMissing"],
  [/signature|minisign/i, "errors.updateSignature"],
  [
    /permission denied|operation not permitted|access is denied|EACCES|EPERM/i,
    REASON_KEYS.permission_denied,
  ],
  [/no space left|ENOSPC|disk full/i, REASON_KEYS.disk_full],
  [/valid release JSON|release.*not found|404/i, "errors.noRelease"],
  [
    /error sending request|dns error|network|offline|connection (refused|reset)|timed? ?out/i,
    "errors.offline",
  ],
];

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err);
}

function isReason(value: unknown): value is ErrorReason {
  return typeof value === "string" && value in REASON_KEYS;
}

/** The code an RPC error carries in `error.data` (SPEC 11.4), if any. */
function infoOf(err: unknown): ErrorInfo | null {
  if (!(err instanceof RpcError) || !err.data || typeof err.data !== "object") return null;
  const data = err.data as { reason?: unknown; params?: Record<string, string> };
  return isReason(data.reason) ? { reason: data.reason, params: data.params ?? {} } : null;
}

/** The engine's code for an error thrown by `request`, when it has one. */
export const errorInfoOf = infoOf;

/** A clear sentence for a message from outside the engine; unknown text stays as it is. */
export function describeMessage(message: string, t: TFunction = i18n.t): string {
  for (const [pattern, key] of RULES) if (pattern.test(message)) return t(key);
  return message;
}

/** A clear, translated sentence for an engine error: by its code, or (with none) its text. */
export function describeError(
  info: ErrorInfo | null | undefined,
  message: string,
  t: TFunction = i18n.t,
): string {
  if (info && isReason(info.reason)) return t(REASON_KEYS[info.reason], info.params ?? {});
  return describeMessage(message, t);
}

/** The sentence for something that failed with `error` + `errorInfo` (a job, a track, one
 * file of a batch). */
export function describeFailure(
  failure: { error?: string | null; errorInfo?: ErrorInfo | null },
  t: TFunction = i18n.t,
): string {
  return describeError(failure.errorInfo, failure.error ?? "?", t);
}

/** A clear, translated sentence for anything thrown by `request` (or elsewhere). */
export function errorMessage(err: unknown, t: TFunction = i18n.t): string {
  const info = infoOf(err);
  if (info) return describeError(info, rawMessage(err), t);
  const code = err instanceof RpcError ? err.code : undefined;
  const byCode = code != null ? BY_CODE[code] : undefined;
  if (byCode) return t(byCode);
  return describeMessage(rawMessage(err), t);
}

/** The original technical text when it differs from the clear one (for "details"). */
export function errorDetail(err: unknown, t: TFunction = i18n.t): string | undefined {
  const raw = rawMessage(err);
  return raw !== errorMessage(err, t) ? raw : undefined;
}
