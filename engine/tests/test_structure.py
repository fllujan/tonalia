import numpy as np
import pytest

from tests.fixtures.energy import section
from tests.fixtures.music import SR
from tonalia_engine.analysis.structure import (
    CUE_COLORS,
    Segment,
    auto_cues,
    detect_structure,
    merge_runs,
)
from tonalia_engine.analysis.tempo import BeatGrid

BPM = 124.0
BAR = 4 * 60.0 / BPM
GRID = BeatGrid("constant", BPM, 0.0)

# A typical club arrangement, in bars: (level, bars, expected label).
PLAN = [
    (0.35, 16, "intro"),
    (0.6, 8, "build"),
    (1.0, 16, "drop"),
    (0.05, 16, "breakdown"),
    (0.6, 8, "build"),
    (1.0, 16, "drop"),
    (0.35, 16, "outro"),
]


@pytest.fixture(scope="module")
def club_track() -> np.ndarray:
    return np.concatenate(
        [section(lv, bars * BAR, BPM, seed=i) for i, (lv, bars, _) in enumerate(PLAN)]
    )


def expected_starts() -> list[float]:
    bars = np.cumsum([0] + [b for _, b, _ in PLAN])[:-1]
    return [float(b * BAR) for b in bars]


def test_boundaries_fall_on_the_real_section_changes(club_track: np.ndarray) -> None:
    result = detect_structure(club_track, SR, GRID)
    assert result is not None
    starts = [s.start for s in result.segments]
    # Every real change is found within one bar, and nothing spurious is added.
    for real in expected_starts():
        assert min(abs(s - real) for s in starts) < BAR / 2, (real, starts)
    assert len(starts) <= len(PLAN) + 1
    # Boundaries are on downbeats exactly.
    assert all(abs(s / BAR - round(s / BAR)) < 1e-6 for s in starts)
    assert result.segments[-1].end == pytest.approx(len(club_track) / SR)


def test_sections_are_labelled(club_track: np.ndarray) -> None:
    result = detect_structure(club_track, SR, GRID)
    assert result is not None
    by_start = {round(s.start / BAR): s.label for s in result.segments}
    assert by_start[0] == "intro"
    assert by_start[24] == "drop" and by_start[64] == "drop"
    assert by_start[40] == "breakdown"
    assert by_start[80] == "outro"
    assert by_start.get(16) == "build" and by_start.get(56) == "build"


def test_auto_cues_follow_priorities_and_spacing(club_track: np.ndarray) -> None:
    result = detect_structure(club_track, SR, GRID)
    assert result is not None
    cues = auto_cues(result.segments, GRID, max_cues=8)
    positions = [round(c.position / BAR) for c in cues]
    # Cue 1 on the first downbeat, then drop, breakdown, 2nd drop and outro; the builds
    # sit only 8 bars before a drop, closer than the 16-bar minimum spacing.
    assert positions == [0, 24, 40, 64, 80]
    assert [c.label for c in cues] == ["intro", "drop", "breakdown", "drop2", "outro"]
    assert [c.color for c in cues] == [CUE_COLORS[c.label] for c in cues]
    assert all(np.diff(positions) >= 16)


def test_cue_count_limit_keeps_the_most_important() -> None:
    segs = [
        Segment(0.0, 16 * BAR, "intro", 0.3),
        Segment(16 * BAR, 32 * BAR, "verse", 0.5),
        Segment(32 * BAR, 48 * BAR, "drop", 1.0),
        Segment(48 * BAR, 64 * BAR, "breakdown", 0.1),
        Segment(64 * BAR, 80 * BAR, "drop", 1.0),
        Segment(80 * BAR, 96 * BAR, "outro", 0.3),
    ]
    cues = auto_cues(segs, GRID, max_cues=3)
    assert [c.label for c in cues] == ["intro", "drop", "breakdown"]
    assert auto_cues(segs, GRID, max_cues=0) == []
    # Positions already taken by the user's cues are avoided.
    taken = auto_cues(segs, GRID, max_cues=8, reserved=[32 * BAR + 0.2])
    assert all(abs(c.position - 32 * BAR) > BAR for c in taken)


def test_first_cue_is_the_first_downbeat_even_with_a_pickup() -> None:
    grid = BeatGrid("constant", BPM, 0.8)
    segs = [Segment(0.0, 0.8 + 32 * BAR, "intro", 0.3), Segment(0.8 + 32 * BAR, 100.0, "drop", 1.0)]
    cues = auto_cues(segs, grid, max_cues=8)
    assert cues[0].position == pytest.approx(0.8)


def test_no_structure_without_beatgrid_or_audio() -> None:
    assert detect_structure(np.zeros(SR * 30, dtype=np.float32), SR, GRID) is None
    assert detect_structure(section(1.0, 30.0), SR, None) is None


def test_consecutive_sections_with_the_same_label_are_merged() -> None:
    starts, labels = merge_runs(
        [0, 8, 16, 28, 36, 44], ["intro", "drop", "drop", "breakdown", "breakdown", "outro"]
    )
    assert starts == [0, 8, 28, 44]
    assert labels == ["intro", "drop", "breakdown", "outro"]
