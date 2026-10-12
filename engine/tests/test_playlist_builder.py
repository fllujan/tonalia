"""Set builder (SPEC 2.17): beam search over DJ Mix transitions plus an energy curve."""

from __future__ import annotations

import itertools
import time
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call
from tests.test_suggest import add
from tests.test_track_update import call_error
from tonalia_engine import playlist_builder as pb
from tonalia_engine.db import Database
from tonalia_engine.keys import compatibility, from_alphanumeric
from tonalia_engine.rpc_schema import CurvePoint, EnergyCurve
from tonalia_engine.server import EngineContext

WHEEL = [f"{n}A" for n in range(1, 13)]


def track(db: Database, track_id: int, key: str, bpm: float, energy: int, **kw: Any) -> None:
    add(db, track_id, key, bpm, energy=energy, genre=kw.get("genre", "Melodic House"))
    db.conn.execute(
        "UPDATE tracks SET duration = ? WHERE id = ?", (kw.get("duration", 360.0), track_id)
    )


def generate(ctx: EngineContext, **params: Any) -> dict[str, Any]:
    result: dict[str, Any] = call(ctx, "builder.generate", params)
    return result


def ids(result: dict[str, Any]) -> list[int]:
    return [item["track"]["id"] for item in result["items"]]


# ---- energy curve ----


def test_curve_templates_and_custom_points() -> None:
    up = pb.curve_targets(EnergyCurve(preset="ascending"), 6, pool_energy=7)
    assert up[0] == pytest.approx(4) and up[-1] == pytest.approx(9)
    assert all(b > a for a, b in itertools.pairwise(up))
    arc = pb.curve_targets(EnergyCurve(), 11, pool_energy=7)
    peak = int(np.argmax(arc))
    assert 0 < peak < 10 and arc[0] < arc[peak] and arc[-1] < arc[peak]
    flat = pb.curve_targets(EnergyCurve(preset="flat"), 5, pool_energy=6.4)
    assert flat == pytest.approx([6.4] * 5)
    drawn = EnergyCurve(
        preset="custom",
        points=[CurvePoint(x=1, energy=2), CurvePoint(x=0, energy=8), CurvePoint(x=0.5, energy=5)],
    )
    assert pb.curve_targets(drawn, 5, pool_energy=7) == pytest.approx([8, 6.5, 5, 3.5, 2])
    assert pb.curve_targets(drawn, 1, pool_energy=7) == pytest.approx([8])


def test_transitions_use_the_dj_mix_scores() -> None:
    a, b = from_alphanumeric("8A"), from_alphanumeric("9A")
    score, parts = pb.transition_score(
        key_a=a, key_b=b, bpm_a=124, bpm_b=126, energy_a=6, energy_b=7, direction="up"
    )
    assert parts["key"] == compatibility(a, b).score == 0.9
    assert parts["bpm"] == pytest.approx(1 - (2 / 124) / 0.06)
    assert parts["energy"] == 1.0
    weights = pb.WEIGHTS["mix"]["weights"]
    expected = sum(weights[k] * parts[k] for k in ("key", "bpm", "energy", "genre"))
    assert score == pytest.approx(expected)


# ---- generation ----


def test_follows_a_harmonic_chain_with_the_energy_curve(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    # A walk around the wheel (8A, 9A, 10A…) with rising energy, plus decoys out of key.
    chain = [8, 9, 10, 11, 12, 1]
    for i, n in enumerate(chain):
        track(db, 10 + i, f"{n}A", 124, energy=4 + i)
    track(db, 30, "3B", 124, energy=9)  # out of key from everything in the chain
    track(db, 31, "2B", 140, energy=5)
    result = generate(
        engine_ctx,
        pool={"trackIds": [10, 11, 12, 13, 14, 15, 30, 31]},
        curve={"preset": "ascending"},
        count=6,
        startTrackId=10,
    )
    assert ids(result) == [10, 11, 12, 13, 14, 15]
    assert result["clashes"] == 0 and result["poolSize"] == 8
    first, second = result["items"][0], result["items"][1]
    assert first["transition"] is None and first["targetEnergy"] == pytest.approx(4)
    t = second["transition"]
    assert (t["relation"], t["quality"], t["clash"], t["energyDelta"]) == (
        "adjacent",
        "good",
        False,
        1,
    )
    assert result["meanScore"] > 0.9
    assert result["duration"] == pytest.approx(6 * 360)


def test_deterministic_with_a_seed_and_never_repeats(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    rng = np.random.default_rng(3)
    for i in range(1, 41):
        track(
            db,
            i,
            WHEEL[int(rng.integers(12))],
            float(rng.uniform(120, 128)),
            int(rng.integers(3, 10)),
        )
    params = {"pool": {"trackIds": list(range(1, 41))}, "count": 15, "seed": 7}
    one, two = generate(engine_ctx, **params), generate(engine_ctx, **params)
    assert ids(one) == ids(two)
    assert len(set(ids(one))) == 15


def test_duration_target_and_playlist_pool(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    for i in range(1, 13):
        track(db, i, WHEEL[i % 12], 124, energy=5 + i % 4, duration=300.0)
    track(db, 99, "8A", 124, energy=6)
    db.conn.execute("UPDATE analysis SET key_root = NULL WHERE track_id = 99")  # not analysed
    playlist = call(engine_ctx, "playlists.create", {"name": "Pool"})
    call(
        engine_ctx,
        "playlists.addTracks",
        {"playlistId": playlist["id"], "trackIds": [*range(1, 13), 99]},
    )
    result = generate(engine_ctx, pool={"playlistId": playlist["id"]}, durationMin=30)
    assert len(result["items"]) == 6  # 30 min of 5-minute tracks
    assert (result["poolSize"], result["skipped"]) == (12, 1)


def test_a_key_clash_only_when_there_is_no_alternative(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    for i, key in enumerate(["8A", "9A", "8B", "7A"], start=1):
        track(db, i, key, 124, energy=6)
    track(db, 5, "5B", 124, energy=6)  # mixes with none of the others, either way
    pool = {"trackIds": [1, 2, 3, 4, 5]}
    avoided = generate(engine_ctx, pool=pool, count=4, curve={"preset": "flat"})
    assert 5 not in ids(avoided) and avoided["clashes"] == 0
    forced = generate(engine_ctx, pool=pool, count=5, curve={"preset": "flat"})
    assert forced["clashes"] >= 1
    bad = [i["transition"] for i in forced["items"][1:] if i["transition"]["clash"]]
    assert bad and all(t["quality"] == "bad" and t["relation"] == "none" for t in bad)


def test_shifting_the_next_track_when_allowed(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    track(db, 1, "8A", 124, energy=6)
    track(db, 2, "3A", 124, energy=6)  # 3A shifted -1 semitone is 8A
    result = generate(
        engine_ctx, pool={"trackIds": [1, 2]}, count=2, startTrackId=1, allowShift=True
    )
    t = result["items"][1]["transition"]
    assert (t["shift"], t["relation"], t["clash"]) == (-1, "same", False)
    plain = generate(engine_ctx, pool={"trackIds": [1, 2]}, count=2, startTrackId=1)
    assert plain["items"][1]["transition"]["shift"] == 0


def test_benchmark_100_tracks_into_a_set_of_20(engine_ctx: EngineContext) -> None:
    """SPEC 9 acceptance: 20 of 100 in < 2 s, no key clash when an alternative exists."""
    db = engine_ctx.db
    rng = np.random.default_rng(42)
    keys = [f"{n}{letter}" for n in range(1, 13) for letter in "AB"]
    for i in range(1, 101):
        track(
            db,
            i,
            keys[int(rng.integers(24))],
            float(rng.uniform(118, 130)),
            int(rng.integers(2, 11)),
        )
    started = time.perf_counter()
    result = generate(engine_ctx, pool={"trackIds": list(range(1, 101))}, count=20)
    elapsed = time.perf_counter() - started
    print(f"builder 100 -> 20: {elapsed * 1000:.0f} ms, mean {result['meanScore']:.2f}")
    assert len(result["items"]) == 20
    assert result["clashes"] == 0
    assert elapsed < 2.0


# ---- scoring an order by hand and replacing a track ----


def test_score_an_order_and_find_alternatives(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    for i, key in enumerate(["8A", "9A", "10A", "3B", "9B"], start=1):
        track(db, i, key, 124, energy=6)
    scored = call(engine_ctx, "builder.score", {"trackIds": [1, 4, 3], "curve": {"preset": "flat"}})
    assert [i["track"]["id"] for i in scored["items"]] == [1, 4, 3]
    assert scored["clashes"] == 2
    alternatives = call(
        engine_ctx,
        "builder.alternatives",
        {"trackIds": [1, 4, 3], "position": 1, "curve": {"preset": "flat"}, "limit": 3},
    )["items"]
    # 9A sits between 8A and 10A perfectly; the set's own tracks are never offered.
    assert alternatives[0]["track"]["id"] == 2
    assert alternatives[0]["delta"] > 0
    assert {a["track"]["id"] for a in alternatives}.isdisjoint({1, 4, 3})
    assert alternatives[0]["into"]["relation"] == "adjacent"
    assert alternatives[0]["out"]["relation"] == "adjacent"


def test_errors(engine_ctx: EngineContext) -> None:
    track(engine_ctx.db, 1, "8A", 124, energy=6)
    track(engine_ctx.db, 2, "9A", 124, energy=6)
    assert call_error(engine_ctx, "builder.generate", {"pool": {}})["code"] == -32602
    start_outside = {"pool": {"trackIds": [1, 2]}, "startTrackId": 7}
    assert call_error(engine_ctx, "builder.generate", start_outside)["code"] == -32602
    custom = {"pool": {"trackIds": [1, 2]}, "curve": {"preset": "custom", "points": []}}
    assert call_error(engine_ctx, "builder.generate", custom)["code"] == -32602
    unknown = {"trackIds": [1, 77]}
    assert call_error(engine_ctx, "builder.score", unknown)["code"] == -32602
    outside = {"trackIds": [1, 2], "position": 2}
    assert call_error(engine_ctx, "builder.alternatives", outside)["code"] == -32602
