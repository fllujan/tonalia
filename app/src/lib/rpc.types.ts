// Temporary hand-written stub for task 0.3; replaced by the generator in task 0.6
// (scripts/gen-types from engine/tonalia_engine/rpc_schema.py).

export interface PingResult {
  pong: boolean;
}
export interface VersionResult {
  version: string;
  protocol: number;
  python: string;
}
export interface ProgressParams {
  jobId: string;
  trackId?: number | null;
  stage: string;
  percent: number;
}
export interface EventParams {
  type: string;
  payload: Record<string, unknown>;
}

export interface RpcMethods {
  "engine.ping": { params: null; result: PingResult };
  "engine.version": { params: null; result: VersionResult };
}
