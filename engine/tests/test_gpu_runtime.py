"""Optional CUDA runtime for stems on Windows (SPEC 11.2)."""

from __future__ import annotations

import hashlib
import importlib
import io
import json
import re
import sys
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from tonalia_engine import gpu_runtime as gr
from tonalia_engine.jobs import JobCancelled, JobContext

ENGINE = Path(__file__).resolve().parents[1]

SMI = "NVIDIA GeForce RTX 3060, 566.36, 8.6\n"


class Notes:
    def __init__(self) -> None:
        self.items: list[tuple[str, float]] = []

    def notify(self, method: str, params: object) -> None:
        self.items.append((getattr(params, "stage", ""), getattr(params, "percent", 0.0)))


def job() -> JobContext:
    return JobContext("j1", Notes(), min_interval=0.0)


def wheel(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


WHEEL = wheel(
    {
        "torch/__init__.py": b"VALUE = 'cuda build'\n",
        "torch/lib/torch_cuda.dll": b"dll" * 100,
        "torch/lib/torch_cuda.lib": b"import library",
        "torch/include/c10/core.h": b"header",
        "functorch/__init__.py": b"",
        "torchgen/__init__.py": b"",
        "torch-2.11.0+cu126.dist-info/METADATA": b"Name: torch\n",
    }
)


def fake_build(payload: bytes = WHEEL) -> gr.Build:
    return gr.Build("cu126", len(payload), hashlib.sha256(payload).hexdigest(), 5.0, (560, 76))


class Server:
    """Serves ``payload``; honours ``Range`` unless ``ranges`` is False."""

    def __init__(self, payload: bytes, *, ranges: bool = True, fail_after: int | None = None):
        self.payload = payload
        self.ranges = ranges
        self.fail_after = fail_after
        self.offsets: list[int] = []

    def __call__(self, url: str, offset: int) -> tuple[io.BytesIO, bool]:
        self.offsets.append(offset)
        resumed = self.ranges and offset > 0
        data = self.payload[offset:] if resumed else self.payload
        if self.fail_after is not None:
            data = data[: self.fail_after]
            self.fail_after = None
        return io.BytesIO(data), resumed


def ok_probe(directory: Path) -> gr.ProbeResult:
    return gr.ProbeResult(ok=True, device="NVIDIA GeForce RTX 3060", detail=None)


@pytest.fixture
def windows(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(gr, "platform", lambda: "win32")
    monkeypatch.setattr(gr, "free_bytes", lambda path: 50 * 1024**3)
    monkeypatch.setattr(gr, "_ACTIVE", None)
    monkeypatch.setattr(gr, "_ACTIVE_ROOT", None)
    yield


def runtime(tmp_path: Path, smi: str | None = SMI, build: gr.Build | None = None) -> gr.GpuRuntime:
    return gr.GpuRuntime(
        tmp_path,
        smi=lambda: smi,
        builds=(build or fake_build(),),
        torch_loaded=lambda: False,
    )


# ---- detection ----


def test_parses_nvidia_smi_and_keeps_the_most_capable_gpu() -> None:
    gpu = gr.parse_nvidia_smi("Quadro P400, 552.22, 6.1\nNVIDIA GeForce RTX 4070, 572.16, 8.9\n")
    assert gpu == gr.Gpu("NVIDIA GeForce RTX 4070", "572.16", 8.9)
    assert gr.parse_nvidia_smi("") is None
    assert gr.parse_nvidia_smi("garbage\n") is None


def test_picks_the_build_for_the_gpu() -> None:
    assert gr.pick_build(gr.Gpu("RTX 3060", "566.36", 8.6)).tag == "cu126"
    assert gr.pick_build(gr.Gpu("RTX 5080", "576.02", 12.0)).tag == "cu128"
    assert gr.pick_build(gr.Gpu("GeForce GTX 680", "472.12", 3.0)) is None


def test_driver_versions_compare_numerically() -> None:
    assert gr.driver_ok("566.36", (560, 76))
    assert gr.driver_ok("560.76", (560, 76))
    assert not gr.driver_ok("552.22", (560, 76))
    assert not gr.driver_ok("bad", (560, 76))


def test_builds_match_the_bundled_torch() -> None:
    """The runtime replaces the torch the Windows engine is built with: same version."""
    lock = (ENGINE / "uv.lock").read_text(encoding="utf-8")
    versions = re.findall(r'name = "torch"\nversion = "([^"]+)"', lock)
    assert gr.TORCH_VERSION in versions
    for b in gr.BUILDS:
        assert b.url.startswith(gr.BASE_URL)
        assert f"torch-{gr.TORCH_VERSION}%2B{b.tag}-cp311-cp311-win_amd64.whl" in b.url
        assert len(b.sha256) == 64 and b.size > 2 * 1024**3


def test_not_offered_without_windows_or_nvidia(tmp_path: Path, windows: None) -> None:
    assert runtime(tmp_path, smi=None).status() is None
    assert runtime(tmp_path, smi="GeForce GTX 680, 472.12, 3.0\n").status() is None


def test_not_offered_on_macos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gr, "platform", lambda: "darwin")
    assert runtime(tmp_path).status() is None


def test_status_before_download(tmp_path: Path, windows: None) -> None:
    s = runtime(tmp_path).status()
    assert s is not None
    assert s.state == "not_installed"
    assert s.gpu.name == "NVIDIA GeForce RTX 3060"
    assert s.total_bytes == len(WHEEL)
    assert s.downloaded_bytes == 0
    assert not s.restart_required


def test_old_driver_asks_for_an_update(tmp_path: Path, windows: None) -> None:
    s = runtime(tmp_path, smi="NVIDIA GeForce RTX 3060, 531.18, 8.6\n").status()
    assert s is not None and s.state == "driver_too_old" and s.min_driver == "560.76"
    with pytest.raises(gr.GpuRuntimeError):
        runtime(tmp_path, smi="NVIDIA GeForce RTX 3060, 531.18, 8.6\n").download(job())


# ---- download and install ----


def test_download_installs_probes_and_activates(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    activated: list[Path] = []
    monkeypatch.setattr(gr, "install_finder", lambda directory: activated.append(directory))
    rt = runtime(tmp_path)
    s = rt.download(job(), opener=Server(WHEEL), prober=ok_probe)
    assert s.state == "active"
    assert not s.restart_required
    installed = gr.runtime_root(tmp_path) / "cu126-2.11.0"
    assert (installed / "torch" / "__init__.py").is_file()
    assert (installed / "torch" / "lib" / "torch_cuda.dll").is_file()
    assert (installed / "functorch").is_dir()
    # Headers, import libraries, codegen and metadata are not needed to run.
    assert not (installed / "torch" / "include").exists()
    assert not (installed / "torch" / "lib" / "torch_cuda.lib").exists()
    assert not (installed / "torchgen").exists()
    # The wheel itself is gone once installed.
    assert not list(gr.runtime_root(tmp_path).glob("*.whl*"))
    assert activated == [installed]
    assert s.installed_bytes > 0
    assert s.gpu.name == "NVIDIA GeForce RTX 3060"


def test_installed_while_torch_is_loaded_needs_a_restart(tmp_path: Path, windows: None) -> None:
    rt = gr.GpuRuntime(tmp_path, smi=lambda: SMI, builds=(fake_build(),), torch_loaded=lambda: True)
    s = rt.download(job(), opener=Server(WHEEL), prober=ok_probe)
    assert s.state == "installed" and s.restart_required


def test_download_resumes_after_cancel(tmp_path: Path, windows: None) -> None:
    ctx = job()
    server = Server(WHEEL, fail_after=len(WHEEL) // 2)
    rt = runtime(tmp_path)

    def cancel_at_eof(url: str, offset: int) -> tuple[io.BytesIO, bool]:
        body, resumed = server(url, offset)
        ctx.cancel()  # the user cancels mid-download
        return body, resumed

    with pytest.raises(JobCancelled):
        rt.download(ctx, opener=cancel_at_eof, prober=ok_probe)
    s = rt.status()
    assert s is not None and 0 < s.downloaded_bytes < len(WHEEL)
    s = rt.download(job(), opener=server, prober=ok_probe)
    assert server.offsets == [0, len(WHEEL) // 2]
    assert s.state in {"active", "installed"}


def test_download_restarts_when_the_server_ignores_ranges(tmp_path: Path, windows: None) -> None:
    part = gr.runtime_root(tmp_path) / f"{fake_build().filename}.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(WHEEL[:100])
    s = runtime(tmp_path).download(job(), opener=Server(WHEEL, ranges=False), prober=ok_probe)
    assert s.state in {"active", "installed"}


def test_corrupt_download_is_discarded(tmp_path: Path, windows: None) -> None:
    bad = bytearray(WHEEL)
    bad[10] ^= 0xFF
    rt = runtime(tmp_path)
    with pytest.raises(gr.GpuRuntimeError, match="checksum"):
        rt.download(job(), opener=Server(bytes(bad)), prober=ok_probe)
    assert not list(gr.runtime_root(tmp_path).glob("*.part"))


def test_refuses_without_disk_space(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(gr, "free_bytes", lambda path: 1024)
    with pytest.raises(gr.GpuRuntimeError, match="space"):
        runtime(tmp_path).download(job(), opener=Server(WHEEL), prober=ok_probe)


def test_rejects_paths_outside_the_runtime(tmp_path: Path, windows: None) -> None:
    evil = wheel({"torch/__init__.py": b"", "torch/../../escape.py": b"x"})
    with pytest.raises(gr.GpuRuntimeError):
        runtime(tmp_path, build=fake_build(evil)).download(
            job(), opener=Server(evil), prober=ok_probe
        )
    assert not (tmp_path / "escape.py").exists()


def test_failed_probe_falls_back_to_cpu(tmp_path: Path, windows: None) -> None:
    rt = runtime(tmp_path)
    s = rt.download(
        job(),
        opener=Server(WHEEL),
        prober=lambda d: gr.ProbeResult(ok=False, device=None, detail="no CUDA device"),
    )
    assert s.state == "failed" and s.detail == "no CUDA device"
    assert gr.activate(tmp_path) is False


# ---- start-up, removal, crash guard ----


def install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> gr.GpuRuntime:
    monkeypatch.setattr(gr, "install_finder", lambda directory: None)
    rt = gr.GpuRuntime(tmp_path, smi=lambda: SMI, builds=(fake_build(),), torch_loaded=lambda: True)
    rt.download(job(), opener=Server(WHEEL), prober=ok_probe)
    return rt


def test_activates_at_start_up(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch)
    seen: list[Path] = []
    monkeypatch.setattr(gr, "install_finder", lambda directory: seen.append(directory))
    assert gr.activate(tmp_path) is True
    assert seen == [gr.runtime_root(tmp_path) / "cu126-2.11.0"]
    assert runtime(tmp_path).status().state == "active"  # type: ignore[union-attr]


def test_a_runtime_for_another_torch_is_dropped(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch)
    state = gr.runtime_root(tmp_path) / "state.json"
    data = json.loads(state.read_text(encoding="utf-8"))
    data["version"] = "2.10.0"
    state.write_text(json.dumps(data), encoding="utf-8")
    assert gr.activate(tmp_path) is False
    assert not (gr.runtime_root(tmp_path) / "cu126-2.11.0").exists()
    assert runtime(tmp_path).status().state == "not_installed"  # type: ignore[union-attr]


def test_a_crash_while_loading_disables_it(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(tmp_path, monkeypatch)
    assert gr.activate(tmp_path)
    gr.mark_loading(tmp_path, True)  # the engine died while importing the CUDA torch
    monkeypatch.setattr(gr, "_ACTIVE", None)
    assert gr.activate(tmp_path) is False
    s = runtime(tmp_path).status()
    assert s is not None and s.state == "failed" and s.detail


def test_remove_now_or_at_next_start(
    tmp_path: Path, windows: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt = install(tmp_path, monkeypatch)
    s = rt.remove()
    assert s is not None and s.state == "not_installed" and not s.restart_required
    assert not gr.runtime_root(tmp_path).exists()

    rt = install(tmp_path, monkeypatch)
    assert gr.activate(tmp_path)
    s = rt.remove()  # in use by this process: Windows keeps its DLLs locked
    assert s is not None and s.state == "not_installed" and s.restart_required
    monkeypatch.setattr(gr, "_ACTIVE", None)
    assert gr.activate(tmp_path) is False
    assert not gr.runtime_root(tmp_path).exists()


def test_remove_discards_a_partial_download(tmp_path: Path, windows: None) -> None:
    part = gr.runtime_root(tmp_path) / f"{fake_build().filename}.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(b"x" * 10)
    runtime(tmp_path).remove()
    assert not part.exists()


# ---- import redirection ----


def test_finder_loads_the_package_from_the_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg = tmp_path / "tonalia_fake_torch"
    (pkg / "sub").mkdir(parents=True)
    (pkg / "__init__.py").write_text("WHERE = 'runtime'\n", encoding="utf-8")
    (pkg / "sub" / "__init__.py").write_text("WHERE = 'runtime sub'\n", encoding="utf-8")
    finder = gr.RuntimeFinder(tmp_path, roots=("tonalia_fake_torch",))
    monkeypatch.setattr(sys, "meta_path", [finder, *sys.meta_path])
    try:
        mod = importlib.import_module("tonalia_fake_torch")
        sub = importlib.import_module("tonalia_fake_torch.sub")
        assert mod.WHERE == "runtime" and sub.WHERE == "runtime sub"
        assert finder.find_spec("json", None) is None  # everything else is untouched
    finally:
        for name in ("tonalia_fake_torch.sub", "tonalia_fake_torch"):
            sys.modules.pop(name, None)


def test_probe_command_uses_the_engine_itself(tmp_path: Path) -> None:
    cmd = gr.probe_command(tmp_path)
    assert cmd[-2:] == [gr.PROBE_FLAG, str(tmp_path)]
    assert cmd[0] == sys.executable


def test_probe_reads_the_child_answer(tmp_path: Path) -> None:
    def run(cmd: list[str]) -> tuple[int, str, str]:
        line = json.dumps({"ok": True, "device": "RTX", "file": str(tmp_path / "torch" / "x")})
        return 0, f"noise\n{line}\n", ""

    assert gr.probe(tmp_path, run=run) == gr.ProbeResult(ok=True, device="RTX", detail=None)

    def wrong_torch(cmd: list[str]) -> tuple[int, str, str]:
        return 0, json.dumps({"ok": True, "device": "RTX", "file": "C:/bundled/torch"}), ""

    assert not gr.probe(tmp_path, run=wrong_torch).ok

    def crash(cmd: list[str]) -> tuple[int, str, str]:
        return -11, "", "DLL load failed"

    res = gr.probe(tmp_path, run=crash)
    assert not res.ok and "DLL load failed" in (res.detail or "")


def test_probe_runs_a_real_engine_process(tmp_path: Path) -> None:
    """End to end on a machine without the runtime: the child answers, and says no."""
    res = gr.probe(tmp_path)
    assert not res.ok and res.detail
