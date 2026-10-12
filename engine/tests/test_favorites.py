"""Mashup favorites (SPEC 2.15): save, rate, annotate, list, delete."""

from __future__ import annotations

from typing import Any

from tests.test_analysis_queue import call
from tests.test_suggest import add
from tests.test_track_update import call_error
from tonalia_engine.db import SCHEMA_VERSION, Database
from tonalia_engine.server import EngineContext

COMBO = {
    "trackA": 1,
    "trackB": 2,
    "mode": "mashup",
    "shiftA": 0,
    "shiftB": -2,
    "cueA": 0.3,
    "cueB": 62.2,
    "stemA": "vocals",
    "stemB": "instrumental",
    "bpmFactor": 1,
}


def library(ctx: EngineContext) -> None:
    add(ctx.db, 1, "8A", 124, energy=7)
    add(ctx.db, 2, "10A", 124, energy=6)
    add(ctx.db, 3, "9A", 62, energy=8)


def save(ctx: EngineContext, **fields: Any) -> dict[str, Any]:
    result: dict[str, Any] = call(ctx, "favorites.save", {**COMBO, **fields})
    return result


def test_migration_adds_the_deck_settings(engine_ctx: EngineContext) -> None:
    db: Database = engine_ctx.db
    assert db.version == SCHEMA_VERSION
    cols = {r["name"] for r in db.conn.execute("PRAGMA table_info(favorites)")}
    assert {"stem_a", "stem_b", "bpm_factor"} <= cols


def test_save_returns_the_combination_with_both_tracks(engine_ctx: EngineContext) -> None:
    library(engine_ctx)
    fav = save(engine_ctx, rating=4, notes="Acapella encima ✨")
    assert fav["id"] > 0 and fav["createdAt"]
    assert {k: fav[k] for k in COMBO} == COMBO
    assert (fav["rating"], fav["notes"]) == (4, "Acapella encima ✨")
    assert fav["a"]["title"] == "Track 1" and fav["b"]["bpm"] == 124

    # The same combination again updates it instead of duplicating it.
    again = save(engine_ctx, cueA=16.1, rating=5)
    assert again["id"] == fav["id"]
    assert (again["cueA"], again["rating"], again["notes"]) == (16.1, 5, "Acapella encima ✨")
    # Another key change of B is another favorite.
    other = save(engine_ctx, shiftB=0)
    assert other["id"] != fav["id"]
    assert len(call(engine_ctx, "favorites.list")["items"]) == 2


def test_list_sorts_by_date_or_rating(engine_ctx: EngineContext) -> None:
    library(engine_ctx)
    low = save(engine_ctx, rating=1)
    high = save(engine_ctx, trackB=3, mode="mix", bpmFactor=0.5, rating=5, stemA="mix", stemB="mix")
    mid = save(engine_ctx, shiftB=1, rating=3)
    by_date = [f["id"] for f in call(engine_ctx, "favorites.list")["items"]]
    assert by_date == [mid["id"], high["id"], low["id"]]
    by_rating = call(engine_ctx, "favorites.list", {"sort": "rating"})["items"]
    assert [f["id"] for f in by_rating] == [high["id"], mid["id"], low["id"]]
    assert by_rating[0]["bpmFactor"] == 0.5 and by_rating[0]["mode"] == "mix"


def test_update_rating_and_notes_only_what_is_sent(engine_ctx: EngineContext) -> None:
    library(engine_ctx)
    fav = save(engine_ctx, rating=2, notes="intro")
    rated = call(engine_ctx, "favorites.update", {"favoriteId": fav["id"], "rating": 5})
    assert (rated["rating"], rated["notes"]) == (5, "intro")
    cleared = call(engine_ctx, "favorites.update", {"favoriteId": fav["id"], "notes": None})
    assert (cleared["rating"], cleared["notes"]) == (5, None)
    blank = call(engine_ctx, "favorites.update", {"favoriteId": fav["id"], "notes": "   "})
    assert blank["notes"] is None


def test_delete_and_tracks_leaving_the_library(engine_ctx: EngineContext) -> None:
    library(engine_ctx)
    fav = save(engine_ctx)
    gone = save(engine_ctx, trackB=3)
    assert call(engine_ctx, "favorites.delete", {"favoriteId": fav["id"]}) == {"deleted": True}
    assert call(engine_ctx, "favorites.delete", {"favoriteId": fav["id"]}) == {"deleted": False}
    call(engine_ctx, "library.remove", {"trackIds": [3]})
    assert [f["id"] for f in call(engine_ctx, "favorites.list")["items"]] == []
    assert gone["id"] > fav["id"]


def test_errors(engine_ctx: EngineContext) -> None:
    library(engine_ctx)
    assert call_error(engine_ctx, "favorites.save", {**COMBO, "trackB": 99})["code"] == -32602
    assert call_error(engine_ctx, "favorites.save", {**COMBO, "trackB": 1})["code"] == -32602
    assert call_error(engine_ctx, "favorites.save", {**COMBO, "rating": 6})["code"] == -32602
    assert call_error(engine_ctx, "favorites.save", {**COMBO, "shiftB": 7})["code"] == -32602
    assert call_error(engine_ctx, "favorites.save", {**COMBO, "stemA": "drums"})["code"] == -32602
    assert (
        call_error(engine_ctx, "favorites.update", {"favoriteId": 42, "rating": 1})["code"]
        == -32602
    )
