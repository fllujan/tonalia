"""Personal energy (SPEC 12.2): rating queue, ratings, calibration, revert and import."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from tests.fixtures.generate import make_all
from tests.test_analysis_queue import call, ctx, import_folder
from tests.test_calibrate_energy import _synthetic_library
from tests.test_track_update import call_error
from tonalia_engine import energy_personal
from tonalia_engine.analysis.energy import EnergyModel, track_energy
from tonalia_engine.server import EngineContext
from tonalia_engine.tags.writer import plan_fields, write_tags

__all__ = ["ctx"]

GENRES = ("Techno", "Deep House", "Drum & Bass")


def add_library(context: EngineContext, n: int, seed: int = 2) -> dict[int, float]:
    """``n`` analysed tracks with stored block descriptors; returns each listener rating."""
    blocks, ratings, model = _synthetic_library(n, seed)
    db = context.db
    for i, raw in enumerate(blocks, 1):
        levels = model.levels(raw)
        curve = [
            {"start": 30.0 * j, "end": 30.0 * (j + 1), "level": round(float(lv), 2)}
            for j, lv in enumerate(levels)
        ]
        title = f"Tema {i}"
        db.conn.execute(
            "INSERT INTO tracks (id, path, title, artist, genre, duration, status, display_title)"
            " VALUES (?, ?, ?, 'Artista', ?, 360, 'ready', ?)",
            (i, f"/música/{i}.mp3", title, GENRES[i % 3], title),
        )
        db.conn.execute(
            "INSERT INTO analysis (track_id, energy, energy_curve, energy_blocks)"
            " VALUES (?, ?, ?, ?)",
            (i, track_energy(levels), json.dumps(curve), json.dumps(raw.tolist())),
        )
    return {i: float(r) for i, r in enumerate(ratings, 1)}


def rate_all(context: EngineContext, ratings: dict[int, float]) -> None:
    for tid, rating in ratings.items():
        call(context, "energy.rate", {"trackId": tid, "rating": int(rating)})


def test_queue_spreads_over_levels_and_genres(ctx: EngineContext) -> None:
    add_library(ctx, 60)
    levels = {
        lv for (lv,) in ctx.db.conn.execute("SELECT DISTINCT energy FROM analysis").fetchall()
    }
    queue = call(ctx, "energy.ratingQueue", {"n": len(levels)})
    assert {item["energy"] for item in queue["items"]} == levels  # one of every level first
    assert queue["status"] == {
        "ratings": 0,
        "usable": 0,
        "needed": 30,
        "model": "default",
        "calibration": None,
        "histogram": [0] * 10,
        "needsReanalysis": 0,
    }
    # Rated tracks leave the queue.
    first = queue["items"][0]["track"]["id"]
    call(ctx, "energy.rate", {"trackId": first, "rating": 7})
    again = call(ctx, "energy.ratingQueue", {"n": 60})
    assert first not in {item["track"]["id"] for item in again["items"]}
    assert len(again["items"]) == 59
    assert again["status"]["histogram"][6] == 1


def test_excerpt_starts_at_the_drop_and_fits_the_track(ctx: EngineContext) -> None:
    add_library(ctx, 2)
    ctx.db.conn.execute(
        "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (1, 95.5, 160, 'drop')"
    )
    ctx.db.conn.execute(
        "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (2, 350, 360, 'drop')"
    )
    items = {i["track"]["id"]: i["start"] for i in call(ctx, "energy.ratingQueue")["items"]}
    assert items[1] == 95.5
    assert items[2] == 340.0  # 20 s must fit before the end


def test_tracks_without_descriptors_wait_for_reanalysis(ctx: EngineContext) -> None:
    add_library(ctx, 3)
    ctx.db.conn.execute("UPDATE analysis SET energy_blocks = NULL WHERE track_id = 3")
    queue = call(ctx, "energy.ratingQueue")
    assert {i["track"]["id"] for i in queue["items"]} == {1, 2}
    assert queue["status"]["needsReanalysis"] == 1


def test_rate_validates_and_can_be_cleared(ctx: EngineContext) -> None:
    add_library(ctx, 1)
    assert call(ctx, "energy.rate", {"trackId": 1, "rating": 10})["ratings"] == 1
    assert call(ctx, "energy.rate", {"trackId": 1, "rating": None})["ratings"] == 0
    assert call_error(ctx, "energy.rate", {"trackId": 1, "rating": 11})["data"]["reason"] == (
        "invalid_params"
    )
    missing = call_error(ctx, "energy.rate", {"trackId": 99, "rating": 5})
    assert missing["data"]["reason"] == "track_not_found"


def test_calibration_needs_30_ratings(ctx: EngineContext) -> None:
    ratings = add_library(ctx, 29)
    rate_all(ctx, ratings)
    error = call_error(ctx, "energy.calibrate", {})
    assert error["data"]["reason"] == "not_enough_ratings"
    assert error["data"]["params"] == {"count": "29", "needed": "30"}


def test_calibrate_preview_apply_and_revert(ctx: EngineContext) -> None:
    ratings = add_library(ctx, 80)
    rated = dict(list(ratings.items())[:40])
    rate_all(ctx, rated)
    # A track whose energy the user set by hand keeps it.
    ctx.db.conn.execute(
        "UPDATE analysis SET energy = 3, edited_fields = '[\"energy\"]' WHERE track_id = 80"
    )
    before = dict(ctx.db.conn.execute("SELECT track_id, energy FROM analysis").fetchall())

    preview = call(ctx, "energy.calibrate", {"apply": False})
    assert preview["tracks"] == 40 and not preview["applied"] and preview["updated"] == 0
    assert preview["maeAfter"] <= 1.0 < preview["maeBefore"]
    assert dict(ctx.db.conn.execute("SELECT track_id, energy FROM analysis").fetchall()) == before

    applied = call(ctx, "energy.calibrate", {"apply": True})
    assert applied["applied"] and applied["updated"] == 80
    assert applied["status"]["model"] == "personal"
    assert applied["status"]["calibration"]["tracks"] == 40
    after = dict(ctx.db.conn.execute("SELECT track_id, energy FROM analysis").fetchall())
    assert after[80] == 3
    unrated = [tid for tid in ratings if tid not in rated and tid != 80]
    mae = np.mean([abs(after[t] - ratings[t]) for t in unrated])
    mae_default = np.mean([abs(before[t] - ratings[t]) for t in unrated])
    assert mae <= 1.0 and mae < mae_default  # the 40 tracks it never heard improve too
    curve = json.loads(
        ctx.db.conn.execute("SELECT energy_curve FROM analysis WHERE track_id = 1").fetchone()[0]
    )
    assert curve[0]["start"] == 0.0 and curve[0]["end"] == 30.0

    reverted = call(ctx, "energy.revert")
    assert reverted["updated"] == 80 and reverted["status"]["model"] == "default"
    assert reverted["status"]["calibration"]["tracks"] == 40  # kept to apply again
    assert dict(ctx.db.conn.execute("SELECT track_id, energy FROM analysis").fetchall()) == before


def test_new_analyses_use_the_personal_model(ctx: EngineContext) -> None:
    ratings = add_library(ctx, 40)
    rate_all(ctx, ratings)
    call(ctx, "energy.calibrate", {"apply": True})
    params = energy_personal.personal_params(ctx.db)
    assert params is not None
    settings, _ = ctx.analysis._settings(ctx.db)
    assert settings.energy_params == params
    personal = EnergyModel.load().with_params(params)
    assert personal.weights != EnergyModel.load().weights


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("Energy 7", 7),
        ("8A - energy 10 | warm", 10),
        ("E8 peak", 8),
        ("7 - Melodic", 7),
        ("9", 9),
        ("BE7 track", None),  # not a whole word
        ("Energy 11", None),
        ("Remix 2021", None),
        ("Track 7 - 2", None),  # "{n} - " only at the start
    ],
)
def test_default_patterns(text: str, level: int | None) -> None:
    regexes = energy_personal.compile_patterns(energy_personal.DEFAULT_PATTERNS)
    assert energy_personal.find_level(text, regexes) == level


def test_import_reads_tags_but_not_tonalias_own(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "Valoradas ñ"
    files = make_all(folder, stem="tema 🎧")
    (folder / "tema 🎧.source.wav").unlink()
    write_tags(files["mp3"], plan_fields(files["mp3"], {"comment": "Energy 8 · cálido"}))
    write_tags(files["flac"], plan_fields(files["flac"], {"grouping": "E6"}))
    import_folder(ctx, folder)
    ids = {row[1]: row[0] for row in ctx.db.conn.execute("SELECT id, path FROM tracks").fetchall()}
    mp3, flac, m4a = ids[str(files["mp3"])], ids[str(files["flac"])], ids[str(files["m4a"])]
    # Tonalia wrote "{key} - Energy {energy}" in this one: its own estimate, not a rating.
    write_tags(files["m4a"], plan_fields(files["m4a"], {"comment": "8A - Energy 5"}))
    ctx.db.conn.execute("INSERT INTO tag_batches (id, options, written) VALUES ('b1', '{}', 1)")
    ctx.db.conn.execute(
        "INSERT INTO tag_backups (batch_id, track_id, path, original_tags, changes) "
        "VALUES ('b1', ?, ?, x'00', ?)",
        (
            m4a,
            str(files["m4a"]),
            json.dumps([{"field": "comment", "before": None, "after": "8A - Energy 5"}]),
        ),
    )

    preview = call(ctx, "energy.importPreview")
    found = {i["trackId"]: (i["field"], i["rating"]) for i in preview["items"]}
    assert found == {mp3: ("comment", 8), flac: ("grouping", 6)}
    assert preview["writtenByTonalia"] == 1
    assert preview["scanned"] == len(files)

    # A rating given by ear is kept unless the user asks to overwrite it.
    call(ctx, "energy.rate", {"trackId": mp3, "rating": 9})
    items = [{"trackId": t, "rating": r} for t, (_, r) in found.items()]
    result = call(ctx, "energy.import", {"items": items})
    assert result["stored"] == 1 and result["status"]["ratings"] == 2
    rows = dict(ctx.db.conn.execute("SELECT track_id, rating FROM energy_ratings").fetchall())
    assert rows == {mp3: 9, flac: 6}
    call(ctx, "energy.import", {"items": items, "overwrite": True})
    rows = dict(ctx.db.conn.execute("SELECT track_id, rating FROM energy_ratings").fetchall())
    assert rows == {mp3: 8, flac: 6}


def test_import_patterns_are_validated(ctx: EngineContext) -> None:
    error = call_error(ctx, "energy.importPreview", {"patterns": ["Energy"]})
    assert error["data"]["reason"] == "invalid_params"
