"""Idea engine (SPEC 2.15): mashup and DJ Mix suggestions."""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call
from tonalia_engine import suggest
from tonalia_engine.db import Database
from tonalia_engine.keys import Key, compatibility, from_alphanumeric
from tonalia_engine.server import EngineContext, build_dispatcher
from tonalia_engine.suggest import (
    KEY_RELATIONS,
    KEY_SCORES,
    WEIGHTS,
    bpm_scores,
    energy_scores,
    genre_family,
    genre_scores,
    is_acapella,
    key_index,
    vocal_scores,
)

# ---- scoring pieces ----


def test_key_matrix_matches_the_wheel_table() -> None:
    for a in range(24):
        for b in range(24):
            ka = Key(a % 12, "major" if a < 12 else "minor")
            kb = Key(b % 12, "major" if b < 12 else "minor")
            c = compatibility(ka, kb)
            assert KEY_SCORES[key_index(ka), key_index(kb)] == c.score
            assert KEY_RELATIONS[key_index(ka)][key_index(kb)] == c.relation


def test_bpm_score_with_half_and_double_tempo() -> None:
    bpm = np.array([124.0, 126.0, 62.0, 248.0, 132.0, 140.0])
    score, factor = bpm_scores(124.0, bpm, tolerance=0.10)
    assert score[0] == 1.0
    assert score[1] == pytest.approx(1 - (2 / 124) / 0.10)
    assert (score[2], factor[2]) == (1.0, 2.0)
    assert (score[3], factor[3]) == (1.0, 0.5)
    assert score[4] == pytest.approx(1 - (8 / 124) / 0.10)
    tight, _ = bpm_scores(124.0, bpm, tolerance=0.06)
    assert tight[4] == 0.0 and tight[5] == 0.0


def test_energy_scores_by_mode() -> None:
    b = np.array([7, 8, 9, 6, 4, -1], dtype=float)  # -1 = unknown
    mashup = energy_scores(7, b, "mashup", "up")
    assert mashup[0] == 1.0 and mashup[1] > mashup[2] and mashup[5] == 0.5
    assert mashup[1] == mashup[3]  # closeness is symmetric
    up = energy_scores(7, b, "mix", "up")
    assert up[0] == up[1] == 1.0 and up[2] < 1.0 and up[3] < 1.0
    keep = energy_scores(7, b, "mix", "keep")
    assert keep[0] == 1.0 and keep[1] < 1.0
    down = energy_scores(7, b, "mix", "down")
    assert down[3] == 1.0 and down[1] < 1.0
    assert energy_scores(None, b, "mix", "up").tolist() == [0.5] * 6


def test_vocal_complementarity() -> None:
    b = np.array([0.05, 0.4, 0.2, np.nan])
    score = vocal_scores(0.45, b)
    assert score[0] == 1.0  # lots of voice in A, almost none in B
    assert score[1] < 0.3  # both sing
    assert 0 < score[2] < 1 and score[3] == 0.5
    assert vocal_scores(None, b).tolist() == [0.5] * 4


def test_genre_affinity() -> None:
    assert genre_family("Melodic House") == genre_family("tech house") == "house"
    assert genre_family("Drum & Bass") == genre_family("DnB") == "drum_and_bass"
    assert genre_family("Polka") is None
    names = ["melodic house", "deep house", "techno", "", "polka"]
    fams = [genre_family(n) for n in names]
    score = genre_scores("Melodic House", names, fams)
    assert score.tolist() == [1.0, 0.6, 0.0, 0.0, 0.0]


def test_weights_follow_the_spec() -> None:
    assert WEIGHTS["mashup"]["weights"] == {
        "key": 0.45, "bpm": 0.25, "vocal": 0.15, "energy": 0.10, "genre": 0.05,
    }  # fmt: skip
    assert WEIGHTS["mix"]["weights"] == {"key": 0.40, "bpm": 0.30, "energy": 0.20, "genre": 0.10}
    assert WEIGHTS["mashup"]["bpm_tolerance"] == 0.10
    assert WEIGHTS["mix"]["bpm_tolerance"] == 0.06
    assert WEIGHTS["shift_penalty"] == 0.05


# ---- through RPC ----


def add(
    db: Database,
    track_id: int,
    key: str | None,
    bpm: float | None,
    energy: int | None = 7,
    vocal: float | None = None,
    genre: str | None = "Melodic House",
    title: str | None = None,
) -> None:
    title = title or f"Track {track_id}"
    db.conn.execute(
        "INSERT INTO tracks (id, path, title, artist, genre, status, display_title)"
        " VALUES (?, ?, ?, 'Artist', ?, 'ready', ?)",
        (track_id, f"/music/{track_id}.mp3", title, genre, title),
    )
    k = from_alphanumeric(key) if key else None
    db.conn.execute(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, vocal_presence)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (track_id, k.root if k else None, k.mode if k else None, bpm, energy, vocal),
    )


def ideas(ctx: EngineContext, method: str = "suggest.mashups", **params: Any) -> dict[str, Any]:
    result: dict[str, Any] = call(ctx, method, params)
    return result


def first(result: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = result["items"][0]
    return item


def test_mashup_ranking_reasons_and_shifts(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124, energy=7, vocal=0.45)  # deck A: a vocal track
    add(db, 2, "8A", 124, energy=7, vocal=0.05)  # same key, instrumental: the best idea
    add(db, 3, "8A", 124, energy=7, vocal=0.45)  # same key but also sung
    add(db, 4, "10A", 124, energy=7, vocal=0.05)  # same key after shifting -2 semitones
    add(db, 5, "3B", 124, energy=7, vocal=0.05)  # nothing compatible within ±2
    add(db, 6, None, None)  # not analysed: never suggested
    result = ideas(engine_ctx, trackId=1)
    assert result["mode"] == "mashup" and result["candidates"] == 4
    # The weights behind the score, so the UI can rescore a manual key change of B.
    assert (result["keyWeight"], result["shiftPenalty"]) == (0.45, 0.05)
    ids = [i["track"]["id"] for i in result["items"]]
    assert ids[0] == 2 and 1 not in ids and 6 not in ids
    best = first(result)
    assert best["shiftB"] == 0 and best["relation"] == "same" and best["bpmFactor"] == 1.0
    assert best["scores"]["key"] == 1.0 and best["scores"]["vocal"] == 1.0
    assert best["score"] == 100
    codes = {(r["kind"], r["code"]) for r in best["reasons"]}
    assert {("key", "same"), ("vocals", "a"), ("bpm", "same")} <= codes
    shifted = next(i for i in result["items"] if i["track"]["id"] == 4)
    assert shifted["shiftB"] == -2 and shifted["relation"] == "same"
    assert shifted["keyB"] == {"root": 9, "mode": "minor"}  # 10A - 2 st = 8A (Am)
    assert {"kind": "shift", "code": "b", "value": -2.0} in shifted["reasons"]
    assert shifted["score"] == 100 - 10  # -0.05 per semitone
    # 3B is relative to 8A after -1 semitone (88); the sung 8A loses the vocal score (85).
    assert ids == [2, 4, 5, 3]
    relative = next(i for i in result["items"] if i["track"]["id"] == 5)
    assert (relative["shiftB"], relative["relation"], relative["score"]) == (-1, "relative", 88)
    # Without shifting, 10A is only a +2 "energy boost" away.
    plain = ideas(engine_ctx, trackId=1, allowShift=False)
    assert next(i for i in plain["items"] if i["track"]["id"] == 4)["relation"] == "energy_boost"
    assert all(i["shiftB"] == 0 for i in plain["items"])


def test_shifting_deck_a_recomputes_the_ideas(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124)
    add(db, 2, "3A", 124)  # +1 semitone from 8A (8 + 7 = 15 → 3)
    add(db, 3, "8A", 124)
    assert first(ideas(engine_ctx, trackId=1, allowShift=False))["track"]["id"] == 3
    moved = ideas(engine_ctx, trackId=1, shiftA=1, allowShift=False)
    assert moved["shiftA"] == 1
    assert first(moved)["track"]["id"] == 2 and first(moved)["relation"] == "same"


def test_half_and_double_tempo_and_bpm_tolerance(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 87)
    add(db, 2, "8A", 174)  # drum & bass at double tempo
    add(db, 3, "8A", 100)  # 15 % away: beyond the mashup tolerance
    result = ideas(engine_ctx, trackId=1)
    items = {i["track"]["id"]: i for i in result["items"]}
    assert items[2]["bpmFactor"] == 0.5 and items[2]["scores"]["bpm"] == 1.0
    assert {"kind": "bpm", "code": "double", "value": 0.0} in items[2]["reasons"]
    assert items[3]["scores"]["bpm"] == 0.0


def test_mix_prefers_raising_the_energy(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124, energy=6)
    add(db, 2, "8A", 124, energy=4)
    add(db, 3, "8A", 124, energy=7)
    add(db, 4, "9A", 125, energy=6)
    result = ideas(engine_ctx, "suggest.mixouts", trackId=1)
    assert result["mode"] == "mix"
    assert first(result)["track"]["id"] == 3
    assert first(result)["scores"]["vocal"] == 0.0
    assert {"kind": "energy", "code": "up", "value": 1.0} in first(result)["reasons"]
    down = ideas(engine_ctx, "suggest.mixouts", trackId=1, energyDirection="down")
    assert first(down)["track"]["id"] != 3
    # DJ Mix uses the stricter 6 % tempo tolerance.
    add(db, 5, "8A", 132, energy=7)
    mix = {i["track"]["id"]: i for i in ideas(engine_ctx, "suggest.mixouts", trackId=1)["items"]}
    mash = {i["track"]["id"]: i for i in ideas(engine_ctx, trackId=1)["items"]}
    assert mix[5]["scores"]["bpm"] == 0.0 < mash[5]["scores"]["bpm"]


def test_is_acapella() -> None:
    for title, genre in [
        ("Run The Signal (Acapella)", None),
        ("Run The Signal (A Cappella)", "House"),
        ("Run The Signal - Acappella", None),
        ("Run The Signal [a capella]", None),
        ("Run The Signal", "Acapella"),
        ("Run The Signal", "Acapellas & Vocals"),
    ]:
        assert is_acapella(title, genre), (title, genre)
    negatives: list[tuple[str | None, str | None]] = [
        ("Capella Grey", "Hip Hop"),
        ("Run The Signal", "House"),
        (None, None),
    ]
    for neg_title, neg_genre in negatives:
        assert not is_acapella(neg_title, neg_genre), (neg_title, neg_genre)


def test_mix_puts_acapellas_last_but_mashups_keep_them(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124, energy=6, vocal=0.05)
    add(db, 2, "8A", 124, energy=7, vocal=0.6, title="Run The Signal (Acapella)")
    add(db, 3, "9A", 125, energy=7, vocal=0.05)  # a little worse on paper, but mixable
    mix = ideas(engine_ctx, "suggest.mixouts", trackId=1)
    ids = [i["track"]["id"] for i in mix["items"]]
    assert ids == [3, 2]
    acapella = next(i for i in mix["items"] if i["track"]["id"] == 2)
    assert {"kind": "acapella", "code": "mix"} in [
        {"kind": r["kind"], "code": r["code"]} for r in acapella["reasons"]
    ]
    # Over an instrumental, an acapella is exactly what a mashup wants.
    assert first(ideas(engine_ctx, trackId=1))["track"]["id"] == 2


def test_an_acapella_is_the_voice_of_a_mashup_without_vocal_data(
    engine_ctx: EngineContext,
) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124, energy=6)  # no vocal presence measured yet
    add(db, 2, "8A", 124, energy=6, title="Run The Signal (Acapella)")
    idea = first(ideas(engine_ctx, trackId=1))
    assert idea["track"]["id"] == 2
    assert {"kind": "vocals", "code": "b"} in [
        {"kind": r["kind"], "code": r["code"]} for r in idea["reasons"]
    ]
    # With the acapella on deck A, the voice comes from A.
    back = first(ideas(engine_ctx, trackId=2))
    assert {"kind": "vocals", "code": "a"} in [
        {"kind": r["kind"], "code": r["code"]} for r in back["reasons"]
    ]


def test_idea_filters(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124, energy=6)
    add(db, 2, "8A", 124, energy=9, genre="Techno")
    add(db, 3, "8A", 128, energy=5, genre="Deep House")
    add(db, 4, "8A", 140, energy=6, genre="Melodic House")
    pl = call(engine_ctx, "playlists.create", {"name": "Peak", "emoji": "🔥"})["id"]
    call(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": [2, 3]})

    def ids(**filters: Any) -> list[int]:
        result = ideas(engine_ctx, trackId=1, filters=filters)
        return sorted(i["track"]["id"] for i in result["items"])

    assert ids() == [2, 3, 4]
    assert ids(energyMin=5, energyMax=6) == [3, 4]
    assert ids(bpmMin=120, bpmMax=130) == [2, 3]
    assert ids(genres=["techno", "Deep House"]) == [2, 3]
    assert ids(playlistIds=[pl]) == [2, 3]
    assert ids(playlistIds=[pl], genres=["Techno"]) == [2]
    excluded = ideas(engine_ctx, trackId=1, exclude=[2, 3])
    assert [i["track"]["id"] for i in excluded["items"]] == [4]


def test_ideas_follow_library_changes(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add(db, 1, "8A", 124)
    add(db, 2, "3B", 124)
    assert first(ideas(engine_ctx, trackId=1, allowShift=False))["relation"] == "none"
    # A manual key edit (main connection) and a write from another connection.
    call(engine_ctx, "track.update", {"trackId": 2, "key": {"root": 9, "mode": "minor"}})
    assert first(ideas(engine_ctx, trackId=1, allowShift=False))["relation"] == "same"
    other = Database.open(engine_ctx.db_path)
    add(other, 3, "8B", 124)
    other.close()
    result = ideas(engine_ctx, trackId=1, allowShift=False)
    assert result["candidates"] == 2


def test_errors(engine_ctx: EngineContext) -> None:
    add(engine_ctx.db, 1, None, None)

    def error(params: dict[str, Any]) -> dict[str, Any]:
        msg = {"jsonrpc": "2.0", "id": 1, "method": "suggest.mashups", "params": params}
        reply = build_dispatcher(engine_ctx).handle_line(__import__("json").dumps(msg))
        assert reply is not None
        out: dict[str, Any] = __import__("json").loads(reply)["error"]
        return out

    assert "999" in error({"trackId": 999})["message"]
    assert "analys" in error({"trackId": 1})["message"]
    assert error({"trackId": 1, "shiftA": 9})["code"] == -32602


# ---- benchmark (SPEC 8.1: < 200 ms for 20 000 tracks) ----


def test_benchmark_20000_tracks(engine_ctx: EngineContext) -> None:
    rng = np.random.default_rng(7)
    genres = ["Melodic House", "Techno", "Deep House", "Drum & Bass", "Afro House", "Pop", None]
    rows = []
    for i in range(1, 20_001):
        rows.append(
            (
                i,
                f"/music/{i}.mp3",
                f"Track {i}",
                genres[int(rng.integers(len(genres)))],
                f"Track {i}",
            )
        )
    db = engine_ctx.db
    db.conn.executemany(
        "INSERT INTO tracks (id, path, title, genre, status, display_title)"
        " VALUES (?, ?, ?, ?, 'ready', ?)",
        rows,
    )
    db.conn.executemany(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, vocal_presence)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                i,
                int(rng.integers(12)),
                "minor" if rng.random() < 0.5 else "major",
                float(rng.uniform(80, 175)),
                int(rng.integers(1, 11)),
                float(rng.uniform(0, 0.6)),
            )
            for i in range(1, 20_001)
        ],
    )
    suggest.clear_cache()
    started = time.perf_counter()
    cold = ideas(engine_ctx, trackId=1)
    cold_ms = (time.perf_counter() - started) * 1000
    timings = []
    for shift_a in (0, 1, -1, 2):
        started = time.perf_counter()
        warm = ideas(engine_ctx, trackId=1, shiftA=shift_a, limit=50)
        timings.append((time.perf_counter() - started) * 1000)
    mix_started = time.perf_counter()
    ideas(engine_ctx, "suggest.mixouts", trackId=2)
    timings.append((time.perf_counter() - mix_started) * 1000)
    print(f"20k ideas: cold {cold_ms:.0f} ms, warm {', '.join(f'{t:.0f}' for t in timings)} ms")
    assert cold["candidates"] == 19_999 and len(warm["items"]) == 50
    assert max(timings) < 200
    assert cold_ms < 1000
