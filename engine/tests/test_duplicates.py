"""Duplicates (SPEC 13.3): the fingerprint survives encodings and tags, groups of identical
files, the same audio and other versions, the best copy, the three actions, merging and
undoing it, precision on a generated set and the scan's speed."""

from __future__ import annotations

import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call, wait_job
from tonalia_engine import duplicates as dup
from tonalia_engine.audio_io import decode, ffmpeg_path
from tonalia_engine.rpc_schema import DuplicateResolveParams
from tonalia_engine.server import EngineContext

SR = 44100
TABLES = {
    "tracks": "id", "analysis": "track_id", "cues": "id", "markers": "id",
    "playlist_tracks": "playlist_id, position", "favorites": "id", "fingerprints": "track_id",
}  # fmt: skip


def song(path: Path, seed: int, seconds: float = 30.0, lead_silence: float = 0.0) -> Path:
    """A made-up track: kick, hats, a chord every two beats and a lead, from ``seed``."""
    rng = np.random.default_rng(seed)
    bpm = rng.uniform(100, 140)
    beat = 60.0 / bpm
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(int(seconds / beat)):
        start = int(k * beat * SR)
        length = min(int(0.25 * SR), n - start)
        env = np.exp(-np.arange(length) / (0.05 * SR))
        out[start : start + length] += 0.6 * env * np.sin(2 * np.pi * 55 * np.arange(length) / SR)
        hat = int((k + 0.5) * beat * SR)
        if hat + 800 < n:
            out[hat : hat + 800] += 0.08 * rng.standard_normal(800) * np.exp(-np.arange(800) / 150)
    notes = 220.0 * 2 ** (rng.integers(0, 24, size=(int(seconds / beat / 2) + 1, 3)) / 12)
    chord_len = 2 * beat
    for i, chord in enumerate(notes):
        a, b = int(i * chord_len * SR), min(n, int((i + 1) * chord_len * SR))
        if a >= n:
            break
        for f in chord:
            out[a:b] += 0.12 * np.sin(2 * np.pi * f * t[a:b])
        lead = 440.0 * 2 ** (rng.integers(0, 12) / 12)
        out[a:b] += 0.08 * np.sin(2 * np.pi * lead * t[a:b]) * (rng.random() > 0.3)
    out = np.concatenate([np.zeros(int(lead_silence * SR)), out])
    pcm = (np.clip(out, -1, 1) * 30000).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def encode(src: Path, dest: Path, *args: str, title: str = "", artist: str = "") -> Path:
    meta = ["-metadata", f"title={title}", "-metadata", f"artist={artist}"] if title else []
    subprocess.run(
        [ffmpeg_path(), "-nostdin", "-loglevel", "error", "-y", "-i", str(src), *args, *meta,
         str(dest)],
        check=True,
    )  # fmt: skip
    return dest


MP3 = ("-c:a", "libmp3lame", "-b:a", "192k")
MP3_128 = ("-c:a", "libmp3lame", "-b:a", "128k")
FLAC = ("-c:a", "flac")


def fp(path: Path) -> dup.Fingerprint:
    out = dup.compute(decode(path, sample_rate=dup.SR, channels=1), dup.SR)
    assert out is not None
    return out


def test_the_fingerprint_survives_encodings_tags_and_silence(tmp_path: Path) -> None:
    a = song(tmp_path / "a.wav", 1)
    mp3 = fp(encode(a, tmp_path / "a.mp3", *MP3, title="A", artist="X"))
    flac = fp(encode(a, tmp_path / "a.flac", *FLAC, title="Otro título", artist="Y"))
    low = fp(encode(song(tmp_path / "a2.wav", 1, lead_silence=1.3), tmp_path / "a2.mp3", *MP3_128))
    other = fp(encode(song(tmp_path / "b.wav", 2), tmp_path / "b.mp3", *MP3))
    assert dup.bit_error(mp3, flac) < 0.15
    assert dup.same_audio(mp3, low) and dup.same_audio(flac, low)
    assert dup.bit_error(mp3, other) > 0.4 and not dup.same_audio(flac, other)
    # The stored form decodes to the same fingerprint.
    again = dup.Fingerprint.decode(*mp3.encode())
    assert np.array_equal(again.bits, mp3.bits) and np.array_equal(again.loudness, mp3.loudness)


def test_a_very_short_track_still_has_a_summary() -> None:
    rng = np.random.default_rng(1)
    short = dup.compute(rng.standard_normal(dup.SR * 4), dup.SR)
    assert short is not None and np.isfinite(short.summary).all()
    assert dup.compute(np.zeros(dup.SR), dup.SR) is None  # under ~2 s


def test_base_titles_and_artists() -> None:
    assert dup.base_title("Midnight Bloom (Extended Mix)") == "midnight bloom"
    assert dup.base_title("Midnight Bloom - Radio Edit") == "midnight bloom"
    assert dup.base_title("Midnight Bloom feat. Sora Vela [Kairo Remix]") == "midnight bloom"
    assert dup.base_title("Over - Under") == "over - under"  # not a mix name
    assert dup.base_artist("Lumen Drift feat. Sora Vela") == "lumen drift"
    assert dup.base_artist("Lúmen Drift & Kairo") == "lumen drift"


def add(ctx: EngineContext, folder: Path) -> dict[str, int]:
    wait_job(ctx, call(ctx, "library.addPaths", {"paths": [str(folder)]})["jobId"])
    return {Path(r[1]).name: int(r[0]) for r in ctx.db.conn.execute("SELECT id, path FROM tracks")}


def add_copy(ctx: EngineContext, track_id: int, path: Path) -> int:
    """The same file at another path, as an older library may hold (adding a file whose
    hash is already in the library is skipped)."""
    src = ctx.db.conn.execute("SELECT path FROM tracks WHERE id = ?", (track_id,)).fetchone()[0]
    shutil.copy2(src, path)
    cur = ctx.db.conn.execute(
        "INSERT INTO tracks (path, file_hash, size, mtime, format, duration, bitrate, "
        "sample_rate, title, artist, status, display_title, search_text, added_at) "
        "SELECT ?, file_hash, size, mtime, format, duration, bitrate, sample_rate, title, "
        "artist, status, display_title, search_text, added_at FROM tracks WHERE id = ?",
        (str(path), track_id),
    )
    return int(cur.lastrowid or 0)


def scan(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, "duplicates.scan", options)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def groups(ctx: EngineContext) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = call(ctx, "duplicates.list")["groups"]
    return out


def ids(group: dict[str, Any]) -> set[int]:
    return {m["trackId"] for m in group["members"]}


@pytest.fixture
def library(engine_ctx: EngineContext, tmp_path: Path) -> dict[str, int]:
    music = tmp_path / "Música ñ"
    music.mkdir()
    a = song(tmp_path / "src" / "a.wav", 11)
    encode(a, music / "Bloom.mp3", *MP3_128, title="Midnight Bloom", artist="Lumen Drift")
    encode(a, music / "Bloom (lossless).flac", *FLAC, title="Midnight Bloom", artist="Lumen")
    b = song(tmp_path / "src" / "b.wav", 12)
    encode(b, music / "Neon.mp3", *MP3, title="Neon (Original Mix)", artist="Kairo")
    c = song(tmp_path / "src" / "c.wav", 13)
    encode(c, music / "Neon ext.mp3", *MP3, title="Neon (Extended Mix)", artist="Kairo")
    lib = add(engine_ctx, music)
    lib["Bloom copia.mp3"] = add_copy(engine_ctx, lib["Bloom.mp3"], music / "Bloom copia.mp3")
    return lib


def test_the_scan_finds_identical_files_the_same_audio_and_other_versions(
    engine_ctx: EngineContext, library: dict[str, int]
) -> None:
    result = scan(engine_ctx)
    assert result["fingerprinted"] == 5 and result["unreadable"] == 0
    found = {g["kind"]: g for g in groups(engine_ctx)}
    # The two MP3 copies are one file twice; with the FLAC they are the same audio.
    bloom = {library["Bloom.mp3"], library["Bloom copia.mp3"], library["Bloom (lossless).flac"]}
    assert ids(found["audio"]) == bloom
    assert ids(found["version"]) == {library["Neon.mp3"], library["Neon ext.mp3"]}
    assert "identical" not in found  # the identical pair is inside the audio group
    # The best copy is the lossless one, and it says why.
    assert found["audio"]["proposed"] == library["Bloom (lossless).flac"]
    assert (found["audio"]["reason"], found["audio"]["reasonBest"]) == ("lossless", "FLAC")
    # A second scan computes nothing new (incremental) and finds the same.
    again = scan(engine_ctx)
    assert again["fingerprinted"] == 0 and len(groups(engine_ctx)) == 2


def test_identical_files_alone_are_their_own_kind(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    music = tmp_path / "m"
    music.mkdir()
    encode(song(tmp_path / "x.wav", 21), music / "uno.mp3", *MP3)
    (one,) = add(engine_ctx, music).values()
    add_copy(engine_ctx, one, music / "dos.mp3")
    scan(engine_ctx)
    (group,) = groups(engine_ctx)
    assert group["kind"] == "identical" and len(group["members"]) == 2
    assert group["reason"] == "first_added"


def test_keep_all_hides_a_group_until_another_copy_joins(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    scan(engine_ctx)
    audio = next(g for g in groups(engine_ctx) if g["kind"] == "audio")
    call(engine_ctx, "duplicates.resolve", {"groupId": audio["groupId"], "action": "keep_all"})
    assert [g["kind"] for g in groups(engine_ctx)] == ["version"]
    scan(engine_ctx)
    assert [g["kind"] for g in groups(engine_ctx)] == ["version"]
    # A fourth copy brings the group back.
    music = Path(next(iter(engine_ctx.db.conn.execute("SELECT path FROM tracks")))[0]).parent
    encode(song(tmp_path / "src" / "a.wav", 11), music / "Bloom 4.m4a", "-c:a", "aac")
    add(engine_ctx, music)
    scan(engine_ctx)
    audio = next(g for g in groups(engine_ctx) if g["kind"] == "audio")
    assert len(audio["members"]) == 4


def test_different_versions_are_never_grouped_again(
    engine_ctx: EngineContext, library: dict[str, int]
) -> None:
    scan(engine_ctx)
    audio = next(g for g in groups(engine_ctx) if g["kind"] == "audio")
    call(engine_ctx, "duplicates.resolve", {"groupId": audio["groupId"], "action": "distinct"})
    pairs = engine_ctx.db.conn.execute("SELECT COUNT(*) FROM duplicate_exclusions").fetchone()[0]
    assert pairs == 3
    scan(engine_ctx)
    assert [g["kind"] for g in groups(engine_ctx)] == ["version"]


def dump(ctx: EngineContext) -> dict[str, list[tuple[Any, ...]]]:
    return {
        table: [tuple(r) for r in ctx.db.conn.execute(f"SELECT * FROM {table} ORDER BY {order}")]
        for table, order in TABLES.items()
    }


def test_merge_moves_what_the_user_made_and_undo_puts_it_back(
    engine_ctx: EngineContext, library: dict[str, int]
) -> None:
    scan(engine_ctx)
    audio = next(g for g in groups(engine_ctx) if g["kind"] == "audio")
    keep = library["Bloom (lossless).flac"]
    mp3, copy = library["Bloom.mp3"], library["Bloom copia.mp3"]
    conn = engine_ctx.db.conn
    conn.execute(
        "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
        "VALUES (?, 2, 12.5, 'Mío', '#FF0000', 'user')",
        (mp3,),
    )
    conn.execute(
        "INSERT INTO markers (track_id, kind, position_sec, source) "
        "VALUES (?, 'memory', 4, 'user')",
        (copy,),
    )
    conn.execute("UPDATE tracks SET rating = 4, play_count = 3 WHERE id = ?", (mp3,))
    conn.execute("UPDATE tracks SET play_count = 2 WHERE id = ?", (copy,))
    pl = call(engine_ctx, "playlists.create", {"name": "Bolos"})["id"]
    call(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": [mp3, keep, copy]})
    other = library["Neon.mp3"]
    fav = conn.execute(
        "INSERT INTO favorites (track_a, track_b, mode) VALUES (?, ?, 'mashup')", (mp3, other)
    ).lastrowid
    before = dump(engine_ctx)
    paths = {r[0]: r[1] for r in conn.execute("SELECT id, path FROM tracks")}

    out = call(engine_ctx, "duplicates.resolve", {"groupId": audio["groupId"], "action": "merge"})
    assert out["kept"] == keep and out["removed"] == 2 and out["trashed"] == 0
    left = {r[0] for r in conn.execute("SELECT id FROM tracks")}
    assert mp3 not in left and copy not in left and keep in left
    assert Path(paths[mp3]).exists() and Path(paths[copy]).exists()  # never off the disk
    cue = conn.execute(
        "SELECT position_sec, label, source FROM cues WHERE track_id = ? AND slot = 2", (keep,)
    ).fetchone()
    assert tuple(cue) == (12.5, "Mío", "user")
    assert conn.execute("SELECT COUNT(*) FROM markers WHERE track_id = ?", (keep,)).fetchone()[0]
    assert tuple(conn.execute("SELECT rating, play_count FROM tracks WHERE id = ?", (keep,))
                 .fetchone()) == (4, 5)  # fmt: skip
    in_list = [r[0] for r in conn.execute(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position", (pl,)
    )]  # fmt: skip
    assert in_list == [keep]
    assert conn.execute("SELECT track_a FROM favorites WHERE id = ?", (fav,)).fetchone()[0] == keep

    call(engine_ctx, "duplicates.undo", {"mergeId": out["mergeId"]})
    after = dump(engine_ctx)
    assert {t: sorted(r) for t, r in after.items()} == {t: sorted(r) for t, r in before.items()}
    # Undone once: a second time is refused.
    reply = call_error(engine_ctx, "duplicates.undo", {"mergeId": out["mergeId"]})
    assert reply["data"]["reason"] == "group_not_found"


def call_error(ctx: EngineContext, method: str, params: Any) -> dict[str, Any]:
    import json

    from tonalia_engine.server import build_dispatcher

    out = build_dispatcher(ctx).handle_line(
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    )
    assert out is not None
    error: dict[str, Any] = json.loads(out)["error"]
    return error


def test_moving_to_the_trash_is_per_group_and_then_undo_is_refused(
    engine_ctx: EngineContext, library: dict[str, int]
) -> None:
    scan(engine_ctx)
    audio = next(g for g in groups(engine_ctx) if g["kind"] == "audio")
    asked: list[list[str]] = []

    def trash(paths: list[str]) -> list[str]:
        asked.append(paths)
        return paths[:1]  # the first one could not be moved

    out = dup.resolve(
        engine_ctx.db,
        DuplicateResolveParams(group_id=audio["groupId"], action="merge", trash=True),
        trash=trash,
    )
    assert len(asked) == 1 and len(asked[0]) == 2
    assert out.trashed == 1 and out.trash_failed == asked[0][:1]
    reply = call_error(engine_ctx, "duplicates.undo", {"mergeId": out.merge_id})
    assert reply["data"]["reason"] == "undo_changed"
    # Other versions are never merged.
    version = next(g for g in groups(engine_ctx) if g["kind"] == "version")
    reply = call_error(
        engine_ctx, "duplicates.resolve", {"groupId": version["groupId"], "action": "merge"}
    )
    assert reply["data"]["reason"] == "invalid_params"


def test_precision_on_a_generated_set(engine_ctx: EngineContext, tmp_path: Path) -> None:
    """Ten tracks as MP3 and FLAC with different tags, plus ten others of the same length:
    every copy pair is grouped and nothing else (precision ≥ 0.98)."""
    music = tmp_path / "set"
    music.mkdir()
    truth: set[frozenset[str]] = set()
    for i in range(10):
        src = song(tmp_path / "src" / f"s{i}.wav", 100 + i, seconds=24.0)
        encode(src, music / f"s{i}.mp3", *MP3, title=f"Tema {i}", artist="A")
        encode(src, music / f"s{i}.flac", *FLAC, title=f"Track {i} (master)", artist="B")
        truth.add(frozenset({f"s{i}.mp3", f"s{i}.flac"}))
        other = song(tmp_path / "src" / f"o{i}.wav", 500 + i, seconds=24.0)
        encode(other, music / f"o{i}.mp3", *MP3, title=f"Otro {i}", artist="C")
    names = {v: k for k, v in add(engine_ctx, music).items()}
    scan(engine_ctx)
    found = {
        frozenset(names[t] for t in ids(g)) for g in groups(engine_ctx) if g["kind"] != "version"
    }
    pairs_found = {frozenset(p) for g in found for p in _pairs(g)}
    pairs_true = {frozenset(p) for g in truth for p in _pairs(g)}
    correct = len(pairs_found & pairs_true)
    assert correct == len(pairs_true)  # every copy found
    assert correct / max(1, len(pairs_found)) >= 0.98


def _pairs(group: frozenset[str]) -> list[tuple[str, str]]:
    items = sorted(group)
    return [(a, b) for i, a in enumerate(items) for b in items[i + 1 :]]


def test_twenty_thousand_tracks_group_in_under_a_minute(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    rng = np.random.default_rng(7)
    conn = engine_ctx.db.conn
    n, frames = 20_000, 1600
    base_bits = rng.integers(0, 2**32, size=(50, frames), dtype=np.uint64).astype(np.uint32)
    conn.execute("BEGIN")
    for i in range(n):
        conn.execute(
            "INSERT INTO tracks (id, path, duration, size, format, status, display_title, "
            "search_text, added_at) VALUES (?, ?, ?, 1, 'mp3', 'ready', ?, '', 'x')",
            (i + 1, f"/m/{i}.mp3", 180 + (i % 50 if i < 100 else rng.uniform(0, 300)), str(i)),
        )
        if i < 100:  # 50 tracks, each twice: a few bits flipped in the copy
            bits = base_bits[i % 50].copy()
            if i >= 50:
                flip = rng.integers(0, 32, size=frames, dtype=np.uint32)
                mask = (rng.random(frames) < 0.15).astype(np.uint32)
                bits ^= (np.uint32(1) << flip) * mask
            vec = np.random.default_rng(i % 50).standard_normal(dup.SUMMARY_SIZE)
        else:
            bits = rng.integers(0, 2**32, size=frames, dtype=np.uint64).astype(np.uint32)
            vec = rng.standard_normal(dup.SUMMARY_SIZE)
        loud = (
            np.random.default_rng(i % 50 if i < 100 else i)
            .integers(0, 255, frames)
            .astype(np.uint8)
        )
        unit = (vec / np.linalg.norm(vec)).astype(np.float32)
        summary, data = dup.Fingerprint(bits, loud, unit).encode()
        conn.execute(
            "INSERT INTO fingerprints VALUES (?, ?, NULL, ?, ?)",
            (i + 1, dup.VERSION, summary, data),
        )
    conn.execute("COMMIT")
    started = time.monotonic()
    found = dup.find_groups(engine_ctx.db, lambda: None)
    elapsed = time.monotonic() - started
    assert elapsed < 60, elapsed
    audio = [m for kind, m in found if kind == "audio"]
    assert sorted(sorted(m) for m in audio) == [[i + 1, i + 51] for i in range(50)]


def test_analysis_stores_the_fingerprint(engine_ctx: EngineContext, tmp_path: Path) -> None:
    music = tmp_path / "a"
    music.mkdir()
    encode(song(tmp_path / "s.wav", 3, seconds=20.0), music / "s.mp3", *MP3)
    (tid,) = add(engine_ctx, music).values()
    wait_job(engine_ctx, call(engine_ctx, "analysis.start", {"trackIds": [tid]})["jobId"])
    row = engine_ctx.db.conn.execute(
        "SELECT version, source_hash = (SELECT file_hash FROM tracks WHERE id = ?) "
        "FROM fingerprints WHERE track_id = ?",
        (tid, tid),
    ).fetchone()
    assert row is not None and tuple(row) == (dup.VERSION, 1)
    assert scan(engine_ctx)["fingerprinted"] == 0
