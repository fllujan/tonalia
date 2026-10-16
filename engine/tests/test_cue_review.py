"""Assisted cue review (SPEC 12.5): verdicts per cue, the queue and the accuracy report."""

from __future__ import annotations

import json
from typing import Any

import pytest

from tests.test_analysis_queue import call, ctx
from tests.test_cues_rpc import analysed
from tests.test_track_update import call_error
from tonalia_engine.server import EngineContext
from tools.cue_report import render_markdown

__all__ = ["analysed", "ctx"]


def queue(ctx: EngineContext, **params: Any) -> dict[str, Any]:
    out: dict[str, Any] = call(ctx, "cueReview.queue", params)
    return out


def test_the_queue_brings_analysed_tracks_with_their_automatic_cues(
    ctx: EngineContext, analysed: int
) -> None:
    out = queue(ctx, n=20)
    assert [i["track"]["id"] for i in out["items"]] == [analysed]
    item = out["items"][0]
    detail = call(ctx, "library.get", {"trackId": analysed})
    autos = [c for c in detail["cues"] if c["source"] == "auto"]
    assert [c["slot"] for c in item["cues"]] == [c["slot"] for c in autos]
    assert item["barSeconds"] == pytest.approx(240.0 / detail["beatGrid"]["bpm"], abs=1e-3)
    assert item["verdicts"] == {}
    assert out["report"]["reviewedCues"] == 0 and out["report"]["accuracy"] is None


def test_verdicts_make_the_report_and_a_reviewed_track_leaves_the_queue(
    ctx: EngineContext, analysed: int
) -> None:
    cues = queue(ctx, n=20)["items"][0]["cues"]
    first, second, *rest = cues
    call(ctx, "cueReview.set", {"trackId": analysed, "slot": first["slot"], "verdict": "ok"})
    # Changing one's mind replaces the verdict: it is not counted twice.
    call(ctx, "cueReview.set", {"trackId": analysed, "slot": second["slot"], "verdict": "ok"})
    wrong = call(
        ctx, "cueReview.set", {"trackId": analysed, "slot": second["slot"], "verdict": "wrong"}
    )
    missing = call(
        ctx,
        "cueReview.set",
        {"trackId": analysed, "verdict": "missing", "positionSec": first["positionSec"] + 1.0},
    )
    report = call(ctx, "cueReview.report")
    assert report["reviewedCues"] == 2 and report["correct"] == 1
    assert report["accuracy"] == pytest.approx(0.5)
    assert report["missing"] == 1 and report["tracks"] == 1
    sections = {s["label"]: s for s in report["bySection"]}
    assert sections[second["label"]]["wrong"] == 1
    assert sections[first["label"]]["missing"] == 1  # the section where the cue was missing
    # The verdicts come back with the queue (single-track mode keeps a reviewed track).
    item = queue(ctx, n=20, trackIds=[analysed])["items"][0]
    assert item["verdicts"] == {str(first["slot"]): "ok", str(second["slot"]): "wrong"}
    assert item["missing"] == [pytest.approx(first["positionSec"] + 1.0)]

    # Undo takes a verdict back.
    call(ctx, "cueReview.delete", {"reviewId": missing["reviewId"]})
    assert call(ctx, "cueReview.report")["missing"] == 0

    for cue in rest:
        call(ctx, "cueReview.set", {"trackId": analysed, "slot": cue["slot"], "verdict": "ok"})
    assert queue(ctx, n=20)["items"] == []
    assert wrong["reviewId"] > 0


def test_correcting_a_misplaced_cue_keeps_the_verdict_on_the_automatic_position(
    ctx: EngineContext, analysed: int
) -> None:
    cue = queue(ctx, n=20)["items"][0]["cues"][1]
    call(ctx, "cueReview.set", {"trackId": analysed, "slot": cue["slot"], "verdict": "wrong"})
    call(
        ctx,
        "cues.set",
        {"trackId": analysed, "slot": cue["slot"], "positionSec": cue["positionSec"] + 7.7},
    )
    report = call(ctx, "cueReview.report")
    assert report["reviewedCues"] == 1 and report["correct"] == 0
    # The moved cue is the user's now; reanalysing does not undo the review either.
    from tests.test_analysis_queue import wait_job

    wait_job(ctx, call(ctx, "analysis.reanalyze", {"trackIds": [analysed]})["jobId"])
    assert call(ctx, "cueReview.report")["reviewedCues"] == 1


def test_bad_verdicts_are_refused(ctx: EngineContext, analysed: int) -> None:
    no_slot = call_error(ctx, "cueReview.set", {"trackId": analysed, "verdict": "ok"})
    assert no_slot["data"]["reason"] == "invalid_params"
    empty = call_error(ctx, "cueReview.set", {"trackId": analysed, "slot": 7, "verdict": "ok"})
    assert empty["data"]["reason"] == "invalid_params"
    no_time = call_error(ctx, "cueReview.set", {"trackId": analysed, "verdict": "missing"})
    assert no_time["data"]["reason"] == "invalid_params"
    unknown = call_error(ctx, "cueReview.set", {"trackId": 999, "slot": 0, "verdict": "ok"})
    assert unknown["data"]["reason"] == "track_not_found"


def test_the_report_for_the_docs_has_no_titles_or_paths(ctx: EngineContext, analysed: int) -> None:
    for cue in queue(ctx, n=20)["items"][0]["cues"]:
        verdict = "wrong" if cue["label"] == "breakdown" else "ok"
        call(ctx, "cueReview.set", {"trackId": analysed, "slot": cue["slot"], "verdict": verdict})
    report = call(ctx, "cueReview.report")
    detail = call(ctx, "library.get", {"trackId": analysed})
    text = json.dumps(report) + render_markdown(report, "2026-10-16")
    assert detail["path"] not in text and "club" not in text
    md = render_markdown(report, "2026-10-16")
    assert "| Breakdown |" in md and "80 %" in md


def test_the_section_in_accuracy_md_is_replaced_not_duplicated(tmp_path: Any) -> None:
    from tools.cue_report import END, START, write_section

    doc = tmp_path / "accuracy.md"
    doc.write_text("# Precisión\n\n## Qué cambió y por qué\n\nTexto.\n", encoding="utf-8")
    write_section("primera\n", doc)
    write_section("segunda\n", doc)
    text = doc.read_text(encoding="utf-8")
    assert text.count(START) == 1 and text.count(END) == 1
    assert "segunda" in text and "primera" not in text
    assert text.index(START) < text.index("## Qué cambió y por qué")
