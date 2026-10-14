"""File-system helpers shared by every writer.

Temporary files are created with :func:`tempfile.mkstemp`: a random name and exclusive
creation (``O_CREAT | O_EXCL``), so a link planted next to the target can never redirect
the write to another file (the user's music folders may be writable by others).
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def temp_beside(path: Path, suffix: str = ".tonalia-tmp") -> tuple[int, Path]:
    """Open a new, exclusive temporary file in ``path``'s folder: (fd, path)."""
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}.", suffix=suffix)
    return fd, Path(name)


def write_atomic(
    path: Path, data: bytes, *, keep_mode_of: Path | None = None, mode: int | None = None
) -> None:
    """Write ``data`` to a fresh temporary file, fsync it and rename it over ``path``.

    The temporary file is private (0600): ``keep_mode_of`` copies an existing file's
    permissions, and ``mode`` sets them when there is none to copy (a new file another
    program shares with the user, like a DJ program's playlist).
    """
    fd, tmp = temp_beside(path)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if keep_mode_of is not None and keep_mode_of.exists():
            tmp.chmod(keep_mode_of.stat().st_mode & 0o7777)
        elif mode is not None:
            tmp.chmod(mode)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
