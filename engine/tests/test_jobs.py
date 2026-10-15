import threading
import time
from typing import Any

from tonalia_engine.jobs import JobContext, JobManager
from tonalia_engine.rpc_schema import AddPathsResult, EventParams, ProgressParams


class Recorder:
    def __init__(self) -> None:
        self.messages: list[tuple[str, Any]] = []
        self.finished = threading.Event()

    def notify(self, method: str, params: Any) -> None:
        self.messages.append((method, params))
        if isinstance(params, EventParams) and params.type == "job.finished":
            self.finished.set()

    def final(self) -> dict[str, Any]:
        assert self.finished.wait(5)
        payload: dict[str, Any] = [p for m, p in self.messages if m == "event"][-1].payload
        return payload


def test_job_reports_progress_and_result() -> None:
    rec = Recorder()
    jobs = JobManager(rec)

    def work(ctx: JobContext) -> AddPathsResult:
        for i in range(3):
            ctx.progress("importing", (i + 1) / 3 * 100, done=i + 1, total=3, force=True)
        return AddPathsResult(added=3)

    job_id = jobs.start("library.addPaths", work)
    final = rec.final()
    assert final == {
        "jobId": job_id,
        "kind": "library.addPaths",
        "status": "done",
        "result": {"added": 3, "updated": 0, "moved": 0, "unchanged": 0, "duplicates": 0,
                   "failed": []},
        "error": None,
        "errorInfo": None,
    }  # fmt: skip
    progress = [p for m, p in rec.messages if m == "progress"]
    assert [p.done for p in progress] == [1, 2, 3]
    assert all(isinstance(p, ProgressParams) and p.job_id == job_id for p in progress)
    jobs.shutdown()


def test_progress_is_throttled() -> None:
    rec = Recorder()
    ctx = JobContext("j", rec, min_interval=10)
    for i in range(100):
        ctx.progress("x", i)
    assert len(rec.messages) == 1


def test_cancel() -> None:
    rec = Recorder()
    jobs = JobManager(rec)
    started = threading.Event()

    def work(ctx: JobContext) -> None:
        started.set()
        while True:
            ctx.check_cancelled()
            time.sleep(0.01)

    job_id = jobs.start("slow", work)
    assert started.wait(5)
    assert jobs.cancel(job_id)
    assert rec.final()["status"] == "cancelled"
    assert not jobs.cancel(job_id)  # already gone
    jobs.shutdown()


def test_failure_is_reported() -> None:
    rec = Recorder()
    jobs = JobManager(rec)

    def work(ctx: JobContext) -> None:
        raise ValueError("disco lleno")

    jobs.start("boom", work)
    final = rec.final()
    assert final["status"] == "failed"
    assert final["error"] == "disco lleno"
    jobs.shutdown()
