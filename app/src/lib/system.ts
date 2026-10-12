// App-level system actions handled by the Rust core (src-tauri/src/lib.rs).
import { invoke } from "@tauri-apps/api/core";
import { version } from "../../package.json";

export const APP_VERSION = version;

/** Open the folder with the engine's log (SPEC 3: logs stay local). */
export function openLogsFolder(): Promise<void> {
  return invoke("open_logs_folder");
}

/** One distributed component, from `scripts/third_party.py` (SPEC 10.4). */
export interface ThirdPartyPackage {
  name: string;
  version: string;
  license: string;
  component: "bundled" | "engine" | "core" | "app" | "download";
  url: string;
  /** i18n key under `licenses.notes`, or "". */
  note: string;
}

export interface ThirdPartyListing {
  version: number;
  target: string;
  packages: ThirdPartyPackage[];
  /** i18n keys under `licenses.acks` (data and research that are not packages). */
  acknowledgements: { key: string; url?: string }[];
}

/** The third-party components of this build, for Settings → About. */
export function thirdPartyLicenses(): Promise<ThirdPartyListing> {
  return invoke("third_party_licenses");
}

/** Open every third-party license text in the default text viewer. */
export function openThirdPartyNotices(): Promise<void> {
  return invoke("open_third_party_notices");
}
