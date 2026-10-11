// Typed JSON-RPC client. Requests go through the Rust core (`engine_request` command);
// engine notifications arrive as Tauri events.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EventParams, RpcMethods, ProgressParams } from "./rpc.types";

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type MethodName = keyof RpcMethods;
type ParamsOf<M extends MethodName> = RpcMethods[M]["params"];
type ResultOf<M extends MethodName> = RpcMethods[M]["result"];

export async function request<M extends MethodName>(
  method: M,
  ...params: ParamsOf<M> extends null ? [] : [ParamsOf<M>]
): Promise<ResultOf<M>> {
  try {
    return await invoke<ResultOf<M>>("engine_request", { method, params: params[0] ?? null });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) {
      const e = err as { code: number; message: string; data?: unknown };
      throw new RpcError(e.code, e.message, e.data);
    }
    throw new RpcError(-32000, String(err));
  }
}

export const ENGINE_EVENT = "engine://event";
export const ENGINE_PROGRESS = "engine://progress";

export function onEngineEvent(cb: (e: EventParams) => void): Promise<UnlistenFn> {
  return listen<EventParams>(ENGINE_EVENT, (ev) => cb(ev.payload));
}

export function onProgress(cb: (p: ProgressParams) => void): Promise<UnlistenFn> {
  return listen<ProgressParams>(ENGINE_PROGRESS, (ev) => cb(ev.payload));
}
