"""Parallel analysis queue (SPEC 2.4/2.14).

One background job drains a queue of track ids with a process pool (N = cores - 1 by
default): analysis is CPU-bound, so processes — not threads — give real parallelism.
Requests made while a job runs are appended to the same queue. Workers report their
current stage through a multiprocessing queue; a listener thread turns that into
``progress`` notifications. A corrupt file marks only its own track as ``error``; if a
worker process crashes, the pool is rebuilt and that track is retried once.
"""

from __future__ import annotations

import json
import logging
import multiprocessing as mp
import os
import queue as queue_mod
import sys
import threading
from collections import deque
from concurrent.futures import FIRST_COMPLETED, Future, ProcessPoolExecutor, wait
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..cues import refresh_auto_cues, save_segments
from ..db import Database
from ..jobs import JobContext, JobManager, Notifier
from ..rpc_schema import AnalysisSummary, AnalysisTrackDone, EventParams
from .pipeline import ANALYSIS_VERSION, AnalysisSettings, analyze_file

# analysis columns owned by each user-editable field (see ``Library.update``).
PROTECTED_COLUMNS: dict[str, tuple[str, ...]] = {
    "key": ("key_root", "key_mode", "key_confidence"),
    "bpm": ("bpm", "bpm_confidence"),
    "energy": ("energy",),
}

log = logging.getLogger(__name__)

_STAGE_QUEUE: Any = None  # set in each worker by _init_worker


def _init_worker(stage_queue: Any) -> None:
    global _STAGE_QUEUE
    _STAGE_QUEUE = stage_queue
    # Workers inherit the engine's stdout, which carries JSON-RPC: never write to it.
    sys.stdout = sys.stderr


def _work(
    track_id: int, path: str, genre: str | None, settings: AnalysisSettings
) -> dict[str, Any]:
    def report(stage: str) -> None:
        if _STAGE_QUEUE is not None:
            _STAGE_QUEUE.put((track_id, stage))

    return analyze_file(path, genre, settings, report)


def default_workers() -> int:
    return max(1, (os.cpu_count() or 2) - 1)


@dataclass
class _Item:
    track_id: int
    attempts: int = 0


class AnalysisQueue:
    def __init__(
        self,
        db_path: Path,
        jobs: JobManager,
        notifier: Notifier,
        workers: int | None = None,
    ) -> None:
        self._db_path = db_path
        self._jobs = jobs
        self._notifier = notifier
        self._workers = workers
        self._lock = threading.Lock()
        self._pending: deque[_Item] = deque()
        self._queued: set[int] = set()
        self._job_id: str | None = None
        self._total = 0
        self._done = 0

    @property
    def job_id(self) -> str | None:
        return self._job_id

    def enqueue(self, track_ids: list[int]) -> tuple[str | None, int]:
        """Queue tracks (duplicates ignored). Returns (job id, newly queued count)."""
        with self._lock:
            added = 0
            for tid in track_ids:
                if tid not in self._queued:
                    self._queued.add(tid)
                    self._pending.append(_Item(tid))
                    added += 1
            self._total += added
            if added and self._job_id is None:
                self._done = 0
                self._total = added
                self._job_id = self._jobs.start("analysis", self._run)
            return self._job_id, added

    # ---- job ----

    def _next(self) -> _Item | None:
        with self._lock:
            return self._pending.popleft() if self._pending else None

    def _settings(self, db: Database) -> tuple[AnalysisSettings, int]:
        lo, hi = db.get_setting("analysis.bpmRange", [70.0, 180.0])
        workers = int(db.get_setting("analysis.workers", 0) or 0) or self._workers
        return AnalysisSettings(min_bpm=float(lo), max_bpm=float(hi)), workers or default_workers()

    def _run(self, ctx: JobContext) -> AnalysisSummary:
        db = Database.open(self._db_path)
        settings, workers = self._settings(db)
        spawn = mp.get_context("spawn")
        stages: Any = spawn.Queue()
        stop = threading.Event()
        summary = AnalysisSummary()

        def listen() -> None:
            while not stop.is_set():
                try:
                    track_id, stage = stages.get(timeout=0.2)
                except (queue_mod.Empty, EOFError, OSError):
                    continue
                with self._lock:
                    done, total = self._done, self._total
                ctx.progress(stage, done / max(total, 1) * 100, track_id=track_id, done=done,
                             total=total)  # fmt: skip

        listener = threading.Thread(target=listen, name="analysis-stages", daemon=True)
        listener.start()

        def new_pool() -> ProcessPoolExecutor:
            return ProcessPoolExecutor(
                max_workers=workers, mp_context=spawn, initializer=_init_worker, initargs=(stages,)
            )

        pool = new_pool()
        running: dict[Future[dict[str, Any]], _Item] = {}
        try:
            while True:
                if ctx.cancelled:
                    break
                while len(running) < workers * 2 and (item := self._next()) is not None:
                    row = db.conn.execute(
                        "SELECT path, genre FROM tracks WHERE id = ?", (item.track_id,)
                    ).fetchone()
                    if row is None:  # removed from the library meanwhile
                        self._finish(item.track_id)
                        continue
                    db.conn.execute(
                        "UPDATE tracks SET status = 'analyzing', error = NULL WHERE id = ?",
                        (item.track_id,),
                    )
                    try:
                        fut = pool.submit(_work, item.track_id, row["path"], row["genre"], settings)
                    except BrokenProcessPool:
                        pool = new_pool()
                        fut = pool.submit(_work, item.track_id, row["path"], row["genre"], settings)
                    running[fut] = item
                if not running:
                    # Exit atomically with enqueue(): a request arriving now either sees
                    # this job still running (and is picked up) or starts a new one.
                    with self._lock:
                        if not self._pending:
                            self._job_id = None
                            break
                    continue
                finished, _ = wait(list(running), timeout=0.25, return_when=FIRST_COMPLETED)
                for fut in finished:
                    item = running.pop(fut)
                    try:
                        result = fut.result()
                    except BrokenProcessPool:
                        pool.shutdown(wait=False, cancel_futures=True)
                        pool = new_pool()
                        if item.attempts == 0:
                            item.attempts += 1
                            with self._lock:
                                self._pending.appendleft(item)
                            continue
                        self._save_error(db, item.track_id, "analysis process crashed")
                        summary.failed += 1
                    except Exception as exc:
                        self._save_error(db, item.track_id, str(exc) or type(exc).__name__)
                        summary.failed += 1
                    else:
                        self._save(db, item.track_id, result)
                        summary.analyzed += 1
                    self._finish(item.track_id)
                    with self._lock:
                        done, total = self._done, self._total
                    ctx.progress("done", done / max(total, 1) * 100, track_id=item.track_id,
                                 done=done, total=total)  # fmt: skip
        finally:
            if ctx.cancelled or running:
                for fut, item in running.items():
                    fut.cancel()
                    db.conn.execute(
                        "UPDATE tracks SET status = 'pending' "
                        "WHERE id = ? AND status = 'analyzing'",
                        (item.track_id,),
                    )
                with self._lock:
                    summary.cancelled = len(self._pending) + len(running)
                    self._pending.clear()
                    self._queued.clear()
            pool.shutdown(wait=True, cancel_futures=True)
            stop.set()
            listener.join(timeout=2)
            with self._lock:
                if self._job_id == ctx.job_id:
                    self._job_id = None
            db.close()
        return summary

    def _finish(self, track_id: int) -> None:
        with self._lock:
            self._queued.discard(track_id)
            self._done += 1

    def _emit_done(self, track_id: int, status: str, error: str | None) -> None:
        payload = AnalysisTrackDone(track_id=track_id, status=status, error=error)
        self._notifier.notify(
            "event",
            EventParams(type="analysis.trackDone", payload=payload.model_dump(by_alias=True)),
        )

    def _save(self, db: Database, track_id: int, row: dict[str, Any]) -> None:
        segments = row.pop("_segments", [])
        # Fields the user edited by hand are never overwritten (SPEC 2.14).
        edited = db.conn.execute(
            "SELECT edited_fields FROM analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        for name in json.loads(edited[0]) if edited else []:
            for col in PROTECTED_COLUMNS.get(name, ()):
                row.pop(col, None)
        cols = ", ".join(row)
        marks = ", ".join(f":{c}" for c in row)
        updates = ", ".join(f"{c} = excluded.{c}" for c in row)
        db.conn.execute("BEGIN")
        try:
            db.conn.execute(
                f"INSERT INTO analysis (track_id, {cols}) VALUES (:track_id, {marks}) "
                f"ON CONFLICT(track_id) DO UPDATE SET {updates}",
                {**row, "track_id": track_id},
            )
            db.conn.execute(
                "UPDATE tracks SET status = 'ready', error = NULL, analysis_version = ?, "
                "analyzed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                (ANALYSIS_VERSION, track_id),
            )
            save_segments(db, track_id, segments)
            refresh_auto_cues(db, track_id)
            db.conn.execute("COMMIT")
        except BaseException:
            db.conn.execute("ROLLBACK")
            raise
        self._emit_done(track_id, "ready", None)

    def _save_error(self, db: Database, track_id: int, reason: str) -> None:
        log.warning("analysis failed for track %s: %s", track_id, reason)
        db.conn.execute(
            "UPDATE tracks SET status = 'error', error = ? WHERE id = ?", (reason, track_id)
        )
        self._emit_done(track_id, "error", reason)


def recover_interrupted(db: Database) -> int:
    """Tracks left 'analyzing' by a crash or forced quit go back to 'pending'."""
    return db.conn.execute(
        "UPDATE tracks SET status = 'pending' WHERE status = 'analyzing'"
    ).rowcount
