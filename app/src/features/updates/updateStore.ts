// In-app updates (SPEC 10.2): check GitHub Releases for a signed new version, and download
// and install it only when the user asks. The check is the only network access besides the
// stems model (SPEC 0.2) and can be turned off in Settings → Updates.
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { errorMessage } from "../../lib/errors";

export type UpdateStatus =
  "idle" | "checking" | "latest" | "available" | "downloading" | "installing" | "error";

const CHECK_TIMEOUT_MS = 15_000;

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  /** 0–1 while downloading, when the size is known. */
  progress: number | null;
  error: string | null;
  /** The banner was closed for this version. */
  dismissed: boolean;
  update: Update | null;
  /** `quiet`: a failed check at start-up (offline…) is not reported. */
  checkNow: (quiet?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: false,
  update: null,
  checkNow: async (quiet = false) => {
    const busy = get().status;
    if (busy === "checking" || busy === "downloading" || busy === "installing") return;
    set({ status: "checking", error: null });
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (update)
        set({
          status: "available",
          update,
          version: update.version,
          notes: update.body?.trim() || null,
          dismissed: false,
        });
      else set({ status: "latest", update: null, version: null, notes: null });
    } catch (err) {
      set(quiet ? { status: "idle" } : { status: "error", error: errorMessage(err) });
    }
  },
  install: async () => {
    const update = get().update;
    if (!update) return;
    let total = 0;
    let received = 0;
    set({ status: "downloading", progress: null, error: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) set({ progress: Math.min(1, received / total) });
        } else set({ status: "installing", progress: 1 });
      });
      await relaunch();
    } catch (err) {
      set({ status: "error", error: errorMessage(err) });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));
