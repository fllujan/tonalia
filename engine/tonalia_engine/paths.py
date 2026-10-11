"""Application directories.

The Rust core passes ``TONALIA_DATA_DIR`` (Tauri's app data dir). When running the
engine on its own, fall back to the same platform location Tauri would use for the
``org.tonalia.app`` identifier.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_ID = "org.tonalia.app"


def data_dir(env: dict[str, str] | None = None, platform: str = sys.platform) -> Path:
    env = dict(os.environ) if env is None else env
    if override := env.get("TONALIA_DATA_DIR"):
        return Path(override)
    home = Path(env.get("HOME") or env.get("USERPROFILE") or Path.home())
    if platform == "darwin":
        return home / "Library" / "Application Support" / APP_ID
    if platform == "win32":
        return Path(env.get("APPDATA") or home / "AppData" / "Roaming") / APP_ID
    return Path(env.get("XDG_DATA_HOME") or home / ".local" / "share") / APP_ID


def database_path(env: dict[str, str] | None = None) -> Path:
    return data_dir(env) / "tonalia.db"
