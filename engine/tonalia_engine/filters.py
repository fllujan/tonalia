"""SQL for :class:`TrackFilter` (smart playlists and library filters, SPEC 2.11 and 2.14).

Columns use the aliases of the library queries: ``t`` = tracks, ``a`` = analysis.
"""

from __future__ import annotations

from typing import Any

from .keys import Key, compatibility, from_wheel
from .rpc_schema import TrackFilter

ALL_KEYS = [from_wheel(n, letter) for n in range(1, 13) for letter in ("A", "B")]


def matching_keys(f: TrackFilter) -> list[Key]:
    """Keys accepted by the filter, expanded with their compatibles when asked."""
    chosen = {Key(k.root, k.mode) for k in f.keys}
    if f.compatible:
        chosen |= {k for k in ALL_KEYS for c in list(chosen) if compatibility(c, k).score > 0}
    return sorted(chosen, key=lambda k: (k.mode, k.root))


def filter_sql(f: TrackFilter) -> tuple[list[str], list[Any]]:
    """WHERE conditions (to AND together) and their arguments."""
    where: list[str] = []
    args: list[Any] = []
    if f.keys:
        keys = matching_keys(f)
        where.append("(" + " OR ".join("(a.key_root = ? AND a.key_mode = ?)" for _ in keys) + ")")
        for k in keys:
            args += [k.root, k.mode]
    if f.bpm_min is not None or f.bpm_max is not None:
        low = f.bpm_min if f.bpm_min is not None else 0.0
        high = f.bpm_max if f.bpm_max is not None else 1e9
        factors = (1.0, 2.0, 0.5) if f.bpm_half_double else (1.0,)
        where.append("(" + " OR ".join("a.bpm * ? BETWEEN ? AND ?" for _ in factors) + ")")
        for factor in factors:
            args += [factor, low, high]
    if f.energy_min is not None:
        where.append("a.energy >= ?")
        args.append(f.energy_min)
    if f.energy_max is not None:
        where.append("a.energy <= ?")
        args.append(f.energy_max)
    genres = sorted({g.strip().casefold() for g in f.genres if g.strip()})
    if genres:
        # ``tonalia_fold`` (registered by ``Database.open``) is Unicode case folding.
        where.append(f"tonalia_fold(trim(t.genre)) IN ({', '.join('?' for _ in genres)})")
        args += genres
    if f.statuses:
        where.append(f"t.status IN ({', '.join('?' for _ in f.statuses)})")
        args += list(f.statuses)
    if f.quality_issues is not None:
        op = ">" if f.quality_issues else "="
        where.append(f"json_array_length(COALESCE(a.quality_flags, '[]')) {op} 0")
    if f.favorites:
        where.append("t.id IN (SELECT track_a FROM favorites UNION SELECT track_b FROM favorites)")
    if f.playlist_id is not None:
        where.append("t.id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = ?)")
        args.append(f.playlist_id)
    return where, args


def validate_filter(conn: Any, f: TrackFilter) -> None:
    """Reject a ``playlist_id`` that is not a regular playlist (ValueError)."""
    if f.playlist_id is None:
        return
    row = conn.execute(
        "SELECT is_folder, smart_query FROM playlists WHERE id = ?", (f.playlist_id,)
    ).fetchone()
    if row is None or row["is_folder"] or row["smart_query"] is not None:
        raise ValueError(f"playlist {f.playlist_id} is not a regular playlist")
