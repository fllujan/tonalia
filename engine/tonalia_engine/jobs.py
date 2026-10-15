"""Background jobs (SPEC 1.3): long work returns ``{jobId}`` at once.

Progress is reported through ``progress`` notifications (throttled so a big import does
not flood the UI) and completion through a ``job.finished`` event. Cancellation is
cooperative: jobs check :meth:`JobContext.check_cancelled` between units of work.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Protocol

from pydantic import BaseModel

from .errors import classify
from .rpc_schema import EventParams, JobFinished, ProgressParams

log = logging.getLogger(__name__)


class Notifier(Protocol):
    def notify(self, method: str, params: Any) -> None: ...


class JobCancelled(Exception):  # noqa: N818 - control-flow signal, not an error
    pass


class JobContext:
    def __init__(self, job_id: str, notifier: Notifier, min_interval: float = 0.1) -> None:
        self.job_id = job_id
        self._notifier = notifier
        self._cancel = threading.Event()
        self._min_interval = min_interval
        self._last_emit = 0.0

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def cancel(self) -> None:
        self._cancel.set()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise JobCancelled

    def progress(
        self,
        stage: str,
        percent: float,
        *,
        track_id: int | None = None,
        done: int | None = None,
        total: int | None = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if not force and now - self._last_emit < self._min_interval:
            return
        self._last_emit = now
        self._notifier.notify(
            "progress",
            ProgressParams(
                job_id=self.job_id,
                track_id=track_id,
                stage=stage,
                percent=round(max(0.0, min(100.0, percent)), 2),
                done=done,
                total=total,
            ),
        )


JobFn = Callable[[JobContext], BaseModel | None]


class JobManager:
    def __init__(self, notifier: Notifier, max_workers: int = 2) -> None:
        self._notifier = notifier
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="job")
        self._jobs: dict[str, JobContext] = {}
        self._lock = threading.Lock()

    def start(self, kind: str, fn: JobFn) -> str:
        job_id = uuid.uuid4().hex[:12]
        ctx = JobContext(job_id, self._notifier)
        with self._lock:
            self._jobs[job_id] = ctx
        self._pool.submit(self._run, kind, ctx, fn)
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            ctx = self._jobs.get(job_id)
        if ctx is None:
            return False
        ctx.cancel()
        return True

    def shutdown(self) -> None:
        with self._lock:
            for ctx in self._jobs.values():
                ctx.cancel()
        self._pool.shutdown(wait=True, cancel_futures=True)

    def _run(self, kind: str, ctx: JobContext, fn: JobFn) -> None:
        finished: JobFinished
        try:
            result = fn(ctx)
            payload = None if result is None else result.model_dump(mode="json", by_alias=True)
            status = "cancelled" if ctx.cancelled else "done"
            finished = JobFinished(job_id=ctx.job_id, kind=kind, status=status, result=payload)
        except JobCancelled:
            finished = JobFinished(job_id=ctx.job_id, kind=kind, status="cancelled")
        except Exception as exc:
            info = classify(exc)
            if info.reason == "internal":
                log.exception("job %s (%s) failed", ctx.job_id, kind)
            else:
                log.warning("job %s (%s) failed (%s): %s", ctx.job_id, kind, info.reason, exc)
            finished = JobFinished(
                job_id=ctx.job_id, kind=kind, status="failed", error=str(exc), error_info=info
            )
        finally:
            with self._lock:
                self._jobs.pop(ctx.job_id, None)
        self._notifier.notify(
            "event",
            EventParams(
                type="job.finished", payload=finished.model_dump(mode="json", by_alias=True)
            ),
        )
