"""Idea engine (SPEC 2.15): what to play with (Mashup) or after (DJ Mix) deck A.

Every analysed track that passes the idea filter is a candidate. For each candidate and
each allowed shift of B (-2…+2 semitones by default) the scores are:

- key: the wheel table (SPEC 2.3) from A's key (with A's own shift) to B's shifted key;
- bpm: 1 - |Δ| / tolerance, comparing B at x0.5, x1 and x2 (6 % in DJ Mix, 10 % in Mashup);
- energy: Mashup, closeness; DJ Mix, a step inside the wanted range (keep, up or down);
- vocal (Mashup only): complementarity, one with plenty of voice and the other with little;
- genre: same genre, or a related one (same family: house, techno, drum & bass…);

combined with the weights of ``suggest_weights.json`` minus 0.05 per semitone of shift. In
DJ Mix an acapella (by its title or genre) loses ``acapella_penalty``: there is nothing to
mix into, so it sinks below every playable track; in Mashup it stays a prime idea.
The best shift of each candidate is kept and the top ones are returned with the reasons.

Speed: the analysed library lives in memory as numpy arrays and every candidate x shift is
scored at once. The arrays are rebuilt only when the database changed (``PRAGMA
data_version`` for other connections plus this connection's ``total_changes``).
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from importlib import resources
from typing import Any, Literal

import numpy as np
import numpy.typing as npt

from .db import Database
from .filters import filter_sql
from .keys import Key, compatibility
from .library import summaries as track_summaries
from .rpc_schema import (
    EnergyDirection,
    KeyRef,
    KeyRelation,
    Suggestion,
    SuggestMode,
    SuggestParams,
    SuggestReason,
    SuggestResult,
    SuggestScores,
    TrackFilter,
)

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]

WEIGHTS: dict[str, Any] = json.loads(
    resources.files(__package__).joinpath("suggest_weights.json").read_text("utf-8")
)
BPM_FACTORS = (1.0, 0.5, 2.0)  # 1.0 first: on a tie, prefer comparing at the same tempo


class SuggestError(ValueError):
    """The ideas cannot be computed (reported as invalid params)."""


# ---- keys ----


def key_index(key: Key) -> int:
    """0-11 major, 12-23 minor (same root order)."""
    return key.root + (12 if key.mode == "minor" else 0)


def _key_of(index: int) -> Key:
    return Key(index % 12, "minor" if index >= 12 else "major")


KEY_RELATIONS: list[list[KeyRelation]] = [
    [compatibility(_key_of(a), _key_of(b)).relation for b in range(24)] for a in range(24)
]
KEY_SCORES: FloatArray = np.array(
    [[compatibility(_key_of(a), _key_of(b)).score for b in range(24)] for a in range(24)]
)


def shifted_index(index: IntArray | int, semitones: int) -> Any:
    """Key index after transposing by ``semitones`` (mode unchanged)."""
    return (index % 12 + semitones) % 12 + (index // 12) * 12


# ---- the other scores (vectorised over candidates) ----


def bpm_scores(bpm_a: float, bpm_b: FloatArray, tolerance: float) -> tuple[FloatArray, FloatArray]:
    """Best score over B at x1, x0.5 and x2, and the factor that gave it."""
    best = np.full(bpm_b.shape, -np.inf)
    factor = np.ones(bpm_b.shape)
    for f in BPM_FACTORS:
        score = 1.0 - np.abs(bpm_b * f - bpm_a) / (tolerance * bpm_a)
        better = score > best + 1e-12
        best = np.where(better, score, best)
        factor = np.where(better, f, factor)
    return np.clip(best, 0.0, 1.0), factor


def energy_scores(
    energy_a: int | None, energy_b: FloatArray, mode: SuggestMode, direction: EnergyDirection
) -> FloatArray:
    """Unknown energies (< 1) score a neutral 0.5."""
    if energy_a is None:
        return np.full(energy_b.shape, 0.5)
    delta = energy_b - energy_a
    span = float(WEIGHTS[mode]["energy_span"])
    if mode == "mashup":
        score = 1.0 - np.abs(delta) / span
    else:
        low, high = {"keep": (0, 0), "up": (0, 1), "down": (-1, 0)}[direction]
        distance = np.maximum(low - delta, 0) + np.maximum(delta - high, 0)
        score = 1.0 - distance / span
    return np.where(energy_b >= 1, np.clip(score, 0.0, 1.0), 0.5)


def vocal_scores(vocal_a: float | None, vocal_b: FloatArray) -> FloatArray:
    """Complementarity: |voice A - voice B| over ``vocal_span``. Unknown → 0.5."""
    if vocal_a is None:
        return np.full(vocal_b.shape, 0.5)
    score = np.clip(np.abs(vocal_a - vocal_b) / float(WEIGHTS["vocal_span"]), 0.0, 1.0)
    return np.where(np.isnan(vocal_b), 0.5, score)


# Families of related genres, checked in order (the first match wins: "Afro House" is house).
_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("drum_and_bass", ("drum & bass", "drum and bass", "drum n bass", "drum'n'bass", "dnb",
                       "d&b", "jungle", "liquid funk")),
    ("dubstep", ("dubstep", "riddim", "bass music", "brostep")),
    ("trance", ("trance", "psytrance")),
    ("techno", ("techno",)),
    ("house", ("house", "garage")),
    ("disco", ("nu disco", "nu-disco", "disco", "funk")),
    ("hip_hop", ("hip hop", "hip-hop", "rap", "trap", "r&b", "rnb")),
    ("downtempo", ("downtempo", "chill", "ambient", "lo-fi", "lofi", "trip hop", "trip-hop")),
    ("electro", ("electro", "synthwave")),
    ("breaks", ("breakbeat", "breaks")),
    ("latin", ("reggaeton", "latin", "dembow", "moombahton")),
    ("afro", ("afrobeat", "afrobeats", "amapiano")),
    ("pop", ("pop", "dance")),
)  # fmt: skip
_FAMILY_PATTERNS = [
    (name, re.compile(r"(?<![\w])(" + "|".join(re.escape(w) for w in words) + r")(?![\w])"))
    for name, words in _FAMILIES
]


_ACAPELLA = re.compile(r"(?<![\w])a\s?cc?app?ellas?(?![\w])")


def is_acapella(title: str | None, genre: str | None) -> bool:
    """A vocal-only track, named so in its title ("(Acapella)") or its genre."""
    return any(_ACAPELLA.search(text.casefold()) for text in (title, genre) if text)


def genre_family(genre: str | None) -> str | None:
    if not genre:
        return None
    text = genre.casefold()
    return next((name for name, pattern in _FAMILY_PATTERNS if pattern.search(text)), None)


def genre_scores(
    genre_a: str | None, genres_b: list[str], families_b: list[str | None]
) -> FloatArray:
    """1 for the same genre, ``genre_related`` for the same family, else 0."""
    folded = (genre_a or "").strip().casefold()
    family = genre_family(genre_a)
    related = float(WEIGHTS["genre_related"])
    return np.array(
        [
            1.0 if folded and g == folded else related if family and f == family else 0.0
            for g, f in zip(genres_b, families_b, strict=True)
        ]
    )


# ---- the in-memory index ----


@dataclass(frozen=True)
class _Index:
    ids: IntArray
    keys: IntArray
    bpm: FloatArray
    energy: FloatArray  # 0 = unknown
    vocal: FloatArray  # NaN = unknown
    genres: list[str]  # case-folded, "" = none
    families: list[str | None]
    acapella: npt.NDArray[np.bool_]
    position: dict[int, int]  # track id -> row


_cache: dict[str, tuple[tuple[int, int], _Index]] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _signature(conn: sqlite3.Connection) -> tuple[int, int]:
    return int(conn.execute("PRAGMA data_version").fetchone()[0]), conn.total_changes


def _build(conn: sqlite3.Connection) -> _Index:
    rows = conn.execute(
        "SELECT t.id, a.key_root, a.key_mode, a.bpm, a.energy, a.vocal_presence, t.genre,"
        " COALESCE(NULLIF(t.display_title, ''), t.title)"
        " FROM tracks t JOIN analysis a ON a.track_id = t.id"
        " WHERE a.key_root IS NOT NULL AND a.bpm > 0 ORDER BY t.id"
    ).fetchall()
    genres = [(r[6] or "").strip().casefold() for r in rows]
    family_of: dict[str, str | None] = {}
    families = [family_of.setdefault(g, genre_family(g)) for g in genres]
    ids = np.array([r[0] for r in rows], dtype=np.int64)
    return _Index(
        ids=ids,
        keys=np.array([r[1] + (12 if r[2] == "minor" else 0) for r in rows], dtype=np.int64),
        bpm=np.array([r[3] for r in rows], dtype=np.float64),
        energy=np.array([r[4] or 0 for r in rows], dtype=np.float64),
        vocal=np.array([np.nan if r[5] is None else r[5] for r in rows], dtype=np.float64),
        genres=genres,
        families=families,
        acapella=np.array([is_acapella(r[7], r[6]) for r in rows], dtype=bool),
        position={int(i): n for n, i in enumerate(ids)},
    )


def _index(db: Database) -> _Index:
    key = str(db.path)
    with _cache_lock:
        signature = _signature(db.conn)
        cached = _cache.get(key)
        if cached is not None and cached[0] == signature:
            return cached[1]
        index = _build(db.conn)
        _cache[key] = (_signature(db.conn), index)
        return index


def _playlist_tracks(conn: sqlite3.Connection, playlist_ids: list[int]) -> set[int]:
    found: set[int] = set()
    for pid in playlist_ids:
        row = conn.execute(
            "SELECT is_folder, smart_query FROM playlists WHERE id = ?", (pid,)
        ).fetchone()
        if row is None or row["is_folder"]:
            continue
        if row["smart_query"] is not None:
            where, args = filter_sql(TrackFilter.model_validate_json(row["smart_query"]))
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            sql = f"SELECT t.id FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id {clause}"
            found.update(r[0] for r in conn.execute(sql, args))
        else:
            found.update(
                r[0]
                for r in conn.execute(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?", (pid,)
                )
            )
    return found


# ---- suggestions ----


def suggest(db: Database, params: SuggestParams, mode: SuggestMode) -> SuggestResult:
    started = time.perf_counter()
    index = _index(db)
    a_row = index.position.get(params.track_id)
    if a_row is None:
        exists = db.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (params.track_id,)).fetchone()
        if exists is None:
            raise SuggestError(f"unknown track {params.track_id}")
        raise SuggestError("the track is not analysed yet (it needs a key and a BPM)")
    settings = WEIGHTS[mode]
    weights: dict[str, float] = settings["weights"]
    key_a = int(shifted_index(int(index.keys[a_row]), params.shift_a))
    bpm_a = float(index.bpm[a_row])
    energy_a = int(index.energy[a_row]) or None
    vocal_a = None if np.isnan(index.vocal[a_row]) else float(index.vocal[a_row])
    genre_a = index.genres[a_row] or None

    mask = index.ids != params.track_id
    if params.exclude:
        mask &= ~np.isin(index.ids, params.exclude)
    f = params.filters
    if f.energy_min is not None:
        mask &= index.energy >= f.energy_min
    if f.energy_max is not None:
        mask &= (index.energy <= f.energy_max) & (index.energy >= 1)
    if f.bpm_min is not None:
        mask &= index.bpm >= f.bpm_min
    if f.bpm_max is not None:
        mask &= index.bpm <= f.bpm_max
    if f.genres:
        wanted = {g.strip().casefold() for g in f.genres if g.strip()}
        mask &= np.array([g in wanted for g in index.genres], dtype=bool)
    if f.playlist_ids:
        mask &= np.isin(index.ids, list(_playlist_tracks(db.conn, f.playlist_ids)))

    rows = np.flatnonzero(mask)
    keys_b = index.keys[rows]
    bpm, bpm_factor = bpm_scores(bpm_a, index.bpm[rows], float(settings["bpm_tolerance"]))
    energy = energy_scores(energy_a, index.energy[rows], mode, params.energy_direction)
    vocal = vocal_scores(vocal_a, index.vocal[rows]) if mode == "mashup" else np.zeros(rows.size)
    genres_b = [index.genres[r] for r in rows]
    genre = genre_scores(genre_a, genres_b, [index.families[r] for r in rows])
    rest = (
        weights["bpm"] * bpm
        + weights["energy"] * energy
        + weights.get("vocal", 0.0) * vocal
        + weights["genre"] * genre
    )
    acapella = index.acapella[rows] if mode == "mix" else np.zeros(rows.size, dtype=bool)
    rest = rest - float(WEIGHTS["acapella_penalty"]) * acapella

    # Shifts ordered by size so that, on a tie, the smallest shift wins.
    span = params.max_shift if params.allow_shift else 0
    shifts = sorted(range(-span, span + 1), key=lambda s: (abs(s), s))
    penalty = float(WEIGHTS["shift_penalty"])
    key_by_shift = np.stack([KEY_SCORES[key_a, shifted_index(keys_b, s)] for s in shifts])
    totals = weights["key"] * key_by_shift + rest - penalty * np.abs(np.array(shifts))[:, None]
    best_shift = np.argmax(totals, axis=0) if rows.size else np.zeros(0, dtype=np.int64)
    total = totals[best_shift, np.arange(rows.size)] if rows.size else np.zeros(0)

    order = np.lexsort((index.ids[rows], -np.round(total, 9)))[: params.limit]
    summaries = track_summaries(db.conn, [int(index.ids[rows[i]]) for i in order])
    items: list[Suggestion] = []
    for i in order:
        track_id = int(index.ids[rows[i]])
        if track_id not in summaries:
            continue
        shift_b = shifts[int(best_shift[i])]
        key_b = int(shifted_index(int(keys_b[i]), shift_b))
        relation = KEY_RELATIONS[key_a][key_b]
        scores = SuggestScores(
            key=round(float(KEY_SCORES[key_a, key_b]), 4),
            bpm=round(float(bpm[i]), 4),
            energy=round(float(energy[i]), 4),
            vocal=round(float(vocal[i]), 4),
            genre=round(float(genre[i]), 4),
        )
        b = int(rows[i])
        items.append(
            Suggestion(
                track=summaries[track_id],
                score=round(max(0.0, float(total[i])) * 100),
                shift_b=shift_b,
                key_b=KeyRef(root=key_b % 12, mode="minor" if key_b >= 12 else "major"),
                relation=relation,
                bpm_factor=float(bpm_factor[i]),
                scores=scores,
                reasons=_reasons(
                    mode,
                    relation,
                    shift_b,
                    bpm_a,
                    float(index.bpm[b]),
                    float(bpm_factor[i]),
                    energy_a,
                    int(index.energy[b]) or None,
                    vocal_a,
                    None if np.isnan(index.vocal[b]) else float(index.vocal[b]),
                    float(genre[i]),
                    bool(acapella[i]),
                ),
            )
        )
    return SuggestResult(
        mode=mode,
        track_id=params.track_id,
        shift_a=params.shift_a,
        candidates=int(rows.size),
        items=items,
        elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
    )


def _reasons(
    mode: SuggestMode,
    relation: KeyRelation,
    shift_b: int,
    bpm_a: float,
    bpm_b: float,
    factor: float,
    energy_a: int | None,
    energy_b: int | None,
    vocal_a: float | None,
    vocal_b: float | None,
    genre: float,
    acapella: bool = False,
) -> list[SuggestReason]:
    reasons = [SuggestReason(kind="key", code=relation)]
    if shift_b:
        reasons.append(SuggestReason(kind="shift", code="b", value=float(shift_b)))
    tempo: Literal["same", "half", "double"] = (
        "same" if factor == 1.0 else "double" if factor == 0.5 else "half"
    )
    delta = round((bpm_b * factor - bpm_a) / bpm_a * 100, 1) + 0.0  # no "-0.0"
    reasons.append(SuggestReason(kind="bpm", code=tempo, value=delta))
    if mode == "mashup" and vocal_a is not None and vocal_b is not None:
        gap = float(WEIGHTS["vocal_reason"])
        if vocal_a - vocal_b >= gap:
            reasons.append(SuggestReason(kind="vocals", code="a"))
        elif vocal_b - vocal_a >= gap:
            reasons.append(SuggestReason(kind="vocals", code="b"))
    if energy_a is not None and energy_b is not None:
        step = energy_b - energy_a
        code = "same" if step == 0 else "up" if step > 0 else "down"
        reasons.append(SuggestReason(kind="energy", code=code, value=float(step)))
    if genre > 0:
        code = "same" if genre >= 1.0 else "related"
        reasons.append(SuggestReason(kind="genre", code=code))
    if acapella:
        reasons.append(SuggestReason(kind="acapella", code="mix"))
    return reasons
