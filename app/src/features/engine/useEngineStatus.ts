import { useCallback, useEffect, useState } from "react";
import { onEngineEvent, request } from "../../lib/rpc";

export type EngineStatus = "connecting" | "connected" | "restarting" | "disconnected";

/** How long the engine may take to say it is ready when the app opens before it is shown as
 * disconnected (PyInstaller unpacks it; the first launch also waits for macOS to check it). */
export const STARTUP_GRACE_MS = 30_000;
const STARTUP_POLL_MS = 1_000;

async function pingEngine(): Promise<EngineStatus> {
  try {
    const res = await request("engine.ping");
    return res.pong ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}

export interface EngineState {
  status: EngineStatus;
  /** The engine stopped unexpectedly and is back: work in progress was interrupted. */
  restarted: boolean;
  retry: () => void;
  dismissRestart: () => void;
}

export function useEngineStatus(): EngineState {
  const [status, setStatus] = useState<EngineStatus>("connecting");
  const [restarted, setRestarted] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let crashed = false;
    // Until the engine has answered once (or the grace runs out), a failed ping means it is
    // still starting, not that it is down.
    let starting = true;
    const refresh = () =>
      pingEngine().then((s) => {
        if (disposed) return;
        if (s === "connected") starting = false;
        else if (starting) return;
        setStatus(s);
        if (s === "connected" && crashed) {
          crashed = false;
          setRestarted(true);
        }
      });
    // The "ready" event may come before this listens: ask every second meanwhile.
    const poll = setInterval(() => {
      if (starting) void refresh();
      else clearInterval(poll);
    }, STARTUP_POLL_MS);
    const grace = setTimeout(() => {
      clearInterval(poll);
      if (!starting) return;
      starting = false;
      void refresh();
    }, STARTUP_GRACE_MS);

    onEngineEvent((e) => {
      if (e.type === "engine.exited") {
        crashed = true;
        setRestarted(false);
        setStatus("restarting");
      } else if (e.type === "ready" || e.type === "engine.restarted") void refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    void refresh();

    return () => {
      disposed = true;
      clearTimeout(grace);
      clearInterval(poll);
      unlisten?.();
    };
  }, []);

  const retry = useCallback(() => {
    setStatus("connecting");
    void pingEngine().then(setStatus);
  }, []);

  const dismissRestart = useCallback(() => setRestarted(false), []);

  return { status, restarted, retry, dismissRestart };
}
