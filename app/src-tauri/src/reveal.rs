//! "Show in Finder/Explorer" for files Tonalia wrote.
//!
//! The opener plugin is used from Rust only: the webview may reveal files inside
//! Tonalia's data folder (backups, exports), DJ collection/playlist files it exported
//! (.xml, .nml, .m3u, .m3u8) or audio it exported (.wav, .aiff, .flac for a DAW, and the
//! sets it renders, which may also be .mp3). The track lists next to a set (.txt, .cue)
//! are not revealable themselves: revealing the set shows its folder, where they are.
//! Any other path is refused. Revealing only selects the file in Finder/Explorer.

use std::path::{Path, PathBuf};

const EXPORT_EXTENSIONS: &[&str] = &["xml", "nml", "m3u", "m3u8", "wav", "aiff", "flac", "mp3"];

/// Canonical path that may be revealed, or why not.
pub fn revealable(raw: &str, data_dir: &Path) -> Result<PathBuf, String> {
    let canonical = Path::new(raw)
        .canonicalize()
        .map_err(|e| format!("cannot open {raw}: {e}"))?;
    if !canonical.is_file() {
        return Err(format!("not a file: {raw}"));
    }
    let inside_data = data_dir
        .canonicalize()
        .map(|dir| canonical.starts_with(dir))
        .unwrap_or(false);
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if inside_data || EXPORT_EXTENSIONS.contains(&ext.as_str()) {
        Ok(canonical)
    } else {
        Err(format!("not a Tonalia file: {raw}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tonalia-reveal-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn allows_backups_and_exported_collections() {
        let data = temp_dir("data");
        let backup = data.join("backups").join("traktor");
        fs::create_dir_all(&backup).unwrap();
        let copy = backup.join("20261011-collection.nml.bak");
        fs::write(&copy, b"x").unwrap();
        assert_eq!(
            revealable(copy.to_str().unwrap(), &data).unwrap(),
            copy.canonicalize().unwrap()
        );

        let other = temp_dir("exports ñ");
        let xml = other.join("rekordbox 🎧.xml");
        fs::write(&xml, b"<x/>").unwrap();
        assert!(revealable(xml.to_str().unwrap(), &data).is_ok());
        let stem = other.join("Lumen Drift - Midnight Bloom (Voz) [8A 124].wav");
        fs::write(&stem, b"RIFF").unwrap();
        assert!(revealable(stem.to_str().unwrap(), &data).is_ok());
        // A set rendered to MP3 (SPEC 14.2) can be shown; its plain-text track list cannot.
        let set = other.join("Bolo sábado.mp3");
        fs::write(&set, b"ID3").unwrap();
        assert!(revealable(set.to_str().unwrap(), &data).is_ok());
        let list = other.join("Bolo sábado.txt");
        fs::write(&list, b"00:00").unwrap();
        assert!(revealable(list.to_str().unwrap(), &data).is_err());
        fs::remove_dir_all(data).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn refuses_other_files_folders_and_missing_paths() {
        let data = temp_dir("data2");
        let other = temp_dir("other");
        let secret = other.join("id_rsa");
        fs::write(&secret, b"x").unwrap();
        assert!(revealable(secret.to_str().unwrap(), &data).is_err());
        assert!(revealable(other.to_str().unwrap(), &data).is_err());
        assert!(revealable(other.join("missing.xml").to_str().unwrap(), &data).is_err());
        fs::remove_dir_all(data).unwrap();
        fs::remove_dir_all(other).unwrap();
    }
}
