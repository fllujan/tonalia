"""Set builder (SPEC 2.17): order a pool of tracks into a set that mixes well and follows
an energy curve.

Objective of an order t1…tn: the sum of its DJ Mix transition scores (the same scores as
``suggest.mixouts``: key 0.40, BPM 0.30, energy 0.20, genre 0.10) plus ``CURVE_WEIGHT``
times the fit of each track's energy to the target curve. The energy part of a transition
asks for the step the curve takes there (up, keep or down). A transition whose keys do not
mix at all (key score 0) costs ``CLASH_PENALTY``, so it only appears when there is no
alternative, and it is flagged (red in the UI). With ``allow_shift`` the next track may be
shifted up to 2 semitones either way (0.05 off per semitone, as in the ideas). A
transition into or out of an acapella loses ``acapella_penalty``, as in the DJ Mix ideas.

Search: beam search of width 50 (``beam_width``) over the precomputed n-by-n transition
matrices, without repeating tracks. A tiny jitter drawn from ``seed`` breaks ties, so the
same pool, curve and seed always give the same set. A duration target becomes a number of
tracks from the pool's mean duration.
"""

from __future__ import annotations

import itertools
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from .db import Database
from .keys import Key
from .library import summaries
from .rpc_schema import (
    BuilderAlternative,
    BuilderAlternativesParams,
    BuilderGenerateParams,
    BuilderItem,
    BuilderPool,
    BuilderResult,
    BuilderScoreParams,
    BuilderTransition,
    EnergyCurve,
    SuggestScores,
    TransitionQuality,
)
from .suggest import (
    KEY_RELATIONS,
    KEY_SCORES,
    WEIGHTS,
    FloatArray,
    IntArray,
    _index,
    _playlist_tracks,
    bpm_scores,
    energy_scores,
    key_index,
    shifted_index,
)

Direction = Literal["keep", "up", "down"]
DIRECTIONS: tuple[Direction, ...] = ("keep", "up", "down")

CURVE_WEIGHT = 0.5  # one track's energy fit against one transition score
CLASH_PENALTY = 1.0  # keys that do not mix: avoided unless there is no other way
STEP = 0.25  # a target step smaller than this keeps the energy
MAX_SHIFT = 2
DEFAULT_COUNT = 20
DEFAULT_DURATION = 360.0  # seconds, for tracks without a duration
GOOD, FAIR = 0.7, 0.4  # transition quality thresholds (green / amber / red)

PRESETS: dict[str, list[tuple[float, float]]] = {
    "warmup_peak_cooldown": [(0.0, 4.0), (0.6, 9.0), (0.85, 9.0), (1.0, 6.0)],
    "ascending": [(0.0, 4.0), (1.0, 9.0)],
}

_MIX = WEIGHTS["mix"]
_W = _MIX["weights"]
_TOLERANCE = float(_MIX["bpm_tolerance"])
_SHIFT_PENALTY = float(WEIGHTS["shift_penalty"])
_RELATED = float(WEIGHTS["genre_related"])


class BuilderError(ValueError):
    """The set cannot be built (reported as invalid params)."""


# ---- the energy curve ----


def curve_targets(curve: EnergyCurve, count: int, pool_energy: float) -> list[float]:
    """Target energy of each of ``count`` positions. "flat" sits at the pool's median."""
    if curve.preset == "flat":
        return [float(pool_energy)] * count
    if curve.preset == "custom":
        points = sorted((p.x, p.energy) for p in curve.points)
    else:
        points = PRESETS[curve.preset]
    xs = np.array([x for x, _ in points])
    ys = np.array([y for _, y in points])
    at = np.linspace(0.0, 1.0, count) if count > 1 else np.zeros(1)
    return [float(v) for v in np.interp(at, xs, ys)]


def directions(targets: list[float]) -> list[Direction]:
    """The energy step asked for into each position (the first one is unused)."""
    out: list[Direction] = ["keep"]
    for a, b in itertools.pairwise(targets):
        out.append("up" if b - a > STEP else "down" if a - b > STEP else "keep")
    return out


def transition_score(
    *,
    key_a: Key,
    key_b: Key,
    bpm_a: float,
    bpm_b: float,
    energy_a: int | None,
    energy_b: int | None,
    direction: Direction,
    same_genre: float = 0.0,
) -> tuple[float, dict[str, float]]:
    """One DJ Mix transition, scored like ``suggest.mixouts`` (no shift)."""
    key = float(KEY_SCORES[key_index(key_a), key_index(key_b)])
    bpm = float(bpm_scores(bpm_a, np.array([bpm_b]), _TOLERANCE)[0][0])
    energy = float(energy_scores(energy_a, np.array([float(energy_b or 0)]), "mix", direction)[0])
    parts = {"key": key, "bpm": bpm, "energy": energy, "genre": same_genre}
    return sum(float(_W[k]) * v for k, v in parts.items()), parts


# ---- the pool and its matrices ----


@dataclass(frozen=True)
class _Pool:
    ids: IntArray
    keys: IntArray
    bpm: FloatArray
    energy: FloatArray  # 0 = unknown
    duration: FloatArray
    acapella: npt.NDArray[np.bool_]
    position: dict[int, int]


@dataclass(frozen=True)
class _Matrices:
    key: FloatArray  # raw key score of the chosen shift
    shift: IntArray
    bpm: FloatArray
    factor: FloatArray
    genre: FloatArray
    energy: dict[Direction, FloatArray]
    objective: dict[Direction, FloatArray]  # with the shift and clash penalties
    fit_of: FloatArray  # energy per track for the curve fit (NaN = unknown)


def _pool(db: Database, track_ids: list[int]) -> tuple[_Pool, int]:
    """Analysed tracks among ``track_ids`` (in that order) and how many were skipped."""
    index = _index(db)
    rows = [index.position[t] for t in dict.fromkeys(track_ids) if t in index.position]
    skipped = len(set(track_ids)) - len(rows)
    ids = index.ids[rows]
    durations = (
        dict(
            db.conn.execute(
                f"SELECT id, duration FROM tracks WHERE id IN ({','.join('?' * len(ids))})",
                [int(i) for i in ids],
            ).fetchall()
        )
        if len(ids)
        else {}
    )
    return (
        _Pool(
            ids=ids,
            keys=index.keys[rows],
            bpm=index.bpm[rows],
            energy=index.energy[rows],
            duration=np.array(
                [float(durations.get(int(i)) or DEFAULT_DURATION) for i in ids], dtype=np.float64
            ),
            acapella=index.acapella[rows],
            position={int(t): n for n, t in enumerate(ids)},
        ),
        skipped,
    )


def _genre_matrix(db: Database, pool: _Pool) -> FloatArray:
    index = _index(db)
    rows = [index.position[int(t)] for t in pool.ids]
    genres = [index.genres[r] for r in rows]
    families = [index.families[r] for r in rows]
    gid = {g: i for i, g in enumerate(dict.fromkeys(genres))}
    fid = {f: i for i, f in enumerate(dict.fromkeys(families))}
    g = np.array([gid[x] if x else -1 for x in genres])
    f = np.array([fid[x] if x else -1 for x in families])
    same = (g[:, None] == g[None, :]) & (g[:, None] >= 0)
    related = (f[:, None] == f[None, :]) & (f[:, None] >= 0)
    return np.where(same, 1.0, np.where(related, _RELATED, 0.0))


def _matrices(db: Database, pool: _Pool, allow_shift: bool) -> _Matrices:
    n = len(pool.ids)
    shifts = (
        sorted(range(-MAX_SHIFT, MAX_SHIFT + 1), key=lambda s: (abs(s), s)) if allow_shift else [0]
    )
    by_shift = np.stack(
        [
            KEY_SCORES[pool.keys[:, None], shifted_index(pool.keys[None, :], s)]
            - _SHIFT_PENALTY * abs(s)
            for s in shifts
        ]
    )
    best = np.argmax(by_shift, axis=0)
    shift = np.array(shifts, dtype=np.int64)[best]
    key = np.take_along_axis(by_shift, best[None], axis=0)[0] + _SHIFT_PENALTY * np.abs(shift)
    bpm = np.zeros((n, n))
    factor = np.ones((n, n))
    for i in range(n):
        bpm[i], factor[i] = bpm_scores(float(pool.bpm[i]), pool.bpm, _TOLERANCE)
    genre = _genre_matrix(db, pool)
    energy: dict[Direction, FloatArray] = {}
    objective: dict[Direction, FloatArray] = {}
    base = float(_W["key"]) * key + float(_W["bpm"]) * bpm + float(_W["genre"]) * genre
    # An acapella has no beat to mix in or out of: like in the DJ Mix ideas, any
    # transition touching one loses ``acapella_penalty``, so it only fills a gap.
    acapella = pool.acapella[:, None] | pool.acapella[None, :]
    penalty = (
        _SHIFT_PENALTY * np.abs(shift)
        + CLASH_PENALTY * (key <= 0)
        + float(WEIGHTS["acapella_penalty"]) * acapella
    )
    for d in DIRECTIONS:
        e = (
            np.stack(
                [
                    energy_scores(
                        int(pool.energy[i]) if pool.energy[i] >= 1 else None, pool.energy, "mix", d
                    )
                    for i in range(n)
                ]
            )
            if n
            else np.zeros((0, 0))
        )
        energy[d] = e
        objective[d] = base + float(_W["energy"]) * e - penalty
    return _Matrices(
        key=key,
        shift=shift,
        bpm=bpm,
        factor=factor,
        genre=genre,
        energy=energy,
        objective=objective,
        fit_of=np.where(pool.energy >= 1, pool.energy, np.nan),
    )


def _fit(m: _Matrices, targets: list[float]) -> FloatArray:
    """fit[track, position] = 1 - |energy - target| / 9 (unknown energy: 0.5)."""
    t = np.array(targets)[None, :]
    e = m.fit_of[:, None]
    return np.where(np.isnan(e), 0.5, 1.0 - np.abs(e - t) / 9.0)


# ---- beam search ----


def _beam(
    m: _Matrices,
    fit: FloatArray,
    dirs: list[Direction],
    count: int,
    start: int | None,
    width: int,
    seed: int,
) -> list[int]:
    n = fit.shape[0]
    jitter: FloatArray = np.asarray(np.random.default_rng(seed).random(n)) * 1e-6
    first: FloatArray = CURVE_WEIGHT * fit[:, 0] + jitter
    scores: FloatArray
    if start is not None:
        seqs, scores = [[start]], np.array([first[start]])
    else:
        top = sorted(range(n), key=lambda j: (-first[j], j))[:width]
        seqs, scores = [[j] for j in top], first[top]
    used = np.zeros((len(seqs), n), dtype=bool)
    for k, seq in enumerate(seqs):
        used[k, seq] = True
    for p in range(1, count):
        step = m.objective[dirs[p]]
        last = np.array([seq[-1] for seq in seqs])
        totals = scores[:, None] + step[last] + CURVE_WEIGHT * fit[:, p][None, :] + jitter[None, :]
        totals[used] = -np.inf
        flat = totals.ravel()
        keep = min(width, int(np.isfinite(flat).sum()))
        if keep == 0:
            break
        chosen = np.argpartition(-flat, keep - 1)[:keep]
        chosen = chosen[np.lexsort((chosen, -flat[chosen]))]
        rows, cols = np.divmod(chosen, n)
        seqs = [[*seqs[r], int(c)] for r, c in zip(rows, cols, strict=True)]
        scores = flat[chosen]
        used = used[rows].copy()
        used[np.arange(len(cols)), cols] = True
    return seqs[int(np.argmax(scores))]


# ---- results ----


def _quality(score: float, clash: bool) -> TransitionQuality:
    if clash or score < FAIR:
        return "bad"
    return "good" if score >= GOOD else "fair"


def mixable_outside(key: FloatArray, *, in_set: set[int], prev: int, nxt: int | None) -> int:
    """Pool tracks left out of the set that mix with ``prev`` (and with ``nxt``, if any).

    Asked of a clash: 0 means no track of the pool could have taken that place without a
    clash of its own, so the clash was unavoidable with this pool.
    """
    fits = key[prev] > 0
    if nxt is not None:
        fits &= key[:, nxt] > 0
    fits[list(in_set)] = False
    return int(fits.sum())


def _transition(
    pool: _Pool,
    m: _Matrices,
    i: int,
    j: int,
    d: Direction,
    outside: Callable[[], int] | None = None,
) -> BuilderTransition:
    parts = {
        "key": float(m.key[i, j]),
        "bpm": float(m.bpm[i, j]),
        "energy": float(m.energy[d][i, j]),
        "genre": float(m.genre[i, j]),
    }
    score = sum(float(_W[k]) * v for k, v in parts.items())
    clash = parts["key"] <= 0
    shift = int(m.shift[i, j])
    factor = float(m.factor[i, j])
    ea, eb = pool.energy[i], pool.energy[j]
    return BuilderTransition(
        score=round(score, 4),
        quality=_quality(score, clash),
        clash=clash,
        mixable_outside=outside() if clash and outside is not None else None,
        relation=KEY_RELATIONS[int(pool.keys[i])][int(shifted_index(int(pool.keys[j]), shift))],
        shift=shift,
        bpm_factor=factor,
        bpm_delta=round(float((pool.bpm[j] * factor - pool.bpm[i]) / pool.bpm[i] * 100), 2),
        energy_delta=int(eb - ea) if ea >= 1 and eb >= 1 else None,
        scores=SuggestScores(vocal=0.0, **{k: round(v, 4) for k, v in parts.items()}),
    )


def _result(
    db: Database,
    pool: _Pool,
    m: _Matrices,
    order: list[int],
    targets: list[float],
    *,
    pool_size: int,
    skipped: int,
    started: float,
    judge_clashes: bool = False,
) -> BuilderResult:
    dirs = directions(targets)
    tracks = summaries(db.conn, [int(pool.ids[r]) for r in order])
    items: list[BuilderItem] = []
    in_set = set(order)

    def outside(p: int) -> Callable[[], int] | None:
        if not judge_clashes:
            return None
        nxt = order[p + 1] if p + 1 < len(order) else None
        return lambda: mixable_outside(m.key, in_set=in_set, prev=order[p - 1], nxt=nxt)

    for p, r in enumerate(order):
        items.append(
            BuilderItem(
                track=tracks[int(pool.ids[r])],
                target_energy=round(targets[p], 2),
                transition=(
                    _transition(pool, m, order[p - 1], r, dirs[p], outside(p)) if p else None
                ),
            )
        )
    moves = [it.transition for it in items if it.transition is not None]
    return BuilderResult(
        items=items,
        mean_score=round(float(np.mean([t.score for t in moves])), 4) if moves else 0.0,
        clashes=sum(t.clash for t in moves),
        duration=round(float(sum(pool.duration[r] for r in order)), 2),
        pool_size=pool_size,
        skipped=skipped,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
    )


def _pool_ids(db: Database, pool: BuilderPool) -> list[int]:
    found: list[int] = list(pool.track_ids)
    if pool.playlist_id is not None:
        if (
            db.conn.execute("SELECT 1 FROM playlists WHERE id = ?", (pool.playlist_id,)).fetchone()
            is None
        ):
            raise BuilderError(f"unknown playlist {pool.playlist_id}")
        found += sorted(_playlist_tracks(db.conn, [pool.playlist_id]))
    return found


def _median_energy(pool: _Pool) -> float:
    known = pool.energy[pool.energy >= 1]
    return float(np.median(known)) if known.size else 6.0


def generate(db: Database, p: BuilderGenerateParams) -> BuilderResult:
    started = time.perf_counter()
    pool, skipped = _pool(db, _pool_ids(db, p.pool))
    n = len(pool.ids)
    if n == 0:
        raise BuilderError("the pool has no analysed tracks")
    start = None
    if p.start_track_id is not None:
        if p.start_track_id not in pool.position:
            raise BuilderError("the first track is not an analysed track of the pool")
        start = pool.position[p.start_track_id]
    if p.count is not None:
        count = p.count
    elif p.duration_min is not None:
        count = math.ceil(p.duration_min * 60 / float(np.mean(pool.duration)))
    else:
        count = DEFAULT_COUNT
    count = max(1, min(count, n))
    targets = curve_targets(p.curve, count, _median_energy(pool))
    m = _matrices(db, pool, p.allow_shift)
    order = _beam(m, _fit(m, targets), directions(targets), count, start, p.beam_width, p.seed)
    return _result(
        db,
        pool,
        m,
        order,
        targets,
        pool_size=n,
        skipped=skipped,
        started=started,
        judge_clashes=True,
    )


def _ordered(db: Database, track_ids: list[int]) -> tuple[_Pool, int]:
    pool, skipped = _pool(db, track_ids)
    missing = [t for t in track_ids if t not in pool.position]
    if missing:
        raise BuilderError(f"track {missing[0]} is not an analysed track")
    if len(set(track_ids)) != len(track_ids):
        raise BuilderError("a set cannot repeat a track")
    return pool, skipped


def score(db: Database, p: BuilderScoreParams) -> BuilderResult:
    started = time.perf_counter()
    pool, skipped = _ordered(db, p.track_ids)
    targets = curve_targets(p.curve, len(p.track_ids), _median_energy(pool))
    m = _matrices(db, pool, p.allow_shift)
    order = [pool.position[t] for t in p.track_ids]
    return _result(
        db, pool, m, order, targets, pool_size=len(order), skipped=skipped, started=started
    )


def alternatives(db: Database, p: BuilderAlternativesParams) -> list[BuilderAlternative]:
    if p.position >= len(p.track_ids):
        raise BuilderError("position outside the set")
    _ordered(db, p.track_ids)
    candidates = (
        _pool_ids(db, p.pool)
        if (p.pool.track_ids or p.pool.playlist_id)
        else [int(i) for i in _index(db).ids]
    )
    pool, _ = _pool(db, [*p.track_ids, *candidates])
    in_set = [pool.position[t] for t in p.track_ids]
    targets = curve_targets(p.curve, len(in_set), _median_energy(pool))
    dirs = directions(targets)
    m = _matrices(db, pool, p.allow_shift)
    fit = _fit(m, targets)
    at = p.position
    prev = in_set[at - 1] if at > 0 else None
    nxt = in_set[at + 1] if at + 1 < len(in_set) else None

    def local(c: int) -> float:
        total = CURVE_WEIGHT * float(fit[c, at])
        if prev is not None:
            total += float(m.objective[dirs[at]][prev, c])
        if nxt is not None:
            total += float(m.objective[dirs[at + 1]][c, nxt])
        return total

    current = local(in_set[at])
    taken = set(in_set)
    ranked = sorted(
        (c for c in range(len(pool.ids)) if c not in taken),
        key=lambda c: (-local(c), int(pool.ids[c])),
    )[: p.limit]
    tracks = summaries(db.conn, [int(pool.ids[c]) for c in ranked])
    return [
        BuilderAlternative(
            track=tracks[int(pool.ids[c])],
            delta=round(local(c) - current, 4),
            into=_transition(pool, m, prev, c, dirs[at]) if prev is not None else None,
            out=_transition(pool, m, c, nxt, dirs[at + 1]) if nxt is not None else None,
        )
        for c in ranked
    ]
