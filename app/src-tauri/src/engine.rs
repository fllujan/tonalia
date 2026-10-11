//! Engine sidecar: process supervision and the JSON-RPC bridge.
//!
//! The engine speaks newline-delimited JSON-RPC 2.0 over stdio. Responses are matched to
//! pending requests by `id`; `progress` and `event` notifications are forwarded to the
//! frontend as `engine://progress` and `engine://event`. If the process dies, pending
//! requests fail, `engine.exited` is emitted, and the engine is restarted with backoff
//! (followed by `engine.restarted`).

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

pub const EVENT_CHANNEL: &str = "engine://event";
pub const PROGRESS_CHANNEL: &str = "engine://progress";

/// Error codes produced by the bridge itself (JSON-RPC reserves -32000..-32099 for servers).
pub const ENGINE_NOT_RUNNING: i64 = -32000;
pub const ENGINE_EXITED: i64 = -32001;
pub const ENGINE_TIMEOUT: i64 = -32002;
pub const ENGINE_IO: i64 = -32003;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    fn from_value(v: &Value) -> Self {
        Self {
            code: v.get("code").and_then(Value::as_i64).unwrap_or(-32603),
            message: v
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_owned(),
            data: v.get("data").cloned(),
        }
    }
}

/// Destination for engine notifications (the Tauri app in production, a channel in tests).
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, channel: &str, payload: Value);
}

type Writer = Box<dyn AsyncWrite + Send + Unpin>;
type Pending = HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>;

struct Inner {
    writer: tokio::sync::Mutex<Option<Writer>>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    sink: Arc<dyn EventSink>,
}

/// Cheaply cloneable handle used by Tauri commands to talk to the engine.
#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Inner>,
}

impl Bridge {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            inner: Arc::new(Inner {
                writer: tokio::sync::Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                sink,
            }),
        }
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RpcError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let mut msg = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if !params.is_null() {
            msg["params"] = params;
        }
        let mut line = msg.to_string();
        line.push('\n');

        let (tx, rx) = oneshot::channel();
        {
            let mut writer = self.inner.writer.lock().await;
            let Some(w) = writer.as_mut() else {
                return Err(RpcError::new(ENGINE_NOT_RUNNING, "engine not running"));
            };
            self.pending().insert(id, tx);
            let written = async {
                w.write_all(line.as_bytes()).await?;
                w.flush().await
            }
            .await;
            if let Err(e) = written {
                self.pending().remove(&id);
                return Err(RpcError::new(
                    ENGINE_IO,
                    format!("failed to write to engine: {e}"),
                ));
            }
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RpcError::new(ENGINE_EXITED, "engine exited")),
            Err(_) => {
                self.pending().remove(&id);
                Err(RpcError::new(
                    ENGINE_TIMEOUT,
                    format!("engine timed out on {method}"),
                ))
            }
        }
    }

    fn pending(&self) -> std::sync::MutexGuard<'_, Pending> {
        self.inner.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn attach(&self, writer: Writer) {
        *self.inner.writer.lock().await = Some(writer);
    }

    /// Drop the writer and fail every in-flight request.
    async fn detach(&self) {
        *self.inner.writer.lock().await = None;
        for (_, tx) in self.pending().drain() {
            let _ = tx.send(Err(RpcError::new(ENGINE_EXITED, "engine exited")));
        }
    }

    /// Read engine stdout until EOF, routing each line.
    async fn pump<R: AsyncRead + Unpin>(&self, reader: R) {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => self.route(&line),
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[engine] stdout read error: {e}");
                    break;
                }
            }
        }
    }

    fn route(&self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[engine] invalid JSON on stdout ({e}): {line}");
                return;
            }
        };
        if let Some(method) = msg.get("method").and_then(Value::as_str) {
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            match method {
                "progress" => self.inner.sink.emit(PROGRESS_CHANNEL, params),
                "event" => self.inner.sink.emit(EVENT_CHANNEL, params),
                other => eprintln!("[engine] unknown notification: {other}"),
            }
            return;
        }
        let Some(id) = msg.get("id").and_then(Value::as_u64) else {
            eprintln!("[engine] response without a usable id: {line}");
            return;
        };
        let Some(tx) = self.pending().remove(&id) else {
            return; // Timed out earlier; drop the late response.
        };
        let result = match msg.get("error") {
            Some(err) => Err(RpcError::from_value(err)),
            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = tx.send(result);
    }

    fn emit_event(&self, kind: &str, payload: Value) {
        self.inner
            .sink
            .emit(EVENT_CHANNEL, json!({ "type": kind, "payload": payload }));
    }
}

/// A running engine instance as seen by the supervisor.
pub struct Spawned {
    pub stdin: Writer,
    pub stdout: Box<dyn AsyncRead + Send + Unpin>,
    /// Held so the process is killed when the instance is dropped.
    pub child: Option<tokio::process::Child>,
}

pub trait Spawner: Send + Sync + 'static {
    fn spawn(&self) -> io::Result<Spawned>;
}

/// How the engine is launched.
#[derive(Debug, Clone)]
pub struct EngineCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, PathBuf)>,
}

impl Spawner for EngineCommand {
    fn spawn(&self) -> io::Result<Spawned> {
        let mut cmd = tokio::process::Command::new(&self.program);
        cmd.args(&self.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1")
            .kill_on_drop(true);
        if let Some(cwd) = &self.cwd {
            cmd.current_dir(cwd);
        }
        for (key, value) in &self.env {
            cmd.env(key, value);
        }
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("no stdout"))?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[engine] {line}");
                }
            });
        }
        Ok(Spawned {
            stdin: Box::new(stdin),
            stdout: Box::new(stdout),
            child: Some(child),
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Backoff {
    pub initial: Duration,
    pub max: Duration,
    /// A run longer than this resets the backoff.
    pub healthy_after: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            initial: Duration::from_millis(250),
            max: Duration::from_secs(10),
            healthy_after: Duration::from_secs(30),
        }
    }
}

/// Keep the engine running forever. Abort the returned task to stop it (the child is killed).
pub async fn supervise<S: Spawner>(bridge: Bridge, spawner: S, backoff: Backoff) {
    let mut delay = backoff.initial;
    let mut first = true;
    loop {
        let started = Instant::now();
        match spawner.spawn() {
            Ok(Spawned {
                stdin,
                stdout,
                child,
            }) => {
                bridge.attach(stdin).await;
                if !first {
                    bridge.emit_event("engine.restarted", json!({}));
                }
                bridge.pump(stdout).await;
                bridge.detach().await;
                let code = match child {
                    Some(mut c) => {
                        let _ = c.start_kill();
                        c.wait().await.ok().and_then(|s| s.code())
                    }
                    None => None,
                };
                bridge.emit_event("engine.exited", json!({ "code": code }));
            }
            Err(e) => {
                eprintln!("[engine] failed to start: {e}");
                bridge.emit_event("engine.exited", json!({ "error": e.to_string() }));
            }
        }
        first = false;
        if started.elapsed() >= backoff.healthy_after {
            delay = backoff.initial;
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(backoff.max);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, DuplexStream, ReadHalf, WriteHalf};
    use tokio::sync::mpsc;

    struct ChanSink(mpsc::UnboundedSender<(String, Value)>);
    impl EventSink for ChanSink {
        fn emit(&self, channel: &str, payload: Value) {
            let _ = self.0.send((channel.to_owned(), payload));
        }
    }

    fn bridge() -> (Bridge, mpsc::UnboundedReceiver<(String, Value)>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Bridge::new(Arc::new(ChanSink(tx))), rx)
    }

    /// Fake engine: answers `engine.ping` and echoes params for `echo`; `die` closes the stream.
    async fn fake_engine(io: DuplexStream) {
        let (r, mut w) = tokio::io::split(io);
        w.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ready\",\"payload\":{}}}\n")
            .await
            .unwrap();
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let req: Value = serde_json::from_str(&line).unwrap();
            let id = req["id"].clone();
            let reply = match req["method"].as_str().unwrap() {
                "engine.ping" => json!({"jsonrpc":"2.0","id":id,"result":{"pong":true}}),
                "echo" => {
                    let note = json!({"jsonrpc":"2.0","method":"progress","params":{"jobId":"j","stage":"s","percent":50.0}});
                    w.write_all(format!("{note}\n").as_bytes()).await.unwrap();
                    json!({"jsonrpc":"2.0","id":id,"result":req["params"]})
                }
                "hang" => continue,
                "die" => return,
                _ => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"method not found"}})
                }
            };
            w.write_all(format!("{reply}\n").as_bytes()).await.unwrap();
        }
    }

    fn attach_fake(b: &Bridge) -> tokio::task::JoinHandle<()> {
        let (ours, theirs) = duplex(64 * 1024);
        tokio::spawn(fake_engine(theirs));
        let (r, w): (ReadHalf<DuplexStream>, WriteHalf<DuplexStream>) = tokio::io::split(ours);
        let b2 = b.clone();
        tokio::spawn(async move {
            b2.attach(Box::new(w)).await;
            b2.pump(r).await;
            b2.detach().await;
        })
    }

    const T: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn not_running_before_attach() {
        let (b, _rx) = bridge();
        let err = b.request("engine.ping", Value::Null, T).await.unwrap_err();
        assert_eq!(err.code, ENGINE_NOT_RUNNING);
    }

    #[tokio::test]
    async fn correlates_responses_and_forwards_notifications() {
        let (b, mut rx) = bridge();
        attach_fake(&b);
        let (ch, ready) = rx.recv().await.unwrap();
        assert_eq!(ch, EVENT_CHANNEL);
        assert_eq!(ready["type"], "ready");

        let pong = b.request("engine.ping", Value::Null, T).await.unwrap();
        assert_eq!(pong, json!({"pong": true}));

        let text = json!({"t": "Canción 🎧 Ñandú"});
        let (a, c) = tokio::join!(
            b.request("echo", text.clone(), T),
            b.request("engine.ping", Value::Null, T)
        );
        assert_eq!(a.unwrap(), text);
        assert_eq!(c.unwrap(), json!({"pong": true}));
        let (ch, p) = rx.recv().await.unwrap();
        assert_eq!(ch, PROGRESS_CHANNEL);
        assert_eq!(p["percent"], 50.0);

        let err = b.request("nope", Value::Null, T).await.unwrap_err();
        assert_eq!(err.code, -32601);
    }

    #[tokio::test]
    async fn pending_requests_fail_when_engine_dies() {
        let (b, mut rx) = bridge();
        attach_fake(&b);
        assert_eq!(next_type(&mut rx).await, "ready");
        let b2 = b.clone();
        let hanging = tokio::spawn(async move { b2.request("hang", Value::Null, T).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = b
            .request("die", Value::Null, Duration::from_millis(500))
            .await;
        assert_eq!(hanging.await.unwrap().unwrap_err().code, ENGINE_EXITED);
        let err = b.request("engine.ping", Value::Null, T).await.unwrap_err();
        assert_eq!(err.code, ENGINE_NOT_RUNNING);
    }

    #[tokio::test]
    async fn times_out() {
        let (b, mut rx) = bridge();
        attach_fake(&b);
        assert_eq!(next_type(&mut rx).await, "ready");
        let err = b
            .request("hang", Value::Null, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert_eq!(err.code, ENGINE_TIMEOUT);
    }

    struct FakeSpawner;
    impl Spawner for FakeSpawner {
        fn spawn(&self) -> io::Result<Spawned> {
            let (ours, theirs) = duplex(64 * 1024);
            tokio::spawn(fake_engine(theirs));
            let (r, w) = tokio::io::split(ours);
            Ok(Spawned {
                stdin: Box::new(w),
                stdout: Box::new(r),
                child: None,
            })
        }
    }

    async fn next_type(rx: &mut mpsc::UnboundedReceiver<(String, Value)>) -> String {
        rx.recv().await.unwrap().1["type"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[tokio::test]
    async fn supervisor_restarts_after_crash() {
        let (b, mut rx) = bridge();
        let backoff = Backoff {
            initial: Duration::from_millis(10),
            max: Duration::from_millis(20),
            healthy_after: Duration::from_secs(30),
        };
        let task = tokio::spawn(supervise(b.clone(), FakeSpawner, backoff));

        assert_eq!(next_type(&mut rx).await, "ready");
        assert!(b.request("engine.ping", Value::Null, T).await.is_ok());

        let _ = b
            .request("die", Value::Null, Duration::from_millis(200))
            .await;
        assert_eq!(next_type(&mut rx).await, "engine.exited");
        let mut seen = vec![next_type(&mut rx).await, next_type(&mut rx).await];
        seen.sort();
        assert_eq!(seen, vec!["engine.restarted", "ready"]);
        assert!(b.request("engine.ping", Value::Null, T).await.is_ok());
        task.abort();
    }

    #[tokio::test]
    async fn real_process_spawner_reports_missing_binary() {
        let cmd = EngineCommand {
            program: PathBuf::from("/definitely/not/here/tonalia-engine"),
            args: vec![],
            cwd: None,
            env: vec![],
        };
        assert!(cmd.spawn().is_err());
    }
}
