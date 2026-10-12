// App-level system actions handled by the Rust core (src-tauri/src/lib.rs).
import { invoke } from "@tauri-apps/api/core";
import { version } from "../../package.json";

export const APP_VERSION = version;

/** Open the folder with the engine's log (SPEC 3: logs stay local). */
export function openLogsFolder(): Promise<void> {
  return invoke("open_logs_folder");
}
