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

export function useEngineStatus(): { status: EngineStatus; retry: () => void } {
  const [status, setStatus] = useState<EngineStatus>("connecting");

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () =>
      pingEngine().then((s) => {
        if (!disposed) setStatus(s);
      });

    onEngineEvent((e) => {
      if (e.type === "engine.exited") setStatus("restarting");
      else if (e.type === "ready" || e.type === "engine.restarted") void refresh();
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

  return { status, retry };
}
