"""Duplicates (SPEC 13.3): the same file twice, the same audio in another encoding or with
other tags, and other versions of the same track.

**Fingerprint.** Our own, from the audio at 11 025 Hz in 0.37 s frames every 0.19 s:
33 bands between 300 and 2000 Hz (where every encoder keeps the signal); each frame gives
32 bits, the sign of how the energy difference between neighbouring bands changes from
two frames before (the classic robust audio hash). Encodings, bitrates and tags leave
those bits almost intact; two different recordings agree on about half of them. Next to
the bits: the loudness of each frame and a 512-number summary (8 band groups by 64 stretches of
the track) that finds the candidates quickly.

**Scan.** Fingerprints are computed by the analysis; the scan only computes the missing
or stale ones (incremental). Candidates are tracks of similar duration whose summaries
are alike (one matrix product per block, a handful per track); each candidate pair is
then confirmed by the bit error rate at the best offset (up to 12 s: a different
silence at the start). Identical files (same
``file_hash``) are grouped directly, and *other versions* come from the same artist and
base title (without "(Extended Mix)", "- Radio Edit", "(X Remix)"…) on different audio.

**Resolving a group.** *Keep all* hides the group until another copy joins it;
*different versions* records the pairs so they are never grouped again; *merge* moves
the user's cues, memory cues, playlists, favourites, ratings and play counts to the copy
kept and removes the others from the library (never from disk, unless the user asks to
move them to the system trash, one group at a time). A merge can be undone: every row
that referenced those tracks is kept, compressed, until then.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import time
import unicodedata
import uuid
import zlib
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
from scipy.signal import resample_poly

from .audio_io import decode
from .db import Database
from .errors import TonaliaError
from .history import refresh_stats
from .rpc_schema import (
    DuplicateGroup,
    DuplicateKind,
    DuplicateList,
    DuplicateMember,
    DuplicateReason,
    DuplicateResolveParams,
    DuplicateResolveResult,
    DuplicateScanResult,
    DuplicateUndoResult,
)

VERSION = 1  # bump when the fingerprint changes: the scan then recomputes them all
SR = 11025
FRAME = 4096
HOP = 2048
F_LOW, F_HIGH = 300.0, 2000.0
N_BANDS = 33
STEPS, GROUPS = 64, 8
SUMMARY_SIZE = STEPS * GROUPS

SIM_MIN = 0.80  # summary cosine for a pair to be checked
CANDIDATES = 8  # at most, per track
LAG = 2  # frames between the two compared (one frame was too sensitive to a sub-frame shift)
BER_MAX = 0.33  # bit error rate under which two fingerprints are the same audio
MAX_OFFSET = 64  # frames (≈ 12 s) between two copies
MIN_OVERLAP = 0.5  # of the shorter fingerprint
DURATION_SLACK = (4.0, 0.03)  # seconds, fraction: the most two copies' lengths differ

LOSSLESS = {"flac", "wav", "aiff", "aif", "alac"}
_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)

FloatArray = npt.NDArray[np.float64]


class DuplicateError(TonaliaError):
    reason = "group_not_found"


class MergeUndoError(TonaliaError):
    reason = "undo_changed"


# ---- fingerprint ----


@dataclass
class Fingerprint:
    bits: npt.NDArray[np.uint32]
    loudness: npt.NDArray[np.uint8]
    summary: npt.NDArray[np.float32]  # unit length

    def encode(self) -> tuple[bytes, bytes]:
        data = struct.pack("<I", self.bits.size) + self.bits.astype("<u4").tobytes()
        data += self.loudness.tobytes()
        return self.summary.astype("<f2").tobytes(), zlib.compress(data, 6)

    @classmethod
    def decode(cls, summary: bytes, data: bytes) -> Fingerprint:
        raw = zlib.decompress(data)
        (n,) = struct.unpack_from("<I", raw, 0)
        bits = np.frombuffer(raw, dtype="<u4", count=n, offset=4).astype(np.uint32)
        loud = np.frombuffer(raw, dtype=np.uint8, count=n, offset=4 + 4 * n).copy()
        vec = np.frombuffer(summary, dtype="<f2").astype(np.float32)
        return cls(bits, loud, vec)


def _band_matrix() -> FloatArray:
    freqs = np.fft.rfftfreq(FRAME, 1.0 / SR)
    edges = np.geomspace(F_LOW, F_HIGH, N_BANDS + 1)
    out = np.zeros((freqs.size, N_BANDS))
    for b in range(N_BANDS):
        out[(freqs >= edges[b]) & (freqs < edges[b + 1]), b] = 1.0
    return out


_BANDS = _band_matrix()
_WINDOW = np.hanning(FRAME)


def compute(audio: npt.NDArray[np.floating], sr: int) -> Fingerprint | None:
    """The fingerprint of mono ``audio``; None if it is too short (under ~2 s)."""
    x = np.asarray(audio, dtype=np.float64)
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g)
    if x.size < FRAME + 10 * HOP:
        return None
    n = 1 + (x.size - FRAME) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, FRAME), strides=(x.strides[0] * HOP, x.strides[0]), writeable=False
    )
    energy = np.empty((n, N_BANDS))
    for start in range(0, n, 512):  # bounded memory for long tracks
        block = np.abs(np.fft.rfft(frames[start : start + 512] * _WINDOW, axis=1)) ** 2
        energy[start : start + 512] = block @ _BANDS
    log = np.log10(energy + 1e-10)
    diff = log[:, :-1] - log[:, 1:]
    flips = (diff[LAG:] - diff[:-LAG]) > 0  # (n - LAG, 32)
    bits = (flips.astype(np.uint64) << np.arange(32, dtype=np.uint64)).sum(axis=1)
    total = 10 * np.log10(energy.sum(axis=1) + 1e-12)[LAG:]
    loud = np.clip((total - total.max() + 60.0) * (255.0 / 60.0), 0, 255).astype(np.uint8)
    groups = np.stack([g.mean(axis=1) for g in np.array_split(energy, GROUPS, axis=1)], axis=1)
    if groups.shape[0] >= STEPS:
        steps = np.stack([s.mean(axis=0) for s in np.array_split(groups, STEPS, axis=0)])
    else:  # a very short track: stretch it to the same number of steps
        steps = groups[np.linspace(0, groups.shape[0] - 1, STEPS).astype(int)]
    vec = np.log10(steps + 1e-10).ravel()
    vec = (vec - vec.mean()) / (vec.std() + 1e-9)
    vec /= np.linalg.norm(vec) + 1e-9
    return Fingerprint(bits.astype(np.uint32), loud, vec.astype(np.float32))


def _ber(
    a: npt.NDArray[np.uint32], b: npt.NDArray[np.uint32], offset: int, step: int = 1
) -> float | None:
    """Bit error rate with ``b`` shifted by ``offset`` frames (on every ``step``-th frame);
    None if they barely overlap."""
    if offset >= 0:
        x, y = a[offset:], b
    else:
        x, y = a, b[-offset:]
    n = min(x.size, y.size)
    if n < MIN_OVERLAP * min(a.size, b.size) or n == 0:
        return None
    diff = np.bitwise_xor(x[:n:step], y[:n:step])
    return int(_POPCOUNT[diff.view(np.uint8)].sum()) / (32.0 * diff.size)


def bit_error(a: Fingerprint, b: Fingerprint) -> float:
    """How different two fingerprints are at their best alignment (0 = the same). The
    offset is searched on every fourth frame, then measured on all of them."""
    best, best_rate = 0, 1.0
    for off in range(-MAX_OFFSET, MAX_OFFSET + 1):
        rate = _ber(a.bits, b.bits, off, step=4)
        if rate is not None and rate < best_rate:
            best, best_rate = off, rate
    if best_rate > 0.45:  # nowhere near: not worth the full measure
        return best_rate
    return _ber(a.bits, b.bits, best) or best_rate


def same_audio(a: Fingerprint, b: Fingerprint) -> bool:
    return bit_error(a, b) < BER_MAX


# ---- titles: "other version" ----

_MIX_WORDS = (
    "mix", "edit", "remix", "version", "rework", "dub", "instrumental", "extended", "radio",
    "original", "club", "vip", "remaster", "remastered", "bootleg", "flip", "acapella",
)  # fmt: skip
_BRACKETS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
_DASH_SUFFIX = re.compile(r"\s+-\s+(.*)$")
_FEAT = re.compile(r"\s+(feat\.?|ft\.?|featuring)\s+.*$", re.IGNORECASE)


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text).strip().casefold()


def base_title(title: str) -> str:
    """The title without mix names, featured artists or bracketed notes."""
    out = _BRACKETS.sub("", title)
    suffix = _DASH_SUFFIX.search(out)
    if suffix and any(w in suffix.group(1).casefold() for w in _MIX_WORDS):
        out = out[: suffix.start()]
    return _fold(_FEAT.sub("", out))


def base_artist(artist: str) -> str:
    return _fold(re.split(r"\s+(?:feat\.?|ft\.?|featuring|&|x|vs\.?)\s+|,", artist, maxsplit=1)[0])


# ---- scan ----


@dataclass
class _Track:
    id: int
    path: str
    file_hash: str | None
    duration: float | None
    title: str | None
    artist: str | None


def _tracks(db: Database) -> list[_Track]:
    return [
        _Track(int(r[0]), r[1], r[2], r[3], r[4], r[5])
        for r in db.conn.execute(
            "SELECT id, path, file_hash, duration, title, artist FROM tracks ORDER BY id"
        )
    ]


def save_fingerprint(db: Database, track_id: int, summary: bytes, data: bytes) -> None:
    db.conn.execute(
        "INSERT INTO fingerprints (track_id, version, source_hash, summary, data) "
        "VALUES (?, ?, (SELECT file_hash FROM tracks WHERE id = ?), ?, ?) "
        "ON CONFLICT(track_id) DO UPDATE SET version = excluded.version, "
        "source_hash = excluded.source_hash, summary = excluded.summary, data = excluded.data",
        (track_id, VERSION, track_id, summary, data),
    )


def _stale(db: Database, full: bool) -> list[tuple[int, str]]:
    if full:
        return [(int(r[0]), r[1]) for r in db.conn.execute("SELECT id, path FROM tracks")]
    return [
        (int(r[0]), r[1])
        for r in db.conn.execute(
            "SELECT t.id, t.path FROM tracks t LEFT JOIN fingerprints f ON f.track_id = t.id "
            "WHERE f.track_id IS NULL OR f.version != ? "
            "OR f.source_hash IS NOT t.file_hash",
            (VERSION,),
        )
    ]


def _fingerprint_file(path: str) -> Fingerprint | None:
    try:
        audio = decode(Path(path), sample_rate=SR, channels=1)
    except (OSError, TonaliaError, ValueError):
        return None
    return compute(audio, SR)


def _candidates(
    ids: list[int], durations: list[float], summaries: npt.NDArray[np.float32]
) -> list[tuple[int, int]]:
    """Pairs (index, index) of similar duration whose summaries are alike."""
    order = np.argsort(np.asarray(durations))
    dur = np.asarray(durations)[order]
    vecs = summaries[order]
    n = len(ids)
    out: list[tuple[int, int]] = []
    block = 256
    for i0 in range(0, n, block):
        i1 = min(n, i0 + block)
        top = dur[i1 - 1]
        limit = top + max(DURATION_SLACK[0], top * DURATION_SLACK[1])
        j1 = int(np.searchsorted(dur, limit, side="right"))
        sims = vecs[i0:i1] @ vecs[i0:j1].T
        for r in range(i1 - i0):
            i = i0 + r
            d = dur[i]
            slack = max(DURATION_SLACK[0], d * DURATION_SLACK[1])
            row = sims[r, : j1 - i0].copy()
            row[: r + 1] = -1.0  # only later tracks (and never itself)
            row[dur[i0:j1] - d > slack] = -1.0
            best = np.argsort(row)[::-1][:CANDIDATES]
            out += [(int(order[i]), int(order[i0 + j])) for j in best if row[j] >= SIM_MIN]
    return out


class _Union:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def join(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def _group_id(kind: DuplicateKind, members: Iterable[int]) -> str:
    key = ",".join(str(m) for m in sorted(members))
    return f"{kind}:{hashlib.sha1(key.encode()).hexdigest()[:12]}"


def find_groups(db: Database, check_cancelled: Callable[[], None]) -> list[tuple[str, set[int]]]:
    """Every group the library has now: (kind, members)."""
    tracks = {t.id: t for t in _tracks(db)}
    excluded = {(int(a), int(b)) for a, b in db.conn.execute("SELECT * FROM duplicate_exclusions")}

    def allowed(a: int, b: int) -> bool:
        return (min(a, b), max(a, b)) not in excluded

    union = _Union()
    by_hash: dict[str, list[int]] = defaultdict(list)
    for t in tracks.values():
        if t.file_hash:
            by_hash[t.file_hash].append(t.id)
    for same in by_hash.values():
        for other in same[1:]:
            if allowed(same[0], other):
                union.join(same[0], other)

    rows = db.conn.execute(
        "SELECT track_id, summary FROM fingerprints WHERE version = ?", (VERSION,)
    ).fetchall()
    ids = [int(r[0]) for r in rows if int(r[0]) in tracks]
    if len(ids) > 1:
        summaries = np.stack(
            [
                np.frombuffer(r[1], dtype="<f2").astype(np.float32)
                for r in rows
                if int(r[0]) in tracks
            ]
        )
        durations = [tracks[i].duration or 0.0 for i in ids]
        cache: dict[int, Fingerprint] = {}

        def load(tid: int) -> Fingerprint:
            if tid not in cache:
                s, d = db.conn.execute(
                    "SELECT summary, data FROM fingerprints WHERE track_id = ?", (tid,)
                ).fetchone()
                cache[tid] = Fingerprint.decode(s, d)
            return cache[tid]

        for n, (i, j) in enumerate(_candidates(ids, durations, summaries)):
            if n % 500 == 0:
                check_cancelled()
            a, b = ids[i], ids[j]
            if union.find(a) == union.find(b) or not allowed(a, b):
                continue
            if same_audio(load(a), load(b)):
                union.join(a, b)

    components: dict[int, set[int]] = defaultdict(set)
    for tid in list(union.parent):
        components[union.find(tid)].add(tid)
    out: list[tuple[str, set[int]]] = []
    audio_of: dict[int, int] = {}
    for root, members in components.items():
        if len(members) < 2:
            continue
        hashes = {tracks[m].file_hash for m in members}
        out.append(("identical" if len(hashes) == 1 and None not in hashes else "audio", members))
        for m in members:
            audio_of[m] = root
    versions: dict[tuple[str, str], set[int]] = defaultdict(set)
    for t in tracks.values():
        if t.title and t.artist:
            key = (base_artist(t.artist), base_title(t.title))
            if key[0] and key[1]:
                versions[key].add(t.id)
    for members in versions.values():
        audios = {audio_of.get(m, -m) for m in members}
        ordered = sorted(members)
        # Pairs the user already called different versions do not come back as one.
        told = all((a, b) in excluded for i, a in enumerate(ordered) for b in ordered[i + 1 :])
        if len(members) >= 2 and len(audios) >= 2 and not told:
            out.append(("version", members))
    return out


def scan(
    db: Database,
    full: bool = False,
    progress: Callable[[str, float], None] = lambda *_: None,
    check_cancelled: Callable[[], None] = lambda: None,
    workers: int = 4,
) -> DuplicateScanResult:
    started = time.monotonic()
    todo = _stale(db, full)
    unreadable = 0
    done = 0
    progress("fingerprints", 0)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start in range(0, len(todo), 64):
            check_cancelled()
            chunk = todo[start : start + 64]
            prints = pool.map(lambda t: _fingerprint_file(t[1]), chunk)
            for (tid, _), fp in zip(chunk, prints, strict=True):
                if fp is None:
                    unreadable += 1
                    continue
                save_fingerprint(db, tid, *fp.encode())
                done += 1
            progress("fingerprints", 80 * min(1.0, (start + len(chunk)) / max(1, len(todo))))
    progress("grouping", 80)
    groups = find_groups(db, check_cancelled)
    _store_groups(db, groups)
    db.set_setting("duplicates_last_scan", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    progress("grouping", 100)
    pending = sum(1 for g in list_groups(db).groups)
    return DuplicateScanResult(
        tracks=len(_tracks(db)),
        fingerprinted=done,
        unreadable=unreadable,
        groups=pending,
        seconds=round(time.monotonic() - started, 2),
    )


def _store_groups(db: Database, groups: list[tuple[str, set[int]]]) -> None:
    """Replace the groups, carrying a resolution to a group whose members were all in a
    group resolved the same way (a new copy brings the group back)."""
    resolved: list[tuple[str, set[int], str, str]] = []
    rows = db.conn.execute(
        "SELECT group_id, kind, resolution, resolved_at, track_id FROM duplicate_groups "
        "WHERE resolution IS NOT NULL"
    ).fetchall()
    sets: dict[str, tuple[str, str, str, set[int]]] = {}
    for gid, kind, res, at, tid in rows:
        sets.setdefault(gid, (kind, res, at, set()))[3].add(int(tid))
    resolved = [(k, m, r, a) for k, r, a, m in sets.values()]
    db.conn.execute("BEGIN")
    try:
        db.conn.execute("DELETE FROM duplicate_groups")
        for kind, members in groups:
            carry = next(
                ((r, a) for k, m, r, a in resolved if k == kind and members <= m), (None, None)
            )
            gid = _group_id(kind, members)  # type: ignore[arg-type]
            db.conn.executemany(
                "INSERT INTO duplicate_groups (group_id, track_id, kind, resolution, resolved_at) "
                "VALUES (?, ?, ?, ?, ?)",
                [(gid, m, kind, carry[0], carry[1]) for m in sorted(members)],
            )
        db.conn.execute("COMMIT")
    except BaseException:
        db.conn.execute("ROLLBACK")
        raise


# ---- listing and the best copy ----


def _members(db: Database, ids: Sequence[int]) -> list[DuplicateMember]:
    marks = ", ".join("?" for _ in ids)
    rows = db.conn.execute(
        f"""SELECT t.id, t.title, t.artist, t.path, t.format, t.bitrate, t.duration, t.size,
               t.added_at, a.quality_flags, a.quality_reviewed,
               (SELECT COUNT(*) FROM cues c WHERE c.track_id = t.id) AS cues,
               (SELECT COUNT(*) FROM cues c WHERE c.track_id = t.id
                  AND c.source IN ('user', 'import')) AS own_cues,
               (SELECT COUNT(DISTINCT playlist_id) FROM playlist_tracks p
                  WHERE p.track_id = t.id) AS playlists
        FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id IN ({marks})
        ORDER BY t.id""",
        list(ids),
    ).fetchall()
    out = []
    for r in rows:
        flags = json.loads(r["quality_flags"]) if r["quality_flags"] else []
        issues = 0 if r["quality_reviewed"] else len(flags)
        out.append(
            DuplicateMember(
                track_id=r["id"], title=r["title"], artist=r["artist"], path=r["path"],
                format=r["format"], bitrate=r["bitrate"], duration=r["duration"],
                size=r["size"], quality_issues=issues, cues=r["cues"], own_cues=r["own_cues"],
                playlists=r["playlists"],
            )
        )  # fmt: skip
    return out


def _lossless(m: DuplicateMember) -> bool:
    return (m.format or "").lower() in LOSSLESS


def _rank(m: DuplicateMember) -> tuple[int, int, int, int, int, int]:
    bitrate = 100_000 if _lossless(m) else (m.bitrate or 0)
    return (
        int(_lossless(m)), bitrate, -m.quality_issues, m.cues, m.playlists, -m.track_id,
    )  # fmt: skip


def best_copy(members: list[DuplicateMember]) -> tuple[int, DuplicateReason, str, str]:
    """The copy to keep and why: (track id, reason, its value, the runner-up's value)."""
    ranked = sorted(members, key=_rank, reverse=True)
    best, second = ranked[0], ranked[1]
    if _lossless(best) and not _lossless(second):
        return best.track_id, "lossless", (best.format or "").upper(), (second.format or "").upper()
    if (best.bitrate or 0) > (second.bitrate or 0) and not _lossless(best):
        return best.track_id, "bitrate", str(best.bitrate or 0), str(second.bitrate or 0)
    if best.quality_issues < second.quality_issues:
        return best.track_id, "quality", "0", str(second.quality_issues)
    if best.cues > second.cues:
        return best.track_id, "cues", str(best.cues), str(second.cues)
    if best.playlists > second.playlists:
        return best.track_id, "playlists", str(best.playlists), str(second.playlists)
    return best.track_id, "first_added", "", ""


def list_groups(db: Database, include_resolved: bool = False) -> DuplicateList:
    rows = db.conn.execute(
        "SELECT group_id, kind, resolution, track_id FROM duplicate_groups ORDER BY group_id"
    ).fetchall()
    by_group: dict[str, tuple[str, str | None, list[int]]] = {}
    for gid, kind, res, tid in rows:
        by_group.setdefault(gid, (kind, res, []))[2].append(int(tid))
    groups: list[DuplicateGroup] = []
    resolved = 0
    order = {"identical": 0, "audio": 1, "version": 2}
    for gid, (kind, res, ids) in by_group.items():
        if res is not None:
            resolved += 1
            if not include_resolved:
                continue
        members = _members(db, ids)
        if len(members) < 2:
            continue
        keep, reason, best, other = best_copy(members)
        groups.append(
            DuplicateGroup(
                group_id=gid, kind=kind, members=members, proposed=keep,
                reason=reason, reason_best=best or None, reason_other=other or None,
                resolution=res,
            )
        )  # fmt: skip
    groups.sort(key=lambda g: (order[g.kind], (g.members[0].title or "").casefold()))
    return DuplicateList(
        groups=groups,
        resolved=resolved,
        last_scan=db.get_setting("duplicates_last_scan", None),
        fingerprinted=int(db.conn.execute("SELECT COUNT(*) FROM fingerprints").fetchone()[0]),
        tracks=int(db.conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]),
    )


# ---- resolving ----


def _group_members(db: Database, group_id: str) -> tuple[str, list[int]]:
    rows = db.conn.execute(
        "SELECT kind, track_id FROM duplicate_groups WHERE group_id = ? ORDER BY track_id",
        (group_id,),
    ).fetchall()
    if len(rows) < 2:
        raise DuplicateError(f"duplicate group {group_id} not found")
    return rows[0][0], [int(r[1]) for r in rows]


def _track_tables(db: Database) -> tuple[list[tuple[str, str]], list[tuple[str, str, str, str]]]:
    """Tables that point at tracks ((table, column)) and the ones that point at those
    ((table, column, parent table, parent column)), from the schema's foreign keys."""
    tables = [
        r[0]
        for r in db.conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    ]
    first: list[tuple[str, str]] = []
    keys: dict[str, list[tuple[str, str, str]]] = {}
    for table in tables:
        for fk in db.conn.execute(f"PRAGMA foreign_key_list('{table}')"):
            keys.setdefault(table, []).append((fk[2], fk[3], fk[4]))  # parent, from, to
            if fk[2] == "tracks":
                first.append((table, fk[3]))
    parents = {t for t, _ in first}
    second = [
        (table, col, parent, to)
        for table, fks in keys.items()
        for parent, col, to in fks
        if parent in parents and parent != "tracks" and table not in parents
    ]
    return first, second


def _rows(db: Database, table: str, where: str, args: Sequence[Any]) -> list[dict[str, Any]]:
    cur = db.conn.execute(f"SELECT rowid AS __rowid, * FROM {table} WHERE {where}", list(args))
    return [dict(r) for r in cur]


def _snapshot(db: Database, ids: list[int]) -> dict[str, list[dict[str, Any]]]:
    marks = ", ".join("?" for _ in ids)
    first, second = _track_tables(db)
    out: dict[str, list[dict[str, Any]]] = {"tracks": _rows(db, "tracks", f"id IN ({marks})", ids)}
    for table, col in first:
        seen = {r["__rowid"] for r in out.get(table, [])}
        rows = [r for r in _rows(db, table, f"{col} IN ({marks})", ids) if r["__rowid"] not in seen]
        out.setdefault(table, []).extend(rows)
    for table, col, parent, to in second:
        keys = [r[to] for r in out.get(parent, []) if r.get(to) is not None]
        if keys:
            km = ", ".join("?" for _ in keys)
            out.setdefault(table, []).extend(_rows(db, table, f"{col} IN ({km})", keys))
    return out


def _blob(value: Any) -> Any:
    return {"__b": value.hex()} if isinstance(value, bytes | memoryview) else value


def _unblob(value: Any) -> Any:
    return bytes.fromhex(value["__b"]) if isinstance(value, dict) and "__b" in value else value


def merge(
    db: Database, group_id: str, keep: int | None, trash: Callable[[list[str]], list[str]] | None
) -> DuplicateResolveResult:
    kind, members = _group_members(db, group_id)
    if kind == "version":
        raise TonaliaError("other versions are not merged", reason="invalid_params")
    infos = _members(db, members)
    keeper = keep if keep in members else best_copy(infos)[0]
    others = [m for m in members if m != keeper]
    paths = {m.track_id: m.path for m in infos}
    undo = _snapshot(db, [keeper, *others])
    conn = db.conn
    conn.execute("BEGIN")
    try:
        _move_into(db, keeper, others)
        marks = ", ".join("?" for _ in others)
        # Only the rows: the waveform files stay, so undoing a merge finds them.
        conn.execute(f"DELETE FROM tracks WHERE id IN ({marks})", others)
        merge_id = uuid.uuid4().hex
        data = json.dumps({t: [{k: _blob(v) for k, v in r.items()} for r in rows]
                           for t, rows in undo.items()})  # fmt: skip
        conn.execute(
            "INSERT INTO duplicate_merges (merge_id, keeper_id, removed, undo_data) "
            "VALUES (?, ?, ?, ?)",
            (merge_id, keeper, json.dumps(others), zlib.compress(data.encode("utf-8"))),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    trashed: list[str] = []
    failed: list[str] = []
    if trash is not None:
        failed = trash([paths[o] for o in others])
        trashed = [paths[o] for o in others if paths[o] not in failed]
        conn.execute(
            "UPDATE duplicate_merges SET trashed = ? WHERE merge_id = ?",
            (json.dumps(trashed), merge_id),
        )
    return DuplicateResolveResult(
        action="merge", merge_id=merge_id, kept=keeper, removed=len(others),
        trashed=len(trashed), trash_failed=failed,
    )  # fmt: skip


def _move_into(db: Database, keeper: int, others: list[int]) -> None:
    """What the user made on the other copies, onto the one kept."""
    conn = db.conn
    own = {
        int(r[0]): r[1]
        for r in conn.execute("SELECT slot, source FROM cues WHERE track_id = ?", (keeper,))
    }
    for other in others:
        for slot, pos, label, color, source in conn.execute(
            "SELECT slot, position_sec, label, color, source FROM cues WHERE track_id = ? "
            "AND source IN ('user', 'import') ORDER BY slot",
            (other,),
        ).fetchall():
            if own.get(slot) in (None, "auto"):
                conn.execute(
                    "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
                    "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (track_id, slot) DO UPDATE SET "
                    "position_sec = excluded.position_sec, label = excluded.label, "
                    "color = excluded.color, source = excluded.source",
                    (keeper, slot, pos, label, color, source),
                )
                own[slot] = source
        conn.execute(
            "UPDATE markers SET track_id = ? WHERE track_id = ? AND source != 'auto'",
            (keeper, other),
        )
        conn.execute(
            "DELETE FROM playlist_tracks WHERE track_id = ? AND playlist_id IN "
            "(SELECT playlist_id FROM playlist_tracks WHERE track_id = ?)",
            (other, keeper),
        )
        conn.execute("UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?", (keeper, other))
        conn.execute("UPDATE favorites SET track_a = ? WHERE track_a = ?", (keeper, other))
        conn.execute("UPDATE favorites SET track_b = ? WHERE track_b = ?", (keeper, other))
        conn.execute(
            "UPDATE tracks SET rating = MAX(COALESCE(rating, 0), "
            "COALESCE((SELECT rating FROM tracks WHERE id = ?), 0)), "
            "play_count = COALESCE(play_count, 0) + "
            "COALESCE((SELECT play_count FROM tracks WHERE id = ?), 0) WHERE id = ?",
            (other, other, keeper),
        )
        conn.execute("UPDATE plays SET track_id = ? WHERE track_id = ?", (keeper, other))
        conn.execute(
            "UPDATE energy_ratings SET track_id = ? WHERE track_id = ? AND NOT EXISTS "
            "(SELECT 1 FROM energy_ratings WHERE track_id = ?)",
            (keeper, other, keeper),
        )
    conn.execute(
        "UPDATE tracks SET rating = NULLIF(rating, 0), play_count = NULLIF(play_count, 0) "
        "WHERE id = ?",
        (keeper,),
    )
    refresh_stats(conn, [keeper, *others])


def undo_merge(db: Database, merge_id: str) -> DuplicateUndoResult:
    row = db.conn.execute(
        "SELECT keeper_id, removed, trashed, undo_data, undone_at FROM duplicate_merges "
        "WHERE merge_id = ?",
        (merge_id,),
    ).fetchone()
    if row is None or row["undone_at"]:
        raise DuplicateError(f"merge {merge_id} not found")
    if json.loads(row["trashed"]):
        raise MergeUndoError("the other copies were moved to the trash", reason="undo_changed")
    removed = json.loads(row["removed"])
    keeper = int(row["keeper_id"])
    marks = ", ".join("?" for _ in removed)
    back = db.conn.execute(f"SELECT 1 FROM tracks WHERE id IN ({marks})", removed).fetchone()
    if (
        back is not None
        or db.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (keeper,)).fetchone() is None
    ):
        raise MergeUndoError("the library changed after the merge")
    snapshot: dict[str, list[dict[str, Any]]] = json.loads(zlib.decompress(row["undo_data"]))
    first, second = _track_tables(db)
    conn = db.conn
    conn.execute("BEGIN")
    try:
        # The keeper's rows go (their dependants first: a cue review points at a cue), and
        # everything comes back as it was before the merge.
        for table, col, parent, to in second:
            parent_col = next(c for t, c in first if t == parent)
            conn.execute(
                f"DELETE FROM {table} WHERE {col} IN "
                f"(SELECT {to} FROM {parent} WHERE {parent_col} = ?)",
                (keeper,),
            )
        for table, col in first:
            conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (keeper,))
        for table in ["tracks", *dict.fromkeys(t for t, _ in first), *(t for t, *_ in second)]:
            for r in snapshot.get(table, []):
                values = {k: _unblob(v) for k, v in r.items() if k != "__rowid"}
                cols = ", ".join(values)
                marks2 = ", ".join("?" for _ in values)
                conn.execute(
                    f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({marks2})",
                    list(values.values()),
                )
        conn.execute(
            "UPDATE duplicate_merges SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
            "WHERE merge_id = ?",
            (merge_id,),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return DuplicateUndoResult(merge_id=merge_id, restored=len(removed))


def resolve(
    db: Database,
    params: DuplicateResolveParams,
    trash: Callable[[list[str]], list[str]] | None = None,
) -> DuplicateResolveResult:
    kind, members = _group_members(db, params.group_id)
    if params.action == "merge":
        return merge(db, params.group_id, params.keep_track_id, trash if params.trash else None)
    if params.action == "distinct" and kind != "version":
        db.conn.executemany(
            "INSERT OR IGNORE INTO duplicate_exclusions (track_a, track_b) VALUES (?, ?)",
            [(a, b) for i, a in enumerate(members) for b in members[i + 1 :]],
        )
    db.conn.execute(
        "UPDATE duplicate_groups SET resolution = ?, "
        "resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE group_id = ?",
        (params.action, params.group_id),
    )
    return DuplicateResolveResult(action=params.action, kept=None, removed=0)
