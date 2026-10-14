"""Stem separation with Demucs (SPEC 2.16).

- Models: ``htdemucs_ft`` (bag of four fine-tuned models, best quality) and ``htdemucs``
  (one model, about four times faster). Their weight files are downloaded once from
  Meta's public server into ``<data>/models/demucs`` with progress, verified against the
  SHA-256 pinned below and moved into place atomically.
- Loading never runs arbitrary pickled code: a restricted unpickler only accepts the few
  classes the weight files contain, mapping ``demucs.*`` to the vendored inference code.
- Acceleration: MPS on Apple Silicon, CUDA where PyTorch has it, else the CPU.
- Timing: every separation adds its processing time and audio length to ``stem_timings``
  (per model and device), so the UI can say how long a model takes on this machine. A
  model that has not run yet is estimated from the other one (``FT_FACTOR``).
- Outputs: vocals, drums, bass, other and instrumental (everything but the vocals) as
  24-bit FLAC in ``<data>/cache/stems``, one folder per track, model and file hash, so
  an edited or replaced file is separated again.

PyTorch is imported lazily: the engine must start fast and most sessions never touch it.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import pickle
import shutil
import subprocess
import sys
import threading
import time
import types
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any, Literal, Protocol, cast, get_args

import numpy as np
import numpy.typing as npt

from . import gpu_runtime
from .analysis.structure import Segment
from .analysis.vocals import main_sections, measured_presence
from .audio_io import _NO_WINDOW, ANALYSIS_SAMPLE_RATE, DecodeError, decode, ffmpeg_path
from .cues import list_segments
from .db import Database
from .jobs import JobContext
from .rpc_schema import (
    StemDevice,
    StemFailure,
    StemModel,
    StemModelDownloaded,
    StemModelStatus,
    StemsCacheInfo,
    StemSet,
    StemsSeparateResult,
    StemsStatus,
)

if TYPE_CHECKING:
    import torch

log = logging.getLogger(__name__)

AudioArray = npt.NDArray[np.float32]

BASE_URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/"
STEMS: tuple[str, ...] = ("vocals", "drums", "bass", "other", "instrumental")
CHUNK = 1 << 20
# htdemucs_ft runs four models where htdemucs runs one: measured 146 s against 38 s for
# 4 min of audio on an M4 with MPS (PROGRESS, 2026-10-12).
FT_FACTOR = 3.85
clock = time.monotonic  # replaced in tests


class StemsError(RuntimeError):
    pass


@dataclass(frozen=True)
class WeightFile:
    name: str  # "<signature>-<sha256 prefix>", as Demucs publishes them
    size: int
    sha256: str

    @property
    def url(self) -> str:
        return f"{BASE_URL}{self.name}.th"

    @property
    def filename(self) -> str:
        return f"{self.name}.th"


MODELS: dict[str, tuple[WeightFile, ...]] = {
    "htdemucs": (
        WeightFile(
            "955717e8-8726e21a",
            84_141_911,
            "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4",
        ),
    ),
    # One specialised model per source (weights: each model only provides its own stem).
    "htdemucs_ft": (
        WeightFile(
            "f7e0c4bc-ba3fe64a",
            84_141_271,
            "ba3fe64ae8ef66ac9a4857222ce48efbdc5eb3ad375cb79dd13debee5aaa4066",
        ),
        WeightFile(
            "d12395a8-e57c48e6",
            84_141_271,
            "e57c48e6b0e38af4f7118d7bd08c49f0a0c0edf7d09143bdd902ea0d237303e6",
        ),
        WeightFile(
            "92cfc3b6-ef3bcb9c",
            84_141_271,
            "ef3bcb9c8b40d14ae5d51b6db2587339cc12c6b77c0be151ce6d69002e087bf2",
        ),
        WeightFile(
            "04573f0d-f3cf25b2",
            84_141_271,
            "f3cf25b222c4eed7cd49dd8b2c9597d50c18bd154090f7b919cfa5f93cf22c49",
        ),
    ),
}
assert set(MODELS) == set(get_args(StemModel))


def models_dir(data_dir: Path) -> Path:
    return data_dir / "models" / "demucs"


def cache_dir(data_dir: Path) -> Path:
    return data_dir / "cache" / "stems"


# ---- download ----


def open_url(url: str) -> IO[bytes]:
    """HTTPS GET (replaced in tests). Only the pinned model URLs are ever opened."""
    import urllib.request

    if not url.startswith(BASE_URL):
        raise StemsError(f"unexpected model URL: {url}")
    return cast(IO[bytes], urllib.request.urlopen(url, timeout=60))


def missing_files(directory: Path, files: Sequence[WeightFile]) -> list[WeightFile]:
    """Weight files not present with their expected size (hashes are checked on download)."""
    out = []
    for f in files:
        try:
            ok = (directory / f.filename).stat().st_size == f.size
        except OSError:
            ok = False
        if not ok:
            out.append(f)
    return out


def download_files(
    directory: Path,
    files: Sequence[WeightFile],
    *,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
    opener: Callable[[str], IO[bytes]] | None = None,
) -> int:
    """Download the missing ``files`` into ``directory``; returns the bytes downloaded."""
    fetch = opener or open_url
    todo = missing_files(directory, files)
    total = sum(f.size for f in todo)
    done = 0
    directory.mkdir(parents=True, exist_ok=True)
    for f in todo:
        part = directory / f"{f.filename}.part"
        digest = hashlib.sha256()
        size = 0
        try:
            with fetch(f.url) as response, part.open("wb") as out:
                while chunk := response.read(CHUNK):
                    check_cancelled()
                    out.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                    if size > f.size:
                        break
                    progress(done + size, total)
            if size != f.size:
                raise StemsError(f"{f.filename}: unexpected size ({size} bytes, not {f.size})")
            if digest.hexdigest() != f.sha256:
                raise StemsError(f"{f.filename}: checksum mismatch, the download is corrupt")
            part.replace(directory / f.filename)
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        done += f.size
        progress(done, total)
    return done


def model_status(
    directory: Path, model: str, estimate: tuple[float, bool] | None = None
) -> StemModelStatus:
    files = MODELS[model]
    missing = missing_files(directory, files)
    return StemModelStatus(
        model=cast(StemModel, model),
        installed=not missing,
        total_bytes=sum(f.size for f in files),
        missing_bytes=sum(f.size for f in missing),
        seconds_per_minute=estimate[0] if estimate else None,
        estimate_measured=estimate[1] if estimate else False,
    )


def _relative_cost(model: str) -> float:
    return FT_FACTOR if model == "htdemucs_ft" else 1.0


# ---- safe loading ----

_VENDOR = "tonalia_engine.vendor.demucs"
_ALLOWED = frozenset(
    {
        ("collections", "OrderedDict"),
        ("fractions", "Fraction"),
        ("torch._utils", "_rebuild_tensor_v2"),
        ("torch._utils", "_rebuild_parameter"),
        ("torch", "Size"),
        ("numpy", "dtype"),
        ("numpy.core.multiarray", "scalar"),
        ("numpy._core.multiarray", "scalar"),
        ("_codecs", "encode"),
        (f"{_VENDOR}.htdemucs", "HTDemucs"),
        (f"{_VENDOR}.hdemucs", "HDemucs"),
        (f"{_VENDOR}.demucs", "Demucs"),
    }
)


class SafeUnpickler(pickle.Unpickler):
    """Unpickler that only resolves the globals Demucs weight files need."""

    def find_class(self, module: str, name: str) -> Any:
        if module == "demucs" or module.startswith("demucs."):
            module = f"tonalia_engine.vendor.{module}"
        if (module, name) not in _ALLOWED:
            raise pickle.UnpicklingError(f"global {module}.{name} is not allowed")
        if module == "numpy.core.multiarray" and int(np.__version__.split(".")[0]) >= 2:
            module = "numpy._core.multiarray"  # same object, without the deprecation warning
        return super().find_class(module, name)


_SAFE_PICKLE = types.ModuleType("tonalia_safe_pickle")
_SAFE_PICKLE.Unpickler = SafeUnpickler  # type: ignore[attr-defined]
_SAFE_PICKLE.load = pickle.load  # type: ignore[attr-defined]


def safe_load(path: Path) -> Any:
    """``torch.load`` restricted to tensors, plain data and the Demucs model classes."""
    import torch

    # Safe despite weights_only=False: SafeUnpickler (via pickle_module) refuses every
    # global outside _ALLOWED, so pickled code cannot run. torch's own weights_only
    # allowlist can't be used: it can't map "demucs.*" to the vendored classes, and the
    # PyTorch 2.2 of Intel Macs doesn't have it. Model files are also SHA-256 verified.
    return torch.load(path, map_location="cpu", pickle_module=_SAFE_PICKLE, weights_only=False)


@lru_cache(maxsize=1)
def load_bag(directory: Path, model: str) -> Any:
    """The model (a Demucs ``BagOfModels``), kept in memory for the next track."""
    from .vendor.demucs.apply import BagOfModels
    from .vendor.demucs.states import load_model

    files = MODELS[model]
    if missing_files(directory, files):
        raise StemsError(f"the {model} model is not downloaded")
    models = [load_model(safe_load(directory / f.filename)) for f in files]
    weights = (
        [[1.0 if i == j else 0.0 for j in range(len(files))] for i in range(len(files))]
        if len(files) > 1
        else None
    )
    bag = BagOfModels(models, weights)
    bag.eval()
    return bag


# ---- devices ----


def accelerator() -> Literal["mps", "cuda"] | None:
    with gpu_runtime.loading_torch():
        import torch

    if sys.platform == "darwin" and torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return None


def pick_device(preference: StemDevice) -> str:
    return (accelerator() or "cpu") if preference == "auto" else "cpu"


# ---- separation ----

Run = Callable[["torch.Tensor", Callable[[float], None]], "torch.Tensor"]


class Separator(Protocol):
    def __call__(
        self,
        audio: AudioArray,
        progress: Callable[[float], None],
        check_cancelled: Callable[[], None],
    ) -> dict[str, AudioArray]: ...


def split_stems(
    audio: AudioArray,
    sources: Sequence[str],
    run: Run,
    progress: Callable[[float], None],
) -> dict[str, AudioArray]:
    """Normalise ``audio`` (n, 2) as Demucs expects, run the model, return the five stems.

    The DC offset removed by the normalisation is shared among the sources, so the four
    stems add up exactly to the mix (``separate.py`` in Demucs adds it to every source).
    """
    import torch

    wav = torch.from_numpy(np.ascontiguousarray(audio.T))
    ref = wav.mean(0)
    mean = float(ref.mean())
    std = float(ref.std()) or 1.0
    out = run((wav - mean) / std, progress)
    parts = {
        name: (out[i] * std + mean / len(sources)).T.contiguous().numpy().astype(np.float32)
        for i, name in enumerate(sources)
    }
    parts["instrumental"] = sum(
        (v for k, v in parts.items() if k != "vocals"), np.zeros_like(audio)
    ).astype(np.float32)
    return {name: parts[name] for name in STEMS}


def make_separator(directory: Path, model: str, device: str) -> Separator:
    """Separator running ``model`` on ``device``; progress and cancellation per chunk."""
    from .vendor.demucs.apply import apply_model

    bag = load_bag(directory, model)

    def separate(
        audio: AudioArray,
        progress: Callable[[float], None],
        check_cancelled: Callable[[], None],
    ) -> dict[str, AudioArray]:
        import torch

        length = audio.shape[0]

        def run(mix: torch.Tensor, report: Callable[[float], None]) -> torch.Tensor:
            def callback(info: dict[str, Any]) -> None:
                check_cancelled()
                if info.get("state") == "end":
                    models = max(1, int(info.get("models", 1)))
                    within = min(1.0, (info["segment_offset"] + 1) / max(1, length))
                    report((info["model_idx_in_bag"] + within) / models)

            with torch.inference_mode():
                result = apply_model(
                    bag,
                    mix[None],
                    shifts=1,
                    split=True,
                    overlap=0.25,
                    device=device,
                    callback=callback,
                )
            return cast("torch.Tensor", result[0].cpu())

        return split_stems(audio, list(bag.sources), run, progress)

    return separate


def write_flac(audio: AudioArray, path: Path) -> None:
    """Write (n, 2) float32 audio as 24-bit FLAC, atomically."""
    tmp = path.with_name(f"{path.name}.tmp")
    cmd = [
        ffmpeg_path(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "f32le",
        "-ar",
        str(ANALYSIS_SAMPLE_RATE),
        "-ac",
        str(audio.shape[1]),
        "-i",
        "pipe:0",
        "-c:a",
        "flac",
        "-sample_fmt",
        "s32",
        "-bits_per_raw_sample",
        "24",
        "-f",
        "flac",
        f"file:{tmp}",
    ]
    data = np.clip(audio, -1.0, 1.0).astype("<f4").tobytes()
    try:
        proc = subprocess.run(
            cmd, input=data, capture_output=True, check=False, creationflags=_NO_WINDOW
        )
        if proc.returncode != 0:
            reason = proc.stderr.decode("utf-8", "replace").strip().splitlines()
            raise StemsError(
                f"cannot write {path.name}: {reason[-1] if reason else proc.returncode}"
            )
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


# ---- the service ----

_SEPARATING = threading.Lock()  # one separation at a time: it uses the whole machine


class StemService:
    def __init__(self, db: Database, data_dir: Path) -> None:
        self.db = db
        self.data_dir = data_dir

    @property
    def models_dir(self) -> Path:
        return models_dir(self.data_dir)

    @property
    def cache_dir(self) -> Path:
        return cache_dir(self.data_dir)

    def status(self, device_preference: StemDevice = "auto") -> StemsStatus:
        device = pick_device(device_preference)
        return StemsStatus(
            models=[model_status(self.models_dir, m, self.estimate(m, device)) for m in MODELS],
            accelerator=accelerator(),
            cache=self.cache_info(),
            gpu_runtime=gpu_runtime.GpuRuntime(self.data_dir).status(),
        )

    def record_timing(self, model: str, device: str, seconds: float, audio_minutes: float) -> None:
        if audio_minutes <= 0:
            return
        self.db.conn.execute(
            "INSERT INTO stem_timings (model, device, seconds, audio_minutes) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(model, device) DO UPDATE SET seconds = seconds + excluded.seconds,"
            " audio_minutes = audio_minutes + excluded.audio_minutes,"
            " updated_at = excluded.updated_at",
            (model, device, max(seconds, 0.0), audio_minutes),
        )

    def estimate(self, model: str, device: str) -> tuple[float, bool] | None:
        """Seconds per minute of audio for ``model`` on ``device`` and whether it was
        measured (``False``: derived from the other model's time)."""
        rows = {
            r["model"]: r["seconds"] / r["audio_minutes"]
            for r in self.db.conn.execute(
                "SELECT model, seconds, audio_minutes FROM stem_timings WHERE device = ?",
                (device,),
            )
        }
        if model in rows:
            return rows[model], True
        for other, rate in rows.items():
            if other in MODELS:
                return rate / _relative_cost(other) * _relative_cost(model), False
        return None

    def available(self, track_id: int, preferred: str) -> StemSet | None:
        """The stems of ``preferred``, else those of another model already separated:
        changing the default model never hides stems the user already has."""
        for model in (preferred, *(m for m in MODELS if m != preferred)):
            found = self.get(track_id, model)
            if found is not None:
                return found
        return None

    def download(self, model: str, job: JobContext) -> StemModelDownloaded:
        got = download_files(
            self.models_dir,
            MODELS[model],
            progress=lambda done, total: job.progress(
                "download", 100.0 * done / total if total else 100.0
            ),
            check_cancelled=job.check_cancelled,
        )
        return StemModelDownloaded(model=cast(StemModel, model), downloaded_bytes=got)

    def get(self, track_id: int, model: str) -> StemSet | None:
        row = self.db.conn.execute(
            "SELECT s.*, t.file_hash FROM stems s JOIN tracks t ON t.id = s.track_id"
            " WHERE s.track_id = ? AND s.model = ?",
            (track_id, model),
        ).fetchone()
        if row is None or row["source_hash"] != row["file_hash"]:
            return None
        paths = {name: row[f"{name}_path"] for name in STEMS}
        if not all(p and Path(p).is_file() for p in paths.values()):
            return None
        return StemSet(
            track_id=track_id,
            model=cast(StemModel, model),
            created_at=row["created_at"],
            **paths,
        )

    def separate(
        self,
        track_ids: Sequence[int],
        model: str,
        device_preference: StemDevice,
        job: JobContext,
        reuse_other_models: bool = False,
    ) -> StemsSeparateResult:
        """Separate ``track_ids`` with ``model``. With ``reuse_other_models`` (the model was
        not asked for explicitly), a track separated with another model counts as cached."""
        if missing_files(self.models_dir, MODELS[model]):
            raise StemsError(f"the {model} model is not downloaded")
        device = pick_device(device_preference)
        result = StemsSeparateResult(
            model=cast(StemModel, model), device=device, separated=[], cached=[], failed=[]
        )
        ids = list(dict.fromkeys(track_ids))
        with _SEPARATING:
            separator: Separator | None = None
            for i, track_id in enumerate(ids):
                job.check_cancelled()

                def report(fraction: float, i: int = i, track_id: int = track_id) -> None:
                    job.progress(
                        "stems",
                        100.0 * (i + fraction) / len(ids),
                        track_id=track_id,
                        done=i,
                        total=len(ids),
                    )

                report(0.0)
                cached = (
                    self.available(track_id, model)
                    if reuse_other_models
                    else self.get(track_id, model)
                )
                if cached is not None:
                    result.cached.append(track_id)
                    continue
                while True:
                    try:
                        separator = separator or make_separator(self.models_dir, model, device)
                        started = clock()
                        minutes = self._separate_one(track_id, model, separator, report, job)
                        self.record_timing(model, device, clock() - started, minutes)
                        result.separated.append(track_id)
                    except (DecodeError, StemsError, OSError, ValueError) as exc:
                        log.warning("stems failed for track %s: %s", track_id, exc)
                        result.failed.append(StemFailure(track_id=track_id, error=str(exc)))
                    except RuntimeError as exc:
                        if device == "cuda":
                            # GPU trouble (driver, memory, unsupported card): this track
                            # and the rest of the batch go to the CPU.
                            log.warning("stems: GPU failed (%s); using the CPU", exc)
                            device = result.device = "cpu"
                            result.gpu_fallback = str(exc)
                            separator = None
                            continue
                        log.warning("stems failed for track %s: %s", track_id, exc)
                        result.failed.append(StemFailure(track_id=track_id, error=str(exc)))
                    break
            job.progress("stems", 100.0, done=len(ids), total=len(ids), force=True)
        return result

    def _separate_one(
        self,
        track_id: int,
        model: str,
        separator: Separator,
        report: Callable[[float], None],
        job: JobContext,
    ) -> float:
        """Separate one track and return its length in minutes."""
        row = self.db.conn.execute(
            "SELECT path, file_hash FROM tracks WHERE id = ?", (track_id,)
        ).fetchone()
        if row is None:
            raise StemsError(f"unknown track {track_id}")
        audio = decode(Path(row["path"]), channels=2)
        parts = separator(audio, lambda f: report(0.95 * f), job.check_cancelled)
        folder = self.cache_dir / f"{track_id}-{(row['file_hash'] or 'nohash')[:16]}-{model}"
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        try:
            paths: dict[str, str] = {}
            for name in STEMS:
                job.check_cancelled()
                path = folder / f"{name}.flac"
                write_flac(parts[name], path)
                paths[name] = str(path)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        self.db.conn.execute(
            "INSERT OR REPLACE INTO stems (track_id, model, vocals_path, drums_path, bass_path,"
            " other_path, instrumental_path, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (track_id, model, *(paths[n] for n in STEMS), row["file_hash"]),
        )
        self._store_vocal_presence(track_id, parts["vocals"], audio)
        return float(audio.shape[0]) / ANALYSIS_SAMPLE_RATE / 60.0

    def _store_vocal_presence(self, track_id: int, vocals: AudioArray, mix: AudioArray) -> None:
        """Replace the estimate with the measurement on the stems (SPEC 2.16)."""
        segments = [
            Segment(s.start, s.end, s.label, s.energy) for s in list_segments(self.db, track_id)
        ]
        sections = main_sections(segments, mix.shape[0] / ANALYSIS_SAMPLE_RATE)
        presence = measured_presence(vocals, mix, ANALYSIS_SAMPLE_RATE, sections)
        self.db.conn.execute(
            "INSERT INTO analysis (track_id, vocal_presence, vocal_source) VALUES (?, ?, 'stems')"
            " ON CONFLICT(track_id) DO UPDATE SET vocal_presence = excluded.vocal_presence,"
            " vocal_source = 'stems'",
            (track_id, presence),
        )

    @property
    def render_cache_dir(self) -> Path:
        # Processed audio (render.py) comes from the stems and lives and goes with them.
        return self.data_dir / "cache" / "render"

    def cache_info(self) -> StemsCacheInfo:
        tracks = self.db.conn.execute("SELECT COUNT(DISTINCT track_id) FROM stems").fetchone()[0]
        size = sum(_sizes(self.cache_dir)) + sum(_sizes(self.render_cache_dir))
        return StemsCacheInfo(bytes=size, tracks=int(tracks))

    def clear_cache(self) -> StemsCacheInfo:
        with _SEPARATING:
            self.db.conn.execute("DELETE FROM stems")
            for root in (self.cache_dir, self.render_cache_dir):
                if not root.exists():
                    continue
                for entry in root.iterdir():
                    if entry.is_dir():
                        shutil.rmtree(entry, ignore_errors=True)
                    else:
                        entry.unlink(missing_ok=True)
        return self.cache_info()


def _sizes(root: Path) -> Iterator[int]:
    if not root.exists():
        return
    for path in root.rglob("*"):
        with contextlib.suppress(OSError):
            if path.is_file():
                yield path.stat().st_size
