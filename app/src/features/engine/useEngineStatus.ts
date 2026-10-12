import { useCallback, useEffect, useState } from "react";
import { onEngineEvent, request } from "../../lib/rpc";

export type EngineStatus = "connecting" | "connected" | "restarting" | "disconnected";

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
    const refresh = () =>
      pingEngine().then((s) => {
        if (disposed) return;
        setStatus(s);
        if (s === "connected" && crashed) {
          crashed = false;
          setRestarted(true);
        }
      });

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
