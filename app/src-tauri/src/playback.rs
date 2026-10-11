//! Playback of library tracks in the webview.
//!
//! The asset protocol scope only covers Tonalia's own folders (artwork, waveforms). To
//! play a track, the frontend asks for that one file to be allowed: it must exist, be a
//! regular file and have a supported audio extension. Nothing else on disk is exposed.

use std::path::{Path, PathBuf};

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "aif", "aiff", "m4a", "aac", "mp4", "alac", "ogg", "oga", "flac",
];

/// Canonical path of a playable audio file, or why it cannot be played.
pub fn playable_path(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("not an audio file: {raw}"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot open {raw}: {e}"))?;
    if !canonical.is_file() {
        return Err(format!("not a file: {raw}"));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tonalia-playback-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_audio_files_with_any_name() {
        let dir = temp_dir("ok");
        let file = dir.join("Música 🎧 (Original Mix).FLAC");
        fs::write(&file, b"fLaC").unwrap();
        let allowed = playable_path(file.to_str().unwrap()).unwrap();
        assert_eq!(allowed, file.canonicalize().unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_other_files_directories_and_missing_paths() {
        let dir = temp_dir("bad");
        let text = dir.join("notes.txt");
        fs::write(&text, b"hi").unwrap();
        assert!(playable_path(text.to_str().unwrap()).is_err());
        let folder = dir.join("set.mp3");
        fs::create_dir_all(&folder).unwrap();
        assert!(playable_path(folder.to_str().unwrap()).is_err());
        assert!(playable_path(dir.join("missing.wav").to_str().unwrap()).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
