// The real engine behind the UI for the end-to-end smoke test: it plays the part of the
// Rust core (src-tauri/src/engine.rs) — spawns the Python engine, writes one JSON-RPC
// request per line, matches the answers by id and forwards `progress`/`event`
// notifications as the `engine://progress` / `engine://event` Tauri events.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

type Listener = (ev: { payload: unknown }) => void;
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class EngineBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private listeners = new Map<string, Set<Listener>>();
  readonly calls: { method: string; params: unknown }[] = [];
  readonly events: { type: string; payload: unknown }[] = [];
  stderr = "";

  start(engineDir: string, dataDir: string): Promise<void> {
    const proc = spawn("uv", ["run", "--quiet", "python", "-m", "tonalia_engine"], {
      cwd: engineDir,
      env: { ...process.env, TONALIA_DATA_DIR: dataDir, TONALIA_LOG_LEVEL: "WARNING" },
    });
    this.proc = proc;
    proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-20_000);
    });
    const ready = new Promise<void>((resolve, reject) => {
      proc.once("exit", (code) => reject(new Error(`engine exited (${code}): ${this.stderr}`)));
      this.onReady = resolve;
    });
    createInterface({ input: proc.stdout }).on("line", (line) => this.receive(line));
    return ready;
  }

  private onReady: (() => void) | null = null;

  private receive(line: string) {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as {
      id?: number;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
      method?: string;
      params?: { type?: string; payload?: unknown };
    };
    if (msg.id != null) {
      const waiting = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) waiting?.reject(msg.error);
      else waiting?.resolve(msg.result);
      return;
    }
    if (msg.method === "event" && msg.params?.type) {
      this.events.push({ type: msg.params.type, payload: msg.params.payload });
      if (msg.params.type === "ready") this.onReady?.();
    }
    const channel =
      msg.method === "progress"
        ? "engine://progress"
        : msg.method === "event"
          ? "engine://event"
          : null;
    if (channel) this.listeners.get(channel)?.forEach((cb) => cb({ payload: msg.params }));
  }

  request(method: string, params: unknown = null): Promise<unknown> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("engine not started"));
    const id = this.nextId++;
    this.calls.push({ method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  /** `@tauri-apps/api/core` invoke: the commands of src-tauri/src/lib.rs. */
  invoke(cmd: string, args: { method?: string; params?: unknown } = {}): Promise<unknown> {
    if (cmd === "engine_request") return this.request(args.method ?? "", args.params ?? null);
    // allow_playback / reveal_file only touch the webview and the OS.
    return Promise.resolve(null);
  }

  /** `@tauri-apps/api/event` listen. */
  listen(channel: string, cb: Listener): Promise<() => void> {
    const set = this.listeners.get(channel) ?? new Set<Listener>();
    set.add(cb);
    this.listeners.set(channel, set);
    return Promise.resolve(() => set.delete(cb));
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    proc.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill();
        resolve();
      }, 5000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export const bridge = new EngineBridge();
