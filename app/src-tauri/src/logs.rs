//! Local log of the engine (SPEC 3: logs stay on the computer, "Open logs folder").
//! Each engine run appends its stderr to `engine.log`; a file over `MAX_BYTES` is moved to
//! `engine.log.1` (replacing the previous one) before the next run writes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const LOG_NAME: &str = "engine.log";
pub const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn log_path(dir: &Path) -> PathBuf {
    dir.join(LOG_NAME)
}

/// Open the log for appending, rotating it first when it has grown past `max_bytes`.
pub fn open_log(path: &Path, max_bytes: u64) -> io::Result<File> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if fs::metadata(path)
        .map(|m| m.len() > max_bytes)
        .unwrap_or(false)
    {
        let mut old = path.as_os_str().to_owned();
        old.push(".1");
        fs::rename(path, PathBuf::from(old))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    writeln!(file, "--- engine started (unix time {secs}) ---")?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tonalia-logs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn appends_runs_to_one_file_in_a_new_folder() {
        let dir = temp_dir("append").join("Registros ✨");
        let path = log_path(&dir);
        writeln!(open_log(&path, MAX_BYTES).unwrap(), "first ñ").unwrap();
        writeln!(open_log(&path, MAX_BYTES).unwrap(), "second").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text.matches("--- engine started").count(), 2);
        assert!(text.contains("first ñ\n") && text.contains("second\n"));
        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn rotates_a_large_log() {
        let dir = temp_dir("rotate");
        let path = log_path(&dir);
        writeln!(open_log(&path, 10).unwrap(), "old run with many bytes").unwrap();
        writeln!(open_log(&path, 10).unwrap(), "new run").unwrap();
        let old = fs::read_to_string(dir.join("engine.log.1")).unwrap();
        let new = fs::read_to_string(&path).unwrap();
        assert!(old.contains("old run") && !old.contains("new run"));
        assert!(new.contains("new run") && !new.contains("old run"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
