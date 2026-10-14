"""Optional CUDA build of PyTorch for stems on Windows (SPEC 11.2).

The Windows engine ships the CPU build of PyTorch (PyPI's). With a compatible NVIDIA GPU,
Settings → Stems offers the CUDA build of the *same* PyTorch version (about 2.5 GB, from
download.pytorch.org, which also bundles the CUDA and cuDNN libraries it needs):

- Download: resumable (HTTP ``Range``; a cancelled or interrupted download keeps its
  ``.part``), checked against the size and SHA-256 pinned below.
- Install: only ``torch/`` and ``functorch/`` are unpacked (no headers or import
  libraries) into ``<data>/runtimes/torch-cuda/<build>-<version>``, then a separate
  engine process imports it and runs a few operations on the GPU (``--gpu-probe``).
- Use: at start-up, a finder placed first on ``sys.meta_path`` loads ``torch`` from that
  folder instead of the bundled one (PyTorch is only ever imported lazily, so this happens
  before any import). The pure-Python dependencies are the same for both builds.
- Falling back to the CPU: a failed probe, a crash while loading it (``loading`` stays set
  in ``state.json``) or a newer bundled PyTorch disables it; a GPU error during a
  separation is retried on the CPU (``stems.py``).
- Removal: immediate, or at the next start while this process holds its DLLs.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.abc
import importlib.machinery
import json
import logging
import os
import shutil
import subprocess
import sys
import zipfile
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import IO, Any, cast

from .jobs import JobContext
from .rpc_schema import GpuInfo, GpuRuntimeState, GpuRuntimeStatus

log = logging.getLogger(__name__)

# Must equal the torch the Windows engine is built with (uv.lock; checked by a test).
TORCH_VERSION = "2.11.0"
BASE_URL = "https://download.pytorch.org/whl/"
ROOTS: tuple[str, ...] = ("torch", "functorch")
PROBE_FLAG = "--gpu-probe"
CHUNK = 1 << 20
# Unpacked size relative to the wheel (measured: 4.1 GB unpacked from 2.6 GB, before
# dropping headers and import libraries), plus a margin, for the free space check.
UNPACK_RATIO = 1.6
MARGIN = 512 * 1024**2
STATE = "state.json"

_NO_WINDOW = 0x0800_0000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW


class GpuRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Build:
    tag: str  # CUDA flavour of the wheel ("cu126")
    size: int
    sha256: str
    min_compute: float  # lowest compute capability the build supports
    min_driver: tuple[int, int]  # NVIDIA driver for its CUDA version on Windows

    @property
    def filename(self) -> str:
        return f"torch-{TORCH_VERSION}+{self.tag}-cp311-cp311-win_amd64.whl"

    @property
    def url(self) -> str:
        return f"{BASE_URL}{self.tag}/torch-{TORCH_VERSION}%2B{self.tag}-cp311-cp311-win_amd64.whl"

    @property
    def folder(self) -> str:
        return f"{self.tag}-{TORCH_VERSION}"


# CUDA 12.6 covers Maxwell to Hopper (compute 5.0-9.0); Blackwell (RTX 50) needs 12.8.
BUILDS: tuple[Build, ...] = (
    Build(
        "cu128",
        2_753_148_611,
        "90ef0c2454e5296a9fb021ddd42252e4ce1abe2c0a4988a173ef90a6cded0bf5",
        10.0,
        (570, 65),
    ),
    Build(
        "cu126",
        2_596_413_186,
        "ce9aeead7950ae8eb48891568f9314a9a4130996b55e797c75e0c0d2846714ae",
        5.0,
        (560, 76),
    ),
)


def platform() -> str:  # replaced in tests
    return sys.platform


def free_bytes(path: Path) -> int:
    for p in (path, *path.parents):
        if p.exists():
            return shutil.disk_usage(p).free
    return 0


def runtime_root(data_dir: Path) -> Path:
    return data_dir / "runtimes" / "torch-cuda"


# ---- GPU detection ----


@dataclass(frozen=True)
class Gpu:
    name: str
    driver: str
    compute: float


def parse_nvidia_smi(text: str) -> Gpu | None:
    """``name, driver_version, compute_cap`` lines; the most capable GPU wins."""
    gpus = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.rsplit(",", 2)]
        if len(parts) != 3:
            continue
        try:
            gpus.append(Gpu(parts[0], parts[1], float(parts[2])))
        except ValueError:
            continue
    return max(gpus, key=lambda g: g.compute, default=None)


@lru_cache(maxsize=1)
def run_nvidia_smi() -> str | None:
    """Output of ``nvidia-smi`` (installed with the NVIDIA driver), None without one."""
    exe = shutil.which("nvidia-smi")
    if exe is None:
        candidate = (
            Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
        )
        exe = str(candidate) if candidate.is_file() else None
    if exe is None:
        return None
    try:
        proc = subprocess.run(
            [exe, "--query-gpu=name,driver_version,compute_cap", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=15,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return proc.stdout if proc.returncode == 0 else None


def pick_build(gpu: Gpu, builds: Sequence[Build] = BUILDS) -> Build | None:
    for build in sorted(builds, key=lambda b: -b.min_compute):
        if gpu.compute >= build.min_compute:
            return build
    return None


def driver_ok(driver: str, minimum: tuple[int, int]) -> bool:
    try:
        major, _, minor = driver.partition(".")
        return (int(major), int(minor or 0)) >= minimum
    except ValueError:
        return False


# ---- state ----


def _read_state(root: Path) -> dict[str, Any]:
    try:
        data = json.loads((root / STATE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_state(root: Path, state: dict[str, Any]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / f"{STATE}.tmp"
    tmp.write_text(json.dumps(state), encoding="utf-8")
    tmp.replace(root / STATE)


def _update_state(root: Path, **changes: Any) -> None:
    state = _read_state(root)
    if state:
        _write_state(root, {**state, **changes})


def mark_loading(data_dir: Path, loading: bool) -> None:
    _update_state(runtime_root(data_dir), loading=loading)


def _remove_tree(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


# ---- import redirection ----


class RuntimeFinder(importlib.abc.MetaPathFinder):
    """Finds ``roots`` (and their submodules) in ``directory`` before any other finder,
    including PyInstaller's, which would otherwise serve the bundled build."""

    def __init__(self, directory: Path, roots: Sequence[str] = ROOTS) -> None:
        self.directory = directory
        self.roots = tuple(roots)

    def find_spec(
        self, fullname: str, path: Sequence[str] | None, target: ModuleType | None = None
    ) -> importlib.machinery.ModuleSpec | None:
        root = fullname.partition(".")[0]
        if root not in self.roots:
            return None
        search = [str(self.directory)] if root == fullname else path
        return importlib.machinery.PathFinder.find_spec(fullname, search)


_ACTIVE: Path | None = None  # runtime folder this process imports torch from
_ACTIVE_ROOT: Path | None = None


def install_finder(directory: Path) -> None:
    sys.meta_path.insert(0, RuntimeFinder(directory))


def _use(root: Path, directory: Path) -> None:
    global _ACTIVE, _ACTIVE_ROOT
    install_finder(directory)
    _ACTIVE, _ACTIVE_ROOT = directory, root
    log.info("stems: using the CUDA build of PyTorch in %s", directory)


def active() -> bool:
    return _ACTIVE is not None


@contextlib.contextmanager
def loading_torch() -> Iterator[None]:
    """Wrap the first ``import torch``: a crash inside leaves ``loading`` set, and the next
    start goes back to the CPU build; an exception disables the runtime for next time."""
    root = _ACTIVE_ROOT if _ACTIVE is not None and "torch" not in sys.modules else None
    if root is not None:
        _update_state(root, loading=True)
    try:
        yield
    except Exception as exc:
        if root is not None:
            _update_state(root, loading=False, probe_ok=False, detail=f"{exc}")
        raise
    if root is not None:
        _update_state(root, loading=False)


def activate(data_dir: Path) -> bool:
    """At start-up, before anything imports torch: use the installed runtime if it is
    valid. Also finishes a removal left for this start."""
    root = runtime_root(data_dir)
    state = _read_state(root)
    if not state:
        return False
    if state.get("remove"):
        shutil.rmtree(root, ignore_errors=True)
        return False
    if platform() != "win32":
        return False
    if state.get("version") != TORCH_VERSION:
        log.info("stems: dropping the CUDA runtime for PyTorch %s", state.get("version"))
        shutil.rmtree(root, ignore_errors=True)
        return False
    if state.get("loading"):
        _write_state(
            root,
            {
                **state,
                "loading": False,
                "probe_ok": False,
                "detail": "the engine stopped while loading the GPU build of PyTorch",
            },
        )
        return False
    directory = root / str(state.get("folder", ""))
    if not state.get("probe_ok") or not (directory / "torch" / "__init__.py").is_file():
        return False
    _use(root, directory)
    return True


# ---- probe (separate process) ----


@dataclass(frozen=True)
class ProbeResult:
    ok: bool
    device: str | None
    detail: str | None


def probe_command(directory: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, PROBE_FLAG, str(directory)]
    return [sys.executable, "-m", "tonalia_engine", PROBE_FLAG, str(directory)]


def _run(cmd: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        creationflags=_NO_WINDOW,
    )
    return proc.returncode, proc.stdout, proc.stderr


def probe(directory: Path, run: Callable[[list[str]], tuple[int, str, str]] = _run) -> ProbeResult:
    try:
        code, out, err = run(probe_command(directory))
    except (OSError, subprocess.SubprocessError) as exc:
        return ProbeResult(False, None, str(exc))
    answer: dict[str, Any] | None = None
    for line in reversed(out.splitlines()):
        try:
            data = json.loads(line)
        except ValueError:
            continue
        if isinstance(data, dict) and "ok" in data:
            answer = data
            break
    if answer is None:
        lines = [line for line in err.strip().splitlines() if line.strip()]
        return ProbeResult(False, None, (lines[-1] if lines else f"exit code {code}")[:500])
    if not answer.get("ok"):
        return ProbeResult(False, None, str(answer.get("detail") or "CUDA is not available"))
    loaded = Path(str(answer.get("file", "")))
    if not loaded.resolve().is_relative_to(directory.resolve()):
        return ProbeResult(False, None, f"the bundled PyTorch was loaded instead ({loaded})")
    return ProbeResult(True, str(answer.get("device") or "") or None, None)


def run_probe(directory: Path) -> int:
    """Child side of :func:`probe`: import the runtime and use the GPU once."""
    install_finder(directory)
    out: dict[str, Any]
    try:
        import torch

        if not torch.cuda.is_available():
            out = {
                "ok": False,
                "detail": "CUDA is not available to PyTorch",
                "file": torch.__file__,
            }
        else:
            x = torch.ones(1, 2, 4096, device="cuda")
            w = torch.ones(4, 2, 9, device="cuda")
            y = torch.nn.functional.conv1d(x, w)  # loads cuDNN, as Demucs does
            float(y.sum().item())
            out = {"ok": True, "device": torch.cuda.get_device_name(0), "file": torch.__file__}
    except Exception as exc:
        out = {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(out), flush=True)
    return 0


# ---- download, install, status, removal ----

Opener = Callable[[str, int], tuple[IO[bytes], bool]]


def open_range(url: str, offset: int) -> tuple[IO[bytes], bool]:
    """GET ``url`` from ``offset``; returns the body and whether the server resumed."""
    import urllib.request

    if not url.startswith(BASE_URL):
        raise GpuRuntimeError(f"unexpected runtime URL: {url}")
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)
    return cast(IO[bytes], response), offset > 0 and response.status == 206


def _keep(name: str) -> bool:
    top = name.partition("/")[0]
    return top in ROOTS and not name.startswith("torch/include/") and not name.endswith(".lib")


class GpuRuntime:
    def __init__(
        self,
        data_dir: Path,
        *,
        smi: Callable[[], str | None] | None = None,
        builds: Sequence[Build] = BUILDS,
        torch_loaded: Callable[[], bool] = lambda: "torch" in sys.modules,
    ) -> None:
        self.root = runtime_root(data_dir)
        self._smi = smi or (lambda: run_nvidia_smi())
        self._builds = builds
        self._torch_loaded = torch_loaded

    def _target(self) -> tuple[Gpu, Build] | None:
        if platform() != "win32":
            return None
        text = self._smi()
        gpu = parse_nvidia_smi(text) if text else None
        build = pick_build(gpu, self._builds) if gpu else None
        return (gpu, build) if gpu and build else None

    def _part(self, build: Build) -> Path:
        return self.root / f"{build.filename}.part"

    def status(self) -> GpuRuntimeStatus | None:
        target = self._target()
        if target is None:
            return None
        gpu, build = target
        state = _read_state(self.root)
        part = self._part(build)
        installed = (
            state.get("version") == TORCH_VERSION
            and state.get("folder") == build.folder
            and (self.root / build.folder / "torch").is_dir()
        )
        restart = False
        detail: str | None = None
        name: GpuRuntimeState
        if state.get("remove"):
            name, restart = "not_installed", _ACTIVE is not None
        elif _ACTIVE is not None and installed:
            name = "active"
        elif installed and state.get("probe_ok"):
            name, restart = "installed", True
        elif installed:
            name, detail = "failed", str(state.get("detail") or "") or None
        elif not driver_ok(gpu.driver, build.min_driver):
            name = "driver_too_old"
        else:
            name = "not_installed"
        return GpuRuntimeStatus(
            gpu=GpuInfo(name=gpu.name, driver=gpu.driver),
            state=name,
            total_bytes=build.size,
            downloaded_bytes=part.stat().st_size if part.is_file() else 0,
            installed_bytes=int(state.get("bytes", 0)) if installed else 0,
            min_driver="{}.{:02d}".format(*build.min_driver),
            restart_required=restart,
            detail=detail,
        )

    def download(
        self,
        job: JobContext,
        opener: Opener | None = None,
        prober: Callable[[Path], ProbeResult] | None = None,
    ) -> GpuRuntimeStatus:
        target = self._target()
        if target is None:
            raise GpuRuntimeError("no compatible NVIDIA GPU was found")
        gpu, build = target
        if not driver_ok(gpu.driver, build.min_driver):
            raise GpuRuntimeError(
                f"NVIDIA driver {gpu.driver} is too old; {build.min_driver[0]}."
                f"{build.min_driver[1]:02d} or later is needed"
            )
        directory = self.root / build.folder
        if directory == _ACTIVE:  # removed and asked for again before restarting
            _update_state(self.root, remove=False)
            return cast(GpuRuntimeStatus, self.status())
        self._drop_stale(build)
        part = self._part(build)
        have = part.stat().st_size if part.is_file() else 0
        need = build.size - have + int(build.size * UNPACK_RATIO) + MARGIN
        if free_bytes(self.root) < need:
            raise GpuRuntimeError(f"not enough disk space: {need / 1024**3:.1f} GB are needed")
        self._fetch(build, part, job, opener or open_range)
        files = self._extract(part, directory, job)
        part.unlink(missing_ok=True)
        job.progress("check", 98.0, force=True)
        result = (prober or probe)(directory)
        _write_state(
            self.root,
            {
                "version": TORCH_VERSION,
                "folder": build.folder,
                "probe_ok": result.ok,
                "device": result.device,
                "detail": result.detail,
                "bytes": files,
                "loading": False,
            },
        )
        if result.ok and not self._torch_loaded():
            _use(self.root, directory)
        job.progress("check", 100.0, force=True)
        return cast(GpuRuntimeStatus, self.status())

    def _drop_stale(self, build: Build) -> None:
        """Remove what belongs to another build or version (never the partial download)."""
        self.root.mkdir(parents=True, exist_ok=True)
        keep = {self._part(build).name}
        for entry in self.root.iterdir():
            if entry.name not in keep:
                _remove_tree(entry)

    def _fetch(self, build: Build, part: Path, job: JobContext, opener: Opener) -> None:
        have = part.stat().st_size if part.is_file() else 0
        if have > build.size:
            part.unlink()
            have = 0
        digest = hashlib.sha256()
        if have:
            with part.open("rb") as f:
                while chunk := f.read(CHUNK):
                    digest.update(chunk)
                    job.check_cancelled()
        body, resumed = opener(build.url, have)
        size = have
        with body:
            if have and not resumed:  # the server sent the whole file again
                digest, size = hashlib.sha256(), 0
            with part.open("ab" if size else "wb") as out:
                while chunk := body.read(CHUNK):
                    out.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    if size > build.size:
                        break
                    job.progress("download", 90.0 * size / build.size)
                    job.check_cancelled()
        if size > build.size:
            part.unlink(missing_ok=True)
            raise GpuRuntimeError("unexpected download size")
        if size < build.size:
            raise GpuRuntimeError("the download was interrupted; try again to resume it")
        if digest.hexdigest() != build.sha256:
            part.unlink(missing_ok=True)
            raise GpuRuntimeError("checksum mismatch, the download is corrupt")

    def _extract(self, wheel: Path, directory: Path, job: JobContext) -> int:
        """Unpack the runtime files atomically; returns their size in bytes."""
        staging = self.root / ".staging"
        _remove_tree(staging)
        staging.mkdir(parents=True)
        base = staging.resolve()
        try:
            with zipfile.ZipFile(wheel) as z:
                members = [m for m in z.infolist() if _keep(m.filename)]
                total = sum(m.file_size for m in members) or 1
                done = 0
                for m in members:
                    dest = (staging / m.filename).resolve()
                    if not dest.is_relative_to(base):
                        raise GpuRuntimeError(f"unsafe path in the download: {m.filename}")
                    if m.is_dir():
                        dest.mkdir(parents=True, exist_ok=True)
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(m) as src, dest.open("wb") as out:
                        shutil.copyfileobj(src, out, CHUNK)
                    done += m.file_size
                    job.progress("install", 90.0 + 8.0 * done / total)
                    job.check_cancelled()
        except BaseException:
            _remove_tree(staging)
            raise
        _remove_tree(directory)
        staging.replace(directory)
        return done

    def remove(self) -> GpuRuntimeStatus | None:
        """Uninstall (and drop a partial download). A runtime this process uses stays
        until the next start, which deletes it."""
        if _ACTIVE is not None and _ACTIVE.is_relative_to(self.root):
            _update_state(self.root, remove=True)
            for entry in self.root.glob("*.part"):
                entry.unlink(missing_ok=True)
        else:
            shutil.rmtree(self.root, ignore_errors=True)
        return self.status()
