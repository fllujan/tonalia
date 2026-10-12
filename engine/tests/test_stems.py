"""Stems (SPEC 2.16): model download, safe loading, separation, cache and batches."""

from __future__ import annotations

import hashlib
import io
import os
import pickle
import shutil
from collections.abc import Callable, Iterator
from fractions import Fraction
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import torch

from tests.fixtures.generate import make_all
from tests.test_analysis_queue import call, wait_job
from tonalia_engine import stems
from tonalia_engine.audio_io import decode
from tonalia_engine.jobs import JobCancelled
from tonalia_engine.server import EngineContext
from tonalia_engine.stems import (
    STEMS,
    StemsError,
    WeightFile,
    download_files,
    missing_files,
    safe_load,
    split_stems,
    write_flac,
)
from tonalia_engine.vendor.demucs.htdemucs import HTDemucs

SR = 44100


# ---- safe loading ----


def test_unpickler_only_allows_what_the_weights_need() -> None:
    unpickler = stems.SafeUnpickler(io.BytesIO(b""))
    assert unpickler.find_class("demucs.htdemucs", "HTDemucs") is HTDemucs
    assert unpickler.find_class("fractions", "Fraction") is Fraction
    for module, name in [("os", "system"), ("builtins", "eval"), ("subprocess", "Popen")]:
        with pytest.raises(pickle.UnpicklingError, match="not allowed"):
            unpickler.find_class(module, name)


def test_safe_load_reads_tensors_and_rejects_code(tmp_path: Path) -> None:
    good = tmp_path / "good.th"
    torch.save({"segment": Fraction(39, 5), "state": {"w": torch.ones(3).half()}}, good)
    package = safe_load(good)
    assert package["segment"] == Fraction(39, 5)
    assert torch.equal(package["state"]["w"], torch.ones(3).half())

    class Evil:
        def __reduce__(self) -> tuple[Callable[..., Any], tuple[str]]:
            return (os.system, ("echo pwned",))

    bad = tmp_path / "bad.th"
    torch.save({"x": Evil()}, bad)
    with pytest.raises(pickle.UnpicklingError, match="not allowed"):
        safe_load(bad)


def test_the_pinned_models() -> None:
    assert set(stems.MODELS) == {"htdemucs", "htdemucs_ft"}
    assert len(stems.MODELS["htdemucs_ft"]) == 4
    for files in stems.MODELS.values():
        for f in files:
            # Demucs names files "<signature>-<sha256 prefix>".
            assert f.sha256.startswith(f.name.split("-")[1]) and len(f.sha256) == 64
            assert f.url.startswith("https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/")


# ---- download ----


def fake_files(*payloads: bytes) -> list[WeightFile]:
    return [
        WeightFile(
            f"sig{i}-{hashlib.sha256(p).hexdigest()[:8]}", len(p), hashlib.sha256(p).hexdigest()
        )
        for i, p in enumerate(payloads)
    ]


def opener(payloads: dict[str, bytes], calls: list[str]) -> Callable[[str], io.BytesIO]:
    def open_url(url: str) -> io.BytesIO:
        calls.append(url)
        return io.BytesIO(payloads[url.rsplit("/", 1)[1].removesuffix(".th")])

    return open_url


def test_download_verifies_and_reports_progress(tmp_path: Path) -> None:
    a, b = os.urandom(3_000_000), os.urandom(1_000)
    files = fake_files(a, b)
    calls: list[str] = []
    seen: list[tuple[int, int]] = []
    payloads = {files[0].name: a, files[1].name: b}
    got = download_files(
        tmp_path,
        files,
        progress=lambda d, t: seen.append((d, t)),
        check_cancelled=lambda: None,
        opener=opener(payloads, calls),
    )
    assert got == len(a) + len(b)
    assert (tmp_path / f"{files[0].name}.th").read_bytes() == a
    assert seen[-1] == (len(a) + len(b), len(a) + len(b))
    assert all(d1 <= d2 for (d1, _), (d2, _) in pairwise(seen))
    assert missing_files(tmp_path, files) == []
    # Already present: nothing is downloaded again.
    calls.clear()
    download_files(
        tmp_path,
        files,
        progress=lambda d, t: None,
        check_cancelled=lambda: None,
        opener=opener(payloads, calls),
    )
    assert calls == []


def test_download_rejects_a_corrupt_file(tmp_path: Path) -> None:
    good = os.urandom(10_000)
    [f] = fake_files(good)
    tampered = bytearray(good)
    tampered[5] ^= 0xFF
    with pytest.raises(StemsError, match="checksum"):
        download_files(
            tmp_path,
            [f],
            progress=lambda d, t: None,
            check_cancelled=lambda: None,
            opener=opener({f.name: bytes(tampered)}, []),
        )
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(StemsError, match="size"):
        download_files(
            tmp_path,
            [f],
            progress=lambda d, t: None,
            check_cancelled=lambda: None,
            opener=opener({f.name: good[:-1]}, []),
        )
    assert list(tmp_path.iterdir()) == []


def test_download_can_be_cancelled(tmp_path: Path) -> None:
    payload = os.urandom(5_000_000)
    [f] = fake_files(payload)
    seen = 0

    def check() -> None:
        nonlocal seen
        seen += 1
        if seen > 2:
            raise JobCancelled

    with pytest.raises(JobCancelled):
        download_files(
            tmp_path,
            [f],
            progress=lambda d, t: None,
            check_cancelled=check,
            opener=opener({f.name: payload}, []),
        )
    assert list(tmp_path.iterdir()) == []


def test_missing_files_checks_sizes(tmp_path: Path) -> None:
    files = fake_files(b"abc", b"defg")
    (tmp_path / f"{files[0].name}.th").write_bytes(b"abc")
    (tmp_path / f"{files[1].name}.th").write_bytes(b"de")  # truncated
    assert missing_files(tmp_path, files) == [files[1]]


# ---- separation ----


def test_split_stems_undoes_the_normalisation_and_sums_the_instrumental() -> None:
    rng = np.random.default_rng(1)
    audio = (rng.standard_normal((SR, 2)) * 0.2 + 0.05).astype(np.float32)
    shares = {"drums": 0.1, "bass": 0.2, "other": 0.3, "vocals": 0.4}
    order = ["drums", "bass", "other", "vocals"]
    seen: list[float] = []

    def run(mix: torch.Tensor, progress: Callable[[float], None]) -> torch.Tensor:
        assert mix.shape == (2, SR)
        assert abs(float(mix.mean(0).mean())) < 1e-4 and abs(float(mix.mean(0).std()) - 1) < 1e-3
        progress(0.5)
        progress(1.0)
        return torch.stack([mix * shares[s] for s in order])

    out = split_stems(audio, order, run, seen.append)
    assert list(out) == list(STEMS)
    assert all(v.shape == audio.shape and v.dtype == np.float32 for v in out.values())
    together = out["vocals"] + out["drums"] + out["bass"] + out["other"]
    np.testing.assert_allclose(together, audio, atol=1e-5)
    np.testing.assert_allclose(out["instrumental"], audio - out["vocals"], atol=1e-5)
    assert seen == [0.5, 1.0]


def test_split_stems_handles_silence() -> None:
    silent = np.zeros((SR, 2), np.float32)
    out = split_stems(
        silent,
        ["drums", "bass", "other", "vocals"],
        lambda mix, _: torch.zeros(4, *mix.shape),
        lambda _: None,
    )
    assert all(not np.any(v) for v in out.values())


def test_write_flac_is_24_bit_and_faithful(tmp_path: Path) -> None:
    t = np.arange(SR) / SR
    audio = np.stack([0.5 * np.sin(2 * np.pi * 440 * t), 0.25 * np.sin(2 * np.pi * 660 * t)], 1)
    path = tmp_path / "stem ñ 🎧.flac"
    write_flac(audio.astype(np.float32), path)
    back = decode(path, channels=2)
    np.testing.assert_allclose(back, audio, atol=1e-6)
    assert not list(tmp_path.glob("*.tmp*"))


def test_pick_device(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stems, "accelerator", lambda: "mps")
    assert stems.pick_device("auto") == "mps"
    assert stems.pick_device("cpu") == "cpu"
    monkeypatch.setattr(stems, "accelerator", lambda: None)
    assert stems.pick_device("auto") == "cpu"


# ---- service through the engine ----


class FakeSeparator:
    """Splits the mix into fixed shares; counts calls."""

    sources = ("drums", "bass", "other", "vocals")

    def __init__(self) -> None:
        self.calls = 0
        self.fail_on: set[str] = set()

    def __call__(
        self,
        audio: np.ndarray,
        progress: Callable[[float], None],
        check_cancelled: Callable[[], None],
    ) -> dict[str, np.ndarray]:
        self.calls += 1
        progress(1.0)
        check_cancelled()
        quarter = (audio * 0.25).astype(np.float32)
        out = {s: quarter for s in self.sources}
        out["instrumental"] = (audio * 0.75).astype(np.float32)
        return out


@pytest.fixture
def separator(engine_ctx: EngineContext, monkeypatch: pytest.MonkeyPatch) -> FakeSeparator:
    fake = FakeSeparator()
    monkeypatch.setattr(stems, "missing_files", lambda directory, files: [])
    monkeypatch.setattr(stems, "make_separator", lambda directory, model, device: fake)
    return fake


@pytest.fixture
def tracks(engine_ctx: EngineContext, tmp_path_factory: pytest.TempPathFactory) -> dict[str, int]:
    src = make_all(tmp_path_factory.mktemp("stems src"))
    folder = tmp_path_factory.mktemp("Música ñ 🎛️")
    for fmt in ("mp3", "flac"):
        shutil.copy2(src[fmt], folder / src[fmt].name)
    (folder / "broken.mp3").write_bytes(b"not audio at all")
    finished = wait_job(
        engine_ctx, call(engine_ctx, "library.addPaths", {"paths": [str(folder)]})["jobId"]
    )
    assert finished["status"] == "done"
    rows = engine_ctx.db.conn.execute("SELECT id, path FROM tracks").fetchall()
    return {
        Path(r["path"]).name.split(".")[-1] if "broken" not in r["path"] else "broken": r["id"]
        for r in rows
    }


def separate(ctx: EngineContext, **params: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, "stems.separate", params)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def test_separates_a_batch_caches_and_reports_failures(
    engine_ctx: EngineContext, tracks: dict[str, int], separator: FakeSeparator
) -> None:
    ids = [tracks["mp3"], tracks["flac"], tracks["broken"]]
    result = separate(engine_ctx, trackIds=ids, model="htdemucs")
    assert result["model"] == "htdemucs" and result["device"] in ("cpu", "mps", "cuda")
    assert result["separated"] == [tracks["mp3"], tracks["flac"]]
    assert [f["trackId"] for f in result["failed"]] == [tracks["broken"]]
    assert separator.calls == 2

    got = call(engine_ctx, "stems.get", {"trackId": tracks["mp3"], "model": "htdemucs"})["stems"]
    for name in STEMS:
        path = Path(got[name])
        assert path.is_file() and path.suffix == ".flac"
        assert path.is_relative_to(engine_ctx.data_dir / "cache" / "stems")
    vocals = decode(Path(got["vocals"]), channels=2)
    original = decode(
        Path(
            engine_ctx.db.conn.execute(
                "SELECT path FROM tracks WHERE id = ?", (tracks["mp3"],)
            ).fetchone()[0]
        ),
        channels=2,
    )
    np.testing.assert_allclose(vocals, np.clip(original * 0.25, -1, 1), atol=1e-4)

    again = separate(engine_ctx, trackIds=[tracks["mp3"]], model="htdemucs")
    assert again["cached"] == [tracks["mp3"]] and again["separated"] == []
    assert separator.calls == 2
    # Another model is a separate cache entry; the default model comes from the settings.
    assert call(engine_ctx, "stems.get", {"trackId": tracks["mp3"]})["stems"] is None


def test_a_changed_file_is_separated_again(
    engine_ctx: EngineContext, tracks: dict[str, int], separator: FakeSeparator
) -> None:
    separate(engine_ctx, trackIds=[tracks["mp3"]], model="htdemucs")
    engine_ctx.db.conn.execute(
        "UPDATE tracks SET file_hash = 'changed' WHERE id = ?", (tracks["mp3"],)
    )
    assert (
        call(engine_ctx, "stems.get", {"trackId": tracks["mp3"], "model": "htdemucs"})["stems"]
        is None
    )
    separate(engine_ctx, trackIds=[tracks["mp3"]], model="htdemucs")
    assert separator.calls == 2


def test_status_and_clearing_the_cache(
    engine_ctx: EngineContext, tracks: dict[str, int], separator: FakeSeparator
) -> None:
    separate(engine_ctx, trackIds=[tracks["mp3"]], model="htdemucs")
    status = call(engine_ctx, "stems.status")
    assert {m["model"] for m in status["models"]} == {"htdemucs", "htdemucs_ft"}
    assert status["cache"]["tracks"] == 1 and status["cache"]["bytes"] > 0
    # Rendered (processed) audio is counted and emptied with the stems.
    renders = engine_ctx.data_dir / "cache" / "render"
    renders.mkdir(parents=True)
    (renders / "abc.wav").write_bytes(b"x" * 1000)
    assert call(engine_ctx, "stems.status")["cache"]["bytes"] == status["cache"]["bytes"] + 1000
    cleared = call(engine_ctx, "stems.clearCache")
    assert cleared == {"bytes": 0, "tracks": 0}
    assert not any((engine_ctx.data_dir / "cache" / "stems").glob("*"))
    assert not any(renders.glob("*"))
    assert (
        call(engine_ctx, "stems.get", {"trackId": tracks["mp3"], "model": "htdemucs"})["stems"]
        is None
    )


def test_separating_needs_the_model(engine_ctx: EngineContext, tracks: dict[str, int]) -> None:
    finished = wait_job(
        engine_ctx,
        call(engine_ctx, "stems.separate", {"trackIds": [tracks["mp3"]], "model": "htdemucs"})[
            "jobId"
        ],
    )
    assert finished["status"] == "failed" and "not downloaded" in finished["error"]


def test_model_download_job(engine_ctx: EngineContext, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = os.urandom(200_000)
    files = fake_files(payload)
    monkeypatch.setitem(stems.MODELS, "htdemucs", tuple(files))
    monkeypatch.setattr(stems, "open_url", opener({files[0].name: payload}, []))
    status = {m["model"]: m for m in call(engine_ctx, "stems.status")["models"]}
    assert status["htdemucs"] == {
        "model": "htdemucs",
        "installed": False,
        "totalBytes": len(payload),
        "missingBytes": len(payload),
    }
    finished = wait_job(
        engine_ctx, call(engine_ctx, "stems.downloadModel", {"model": "htdemucs"})["jobId"]
    )
    assert finished["status"] == "done"
    assert finished["result"] == {"model": "htdemucs", "downloadedBytes": len(payload)}
    status = {m["model"]: m for m in call(engine_ctx, "stems.status")["models"]}
    assert status["htdemucs"]["installed"] is True and status["htdemucs"]["missingBytes"] == 0


def test_settings_choose_model_and_device(engine_ctx: EngineContext) -> None:
    got = call(engine_ctx, "settings.get")
    assert (got["stemModel"], got["stemDevice"]) == ("htdemucs_ft", "auto")
    got = call(engine_ctx, "settings.set", {"stemModel": "htdemucs", "stemDevice": "cpu"})
    assert (got["stemModel"], got["stemDevice"]) == ("htdemucs", "cpu")


# ---- the real model (only where its weights are available) ----

REAL_MODELS = os.environ.get("TONALIA_DEMUCS_MODELS")


@pytest.fixture
def real_models() -> Iterator[Path]:
    if not REAL_MODELS or stems.missing_files(Path(REAL_MODELS), stems.MODELS["htdemucs"]):
        pytest.skip("set TONALIA_DEMUCS_MODELS to a folder with the htdemucs weights")
    yield Path(REAL_MODELS)


def test_real_model_separates_a_vocal_like_tone_from_drums(real_models: Path) -> None:
    separator = stems.make_separator(real_models, "htdemucs", "cpu")
    t = np.arange(8 * SR) / SR
    # A vibrato "voice" plus kick-like clicks every half second.
    voice = 0.3 * np.sin(2 * np.pi * (440 + 6 * np.sin(2 * np.pi * 5 * t)) * t)
    kick = np.zeros_like(t)
    for start in range(0, len(t), SR // 2):
        n = np.arange(min(4000, len(t) - start))
        kick[start : start + len(n)] = 0.8 * np.sin(2 * np.pi * 55 * n / SR) * np.exp(-n / 800)
    mix = np.stack([voice + kick] * 2, 1).astype(np.float32)
    out = separator(mix, lambda _: None, lambda: None)
    assert set(out) == set(STEMS)
    assert all(v.shape == mix.shape and np.isfinite(v).all() for v in out.values())

    def corr(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.corrcoef(a[:, 0], b)[0, 1])

    # Each source goes mostly where it belongs.
    assert corr(out["vocals"], voice) > corr(out["vocals"], kick)
    assert corr(out["drums"], kick) + corr(out["bass"], kick) > corr(out["drums"], voice)
