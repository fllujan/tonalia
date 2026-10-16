"""ReplayGain (SPEC 13.6): the gain from the loudness the analysis already measures (-18 LUFS
reference) and the true peak, written as the standard tags through the tag writer (preview,
backup and undo) and as Traktor's LOUDNESS when exporting there. The audio is never changed."""

from __future__ import annotations

import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import mutagen
import numpy as np
import pytest
from mutagen.id3 import ID3, TXXX

from tests.fixtures.generate import FORMATS, make_all
from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import library
from tests.test_export_traktor import entries, export, nml, traktor_closed
from tonalia_engine.analysis.quality import (
    REPLAYGAIN_REFERENCE_LUFS,
    analyze_quality,
    replaygain_db,
    true_peak,
)
from tonalia_engine.rpc_schema import TagOptions
from tonalia_engine.server import EngineContext
from tonalia_engine.tags.backup import restore
from tonalia_engine.tags.writer import TagValues, plan_changes, write_tags

__all__ = ["library", "nml", "traktor_closed"]

SR = 44100
ONLY_GAIN = TagOptions.model_validate(
    {"writeKey": False, "writeBpm": False, "writeComment": False, "writeReplaygain": True}
)
GAIN = TagValues(key=None, key_alt=None, bpm=None, energy=None, gain_db=-6.48, peak=0.988553)


def test_true_peak_finds_the_peak_between_samples() -> None:
    # A quarter-rate sine sampled 45 degrees off its crest: every sample is 3 dB under it.
    n = np.arange(SR)
    sine = 0.5 * np.sin(2 * np.pi * n / 4 + np.pi / 4)
    assert float(np.abs(sine).max()) == pytest.approx(0.5 / np.sqrt(2))
    stereo = np.column_stack([sine, sine * 0.5])
    assert 20 * np.log10(true_peak(stereo)) == pytest.approx(20 * np.log10(0.5), abs=0.2)
    assert true_peak(np.zeros((1000, 2))) == 0.0


def test_quality_gives_the_gain_and_true_peak() -> None:
    rng = np.random.default_rng(1)
    audio = np.clip(rng.standard_normal((10 * SR, 2)) * 0.1, -1, 1)
    q = analyze_quality(audio, SR, fmt="flac", bitrate=None)
    assert q is not None
    assert q.true_peak_db >= q.peak_db - 0.01
    assert replaygain_db(q.loudness_lufs) == pytest.approx(
        REPLAYGAIN_REFERENCE_LUFS - q.loudness_lufs, abs=0.01
    )
    assert replaygain_db(None) is None and replaygain_db(-70.0) is None  # silent: no gain


@pytest.fixture(scope="module")
def originals(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    return make_all(tmp_path_factory.mktemp("ganancia ñ 🎧"))


@pytest.fixture
def files(originals: dict[str, Path], tmp_path: Path) -> dict[str, Path]:
    out = {}
    for fmt, src in originals.items():
        out[fmt] = tmp_path / src.name
        shutil.copy2(src, out[fmt])
    return out


def _stored(path: Path) -> tuple[str | None, str | None]:
    """The two values as another player reads them, under their standard names."""
    audio: Any = mutagen.File(path)
    tags = audio.tags
    if isinstance(tags, ID3):
        gain, peak = tags.get("TXXX:REPLAYGAIN_TRACK_GAIN"), tags.get("TXXX:REPLAYGAIN_TRACK_PEAK")
        return (gain.text[0] if gain else None), (peak.text[0] if peak else None)
    if type(audio).__name__ == "MP4":
        g = tags.get("----:com.apple.iTunes:replaygain_track_gain")
        p = tags.get("----:com.apple.iTunes:replaygain_track_peak")
        return (bytes(g[0]).decode() if g else None), (bytes(p[0]).decode() if p else None)
    g, p = tags.get("REPLAYGAIN_TRACK_GAIN"), tags.get("REPLAYGAIN_TRACK_PEAK")
    return (g[0] if g else None), (p[0] if p else None)


@pytest.mark.parametrize("fmt", list(FORMATS))
def test_writes_the_standard_tags_and_undo_restores_every_byte(
    files: dict[str, Path], fmt: str
) -> None:
    path = files[fmt]
    original = path.read_bytes()
    changes = plan_changes(path, GAIN, ONLY_GAIN)
    assert [(c.field, c.before, c.after) for c in changes] == [
        ("replaygain_track_gain", None, "-6.48 dB"),
        ("replaygain_track_peak", None, "0.988553"),
    ]
    assert path.read_bytes() == original  # the preview writes nothing
    outcome = write_tags(path, changes)
    assert outcome is not None
    assert _stored(path) == ("-6.48 dB", "0.988553")
    # Written again with the same values: nothing to change.
    assert plan_changes(path, GAIN, ONLY_GAIN) == []
    restore(path, outcome.patch)
    assert path.read_bytes() == original


def test_positive_gain_has_its_sign_and_old_spellings_are_replaced(files: dict[str, Path]) -> None:
    path = files["mp3"]
    audio: Any = mutagen.File(path)
    if audio.tags is None:
        audio.add_tags()
    # Another program wrote it in lower case: replaced, never left as a second copy.
    audio.tags.add(TXXX(encoding=3, desc="replaygain_track_gain", text=["+1.00 dB"]))
    audio.save()
    values = TagValues(None, None, None, None, gain_db=2.1, peak=0.5)
    changes = {c.field: c for c in plan_changes(path, values, ONLY_GAIN)}
    assert changes["replaygain_track_gain"].before == "+1.00 dB"
    assert changes["replaygain_track_gain"].after == "+2.10 dB"
    write_tags(path, list(changes.values()))
    descs = [f.desc.lower() for f in ID3(path).getall("TXXX")]
    assert descs.count("replaygain_track_gain") == 1


def test_nothing_is_written_without_a_measured_loudness(files: dict[str, Path]) -> None:
    values = TagValues(None, None, None, None, gain_db=None, peak=None)
    assert plan_changes(files["flac"], values, ONLY_GAIN) == []
    # Off by default: the usual results write leaves the gain alone.
    assert all(
        not c.field.startswith("replaygain")
        for c in plan_changes(files["flac"], GAIN, TagOptions())
    )


def _set_loudness(
    ctx: EngineContext, track_id: int, lufs: float, true_peak_db: float | None
) -> None:
    ctx.db.conn.execute(
        "INSERT INTO analysis (track_id, loudness_lufs, peak_db, true_peak_db, replaygain_db) "
        "VALUES (?, ?, -0.5, ?, ?) ON CONFLICT(track_id) DO UPDATE SET "
        "loudness_lufs = excluded.loudness_lufs, peak_db = excluded.peak_db, "
        "true_peak_db = excluded.true_peak_db, replaygain_db = excluded.replaygain_db",
        (track_id, lufs, true_peak_db, replaygain_db(lufs)),
    )


def test_rpc_preview_write_undo_and_the_gain_column(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    from tests.test_analysis_queue import import_folder

    folder = tmp_path / "Música 🎧"
    files = make_all(folder, stem="tema ñ")
    (folder / "tema ñ.source.wav").unlink()
    import_folder(engine_ctx, folder)
    items = call(engine_ctx, "library.list", {})["items"]
    flac = next(i for i in items if i["path"] == str(files["flac"]))
    mp3 = next(i for i in items if i["path"] == str(files["mp3"]))
    _set_loudness(engine_ctx, flac["id"], -9.5, 0.3)  # loud master over 0 dBTP
    _set_loudness(engine_ctx, mp3["id"], -20.0, None)  # analysed before the true peak existed

    page = call(engine_ctx, "library.list", {"sort": "replaygain", "descending": False})
    gains = [(i["id"], i["replaygainDb"]) for i in page["items"][:2]]
    assert gains == [(flac["id"], -8.5), (mp3["id"], 2.0)]
    detail = call(engine_ctx, "library.get", {"trackId": flac["id"]})
    assert detail["replaygainDb"] == -8.5 and detail["truePeakDb"] == 0.3

    options = {"writeKey": False, "writeBpm": False, "writeComment": False, "writeReplaygain": True}
    preview = call(
        engine_ctx, "tags.preview", {"trackIds": [flac["id"], mp3["id"]], "options": options}
    )
    changes = {
        i["trackId"]: {c["field"]: c["after"] for c in i["changes"]} for i in preview["items"]
    }
    assert changes[flac["id"]] == {
        "replaygain_track_gain": "-8.50 dB",
        "replaygain_track_peak": f"{10 ** (0.3 / 20):.6f}",  # over 1.0: players lower it
    }
    # Without a true peak the sample peak stands in.
    assert changes[mp3["id"]]["replaygain_track_peak"] == f"{10 ** (-0.5 / 20):.6f}"

    before = {p: p.read_bytes() for p in (files["flac"], files["mp3"])}
    job = call(engine_ctx, "tags.write", {"trackIds": [flac["id"], mp3["id"]], "options": options})
    result = wait_job(engine_ctx, job["jobId"])["result"]
    assert result["written"] == 2
    assert _stored(files["flac"]) == ("-8.50 dB", f"{10 ** (0.3 / 20):.6f}")
    undo = call(engine_ctx, "tags.undo", {"batchId": result["batchId"]})
    assert wait_job(engine_ctx, undo["jobId"])["result"]["restored"] == 2
    assert {p: p.read_bytes() for p in before} == before


def test_traktor_gets_loudness_only_when_asked(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path
) -> None:
    _set_loudness(engine_ctx, library["bloom"], -9.0, -0.2)
    _set_loudness(engine_ctx, library["neon"], -12.0, None)
    # Off by default: Traktor's own analysis stays.
    assert export(engine_ctx, path=str(nml), simulate=False)["status"] == "done"
    kept = entries(ET.fromstring(nml.read_text(encoding="utf-8")))["01 Midnight Bloom.mp3"]
    assert kept.find("LOUDNESS").attrib == {  # type: ignore[union-attr]
        "PEAK_DB": "-0.5", "PERCEIVED_DB": "0.2", "ANALYZED_DB": "0.2"
    }  # fmt: skip

    assert export(engine_ctx, path=str(nml), simulate=False, gain=True)["status"] == "done"
    root = ET.fromstring(nml.read_text(encoding="utf-8"))
    found = entries(root)
    bloom = found["01 Midnight Bloom.mp3"].find("LOUDNESS")
    # Traktor's auto gain reads the gain to apply (here to -14 LUFS) and the true peak.
    assert bloom is not None and bloom.attrib == {
        "PEAK_DB": "-0.200000", "PERCEIVED_DB": "-5.000000", "ANALYZED_DB": "-5.000000"
    }  # fmt: skip
    # Placed where Traktor puts it: after TEMPO, before MUSICAL_KEY.
    tags = [c.tag for c in found["01 Midnight Bloom.mp3"]]
    assert tags.index("TEMPO") < tags.index("LOUDNESS") < tags.index("MUSICAL_KEY")
    neon = found["Neon & Cathedral.flac"].find("LOUDNESS")
    assert neon is not None and neon.get("PERCEIVED_DB") == "-2.000000"
    assert neon.get("PEAK_DB") == "-0.500000"  # the sample peak when no true peak
    assert found["Vorbis.ogg"].find("LOUDNESS") is None  # no loudness measured: nothing
