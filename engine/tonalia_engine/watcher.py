"""Watched folders (SPEC 2.14): import and analyse new tracks on their own.

Polling instead of OS notifications: it works the same on macOS and Windows, on
network and external drives, and needs no extra dependency. Each tick lists the
supported audio files under the watched folders and compares them with the library
(path, size, mtime). A new or changed file is imported only once two consecutive ticks
see the same size and mtime, so files still being copied are left alone. A file the
import skipped (e.g. a duplicate copy) is not retried until it changes.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

from .library import scan

log = logging.getLogger(__name__)

Signature = tuple[int, float]

# After a tick that found files still settling, look again this soon (seconds).
SETTLE_DELAY = 3.0


class FolderWatcher:
    def __init__(
        self,
        folders: Callable[[], Iterable[str]],
        known: Callable[[], Mapping[str, Signature]],
        start_import: Callable[[list[Path]], object],
        interval: float = 30.0,
    ) -> None:
        self._folders = folders
        self._known = known
        self._start_import = start_import
        self.interval = interval
        self._pending: dict[str, Signature] = {}
        self._attempted: dict[str, Signature] = {}
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def tick(self) -> bool:
        """One scan; returns True while some files are still settling."""
        roots = [Path(f) for f in self._folders()]
        roots = [r for r in roots if r.is_dir()]
        if not roots:
            self._pending.clear()
            return False
        files: dict[str, Signature] = {}
        for path in scan(roots):
            try:
                st = path.stat()
            except OSError:
                continue
            files[str(path)] = (st.st_size, st.st_mtime)
        known = self._known()
        candidates = {
            p: sig
            for p, sig in files.items()
            if known.get(p) != sig and self._attempted.get(p) != sig
        }
        stable = [p for p, sig in candidates.items() if self._pending.get(p) == sig]
        self._pending = {p: sig for p, sig in candidates.items() if p not in stable}
        if stable:
            for p in stable:
                self._attempted[p] = candidates[p]
            self._start_import([Path(p) for p in sorted(stable)])
        # Forget attempts for files that are gone.
        self._attempted = {p: s for p, s in self._attempted.items() if p in files}
        return bool(self._pending)

    # ---- background thread ----

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="folder-watcher", daemon=True)
            self._thread.start()

    def poke(self) -> None:
        """Scan now (e.g. after the watched folders changed)."""
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        delay = 0.0
        while not self._stop.is_set():
            self._wake.wait(delay)
            self._wake.clear()
            if self._stop.is_set():
                return
            try:
                settling = self.tick()
            except Exception:  # never let a bad folder kill the watcher
                log.exception("watched folder scan failed")
                settling = False
            delay = min(SETTLE_DELAY, self.interval) if settling else self.interval
