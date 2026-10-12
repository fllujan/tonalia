// Clear error messages (SPEC 10.1): the engine and the Rust core report errors in technical
// English; the UI shows what happened and what to do, in the user's language. Unknown
// errors fall back to the original text, so nothing is ever hidden.
import type { TFunction } from "i18next";
import i18n from "../i18n";
import { RpcError } from "./rpc";

/** Codes of the Rust bridge (engine.rs) and JSON-RPC. */
const BY_CODE: Record<number, string> = {
  [-32000]: "errors.engineNotRunning",
  [-32001]: "errors.engineExited",
  [-32002]: "errors.engineTimeout",
  [-32003]: "errors.engineIo",
  [-32601]: "errors.methodNotFound",
};

type Params = Record<string, string>;

/** Engine messages (see the `raise …Error(` calls in the engine), most specific first. */
const RULES: readonly (readonly [RegExp, string, ((m: RegExpMatchArray) => Params)?])[] = [
  [/signature|minisign/i, "errors.updateSignature"],
  [/^unknown tracks?\b/, "errors.trackMissing"],
  [/^unknown playlist\b/, "errors.playlistMissing"],
  [/^unknown favorite\b/, "errors.favoriteMissing"],
  [/^unknown batch\b/, "errors.batchMissing"],
  [/stems of this track are not separated yet/, "errors.stemsMissing"],
  [/model is not downloaded/, "errors.modelMissing"],
  [/checksum mismatch|unexpected size \(/, "errors.downloadCorrupt"],
  [/^Traktor is open/, "errors.traktorOpen"],
  [/^VirtualDJ is open/, "errors.virtualdjOpen"],
  [/^(.+) already exists$/, "errors.fileExists", (m) => ({ name: m[1] ?? "" })],
  [/^the folder (.+) does not exist$/, "errors.folderMissing", (m) => ({ folder: m[1] ?? "" })],
  [/^file not found\b/, "errors.fileMissing"],
  [/^cannot decode (.+?): /, "errors.cannotDecode", (m) => ({ name: m[1] ?? "" })],
  [/^no audio stream in (.+)$/, "errors.noAudio", (m) => ({ name: m[1] ?? "" })],
  [/FFmpeg not found|could not run FFmpeg/, "errors.ffmpegMissing"],
  [/Rubber Band/, "errors.rubberband"],
  [/BPM is out of range/, "errors.bpmRange"],
  [/the pool has no analysed tracks/, "errors.poolEmpty"],
  [/not analysed yet|has no tempo yet|is not an analysed track/, "errors.notAnalysed"],
  [/choose a destination folder/, "errors.chooseFolder"],
  [/the name cannot be empty/, "errors.nameEmpty"],
  [/verification failed/, "errors.verifyFailed"],
  [/has changed since Tonalia wrote it/, "errors.undoChanged"],
  [/backup does not match|unknown backup format/, "errors.undoMismatch"],
  [
    /is not supported|unsupported (or unrecognized )?file|are not supported in/,
    "errors.unsupportedFile",
  ],
  [/only \.m3u and \.m3u8|must end in \.m3u/, "errors.m3uOnly"],
  [/folders (cannot be exported|have no tracks)/, "errors.folderNoTracks"],
  [/a folder cannot be moved inside itself/, "errors.folderInside"],
  [/a favorite needs two different tracks/, "errors.favoriteSame"],
  [/permission denied|operation not permitted|access is denied|EACCES|EPERM/i, "errors.permission"],
  [/no space left|ENOSPC|disk full/i, "errors.diskFull"],
  [/^cannot read (?:tags of )?(.+?)(?::|$)/, "errors.cannotRead", (m) => ({ name: m[1] ?? "" })],
  // Updater (tauri-plugin-updater).
  [/valid release JSON|release.*not found|404/i, "errors.noRelease"],
  [
    /error sending request|dns error|network|offline|connection (refused|reset)|timed? ?out/i,
    "errors.offline",
  ],
  [/^invalid params$/, "errors.invalidInput"],
  [/^internal error\b/, "errors.internal"],
];

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err);
}

/** A clear, translated sentence for an error message from the engine (e.g. a track's). */
export function describeMessage(message: string, t: TFunction = i18n.t): string {
  for (const [pattern, key, params] of RULES) {
    const match = message.match(pattern);
    if (match) return t(key, params?.(match) ?? {});
  }
  return message;
}

/** A clear, translated sentence for anything thrown by `request` (or elsewhere). */
export function errorMessage(err: unknown, t: TFunction = i18n.t): string {
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
