mod engine;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine::{Backoff, Bridge, EngineCommand, EventSink, RpcError};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

struct TauriSink(AppHandle);

impl EventSink for TauriSink {
    fn emit(&self, channel: &str, payload: Value) {
        if let Err(e) = self.0.emit(channel, payload) {
            eprintln!("[engine] failed to emit {channel}: {e}");
        }
    }
}

struct Supervisor(Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

#[tauri::command]
async fn engine_request(
    bridge: tauri::State<'_, Bridge>,
    method: String,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    bridge
        .request(&method, params.unwrap_or(Value::Null), REQUEST_TIMEOUT)
        .await
}

/// Resolve how to launch the engine:
/// 1. `TONALIA_ENGINE_CMD` — JSON array `[program, ...args]` (overrides everything);
/// 2. debug builds — `uv run python -m tonalia_engine` inside the repo's `engine/`;
/// 3. release builds — the bundled PyInstaller folder in the resource dir.
fn engine_command(app: &AppHandle) -> Result<EngineCommand, String> {
    if let Ok(raw) = std::env::var("TONALIA_ENGINE_CMD") {
        let parts: Vec<String> =
            serde_json::from_str(&raw).map_err(|e| format!("invalid TONALIA_ENGINE_CMD: {e}"))?;
        let (program, args) = parts.split_first().ok_or("empty TONALIA_ENGINE_CMD")?;
        return Ok(EngineCommand {
            program: program.into(),
            args: args.to_vec(),
            cwd: None,
        });
    }
    if cfg!(debug_assertions) {
        let engine_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine");
        return Ok(EngineCommand {
            program: "uv".into(),
            args: ["run", "--quiet", "python", "-m", "tonalia_engine"]
                .map(String::from)
                .to_vec(),
            cwd: Some(engine_dir),
        });
    }
    let exe = if cfg!(windows) {
        "tonalia-engine.exe"
    } else {
        "tonalia-engine"
    };
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("engine");
    Ok(EngineCommand {
        program: dir.join(exe),
        args: vec![],
        cwd: Some(dir),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![engine_request])
        .setup(|app| {
            let handle = app.handle().clone();
            let bridge = Bridge::new(Arc::new(TauriSink(handle.clone())));
            app.manage(bridge.clone());
            let cmd = engine_command(&handle)?;
            let task =
                tauri::async_runtime::spawn(engine::supervise(bridge, cmd, Backoff::default()));
            app.manage(Supervisor(Mutex::new(Some(task))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tonalia")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Aborting the supervisor drops the child process, which kills the engine.
                if let Some(task) = app
                    .state::<Supervisor>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut t| t.take())
                {
                    task.abort();
                }
            }
        });
}
