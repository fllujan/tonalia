import os
import shutil
from pathlib import Path

import pytest
from mutagen.flac import FLAC

from tests.fixtures.generate import encode, write_tone_wav
from tonalia_engine.db import Database
from tonalia_engine.jobs import JobCancelled, JobContext
from tonalia_engine.library import Library, file_hash, scan
from tonalia_engine.rpc_schema import LibraryQuery


class NullNotifier:
    def notify(self, method: str, params: object) -> None:
        pass


def ctx() -> JobContext:
    return JobContext("test", NullNotifier())


@pytest.fixture(scope="module")
def master(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One small FLAC used as the template for every library test file."""
    folder = tmp_path_factory.mktemp("master")
    return encode(write_tone_wav(folder / "src.wav", seconds=1.0), folder / "m.flac", "flac")


def make_track(master: Path, dest: Path, title: str, freq_tag: str = "") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(master, dest)
    audio = FLAC(dest)
    audio["title"] = title
    audio["artist"] = "Lumen Drift"
    audio["genre"] = "Melodic House"
    if freq_tag:
        audio["comment"] = freq_tag  # makes the content (and hash) unique
    audio.save()
    return dest


@pytest.fixture
def lib(tmp_path: Path) -> Library:
    db = Database.open(tmp_path / "data" / "tonalia.db")
    return Library(db, tmp_path / "data" / "artwork")


@pytest.fixture
def music(tmp_path: Path, master: Path) -> Path:
    root = tmp_path / "Música 🎧"
    make_track(master, root / "Midnight Bloom.flac", "Midnight Bloom", "1")
    make_track(master, root / "Sub carpeta ñ" / "Golden Hour Tide.flac", "Golden Hour Tide", "2")
    make_track(master, root / "Sub carpeta ñ" / "Más" / "Neon Cathedral.flac", "Neon Cathedral",
               "3")  # fmt: skip
    (root / "notas.txt").write_text("not audio", encoding="utf-8")
    (root / "._Midnight Bloom.flac").write_bytes(b"AppleDouble junk")
    (root / ".hidden" / "x.flac").parent.mkdir()
    shutil.copyfile(master, root / ".hidden" / "x.flac")
    return root


def titles(lib: Library) -> list[str]:
    page = lib.list(LibraryQuery(sort="title", descending=False))
    return [t.title or "" for t in page.items]


def test_scan_skips_hidden_and_unsupported(music: Path) -> None:
    found = sorted(p.name for p in scan([music]))
    assert found == ["Golden Hour Tide.flac", "Midnight Bloom.flac", "Neon Cathedral.flac"]


def test_scan_accepts_single_files_and_missing_paths(music: Path) -> None:
    single = music / "Midnight Bloom.flac"
    assert list(scan([single, music / "no existe"])) == [single]


def test_file_hash_uses_head_tail_and_size(tmp_path: Path) -> None:
    a = tmp_path / "a.bin"
    a.write_bytes(b"x" * 3_000_000)
    h1 = file_hash(a)
    a.write_bytes(b"x" * 1_500_000 + b"y" + b"x" * 1_499_999)  # middle change: same hash
    assert file_hash(a) == h1
    a.write_bytes(b"x" * 2_999_999 + b"z")  # tail change
    assert file_hash(a) != h1


def test_add_recursive_with_metadata(lib: Library, music: Path) -> None:
    result = lib.add_paths([music], ctx())
    assert result.added == 3 and not result.failed
    assert titles(lib) == ["Golden Hour Tide", "Midnight Bloom", "Neon Cathedral"]
    item = lib.list(LibraryQuery(search="neon")).items[0]
    assert item.artist == "Lumen Drift"
    assert item.format == "flac"
    assert item.status == "pending"
    assert item.duration == pytest.approx(1.0, abs=0.05)
    assert "Más" in item.path and "🎧" in item.path


def test_readding_is_a_no_op(lib: Library, music: Path) -> None:
    lib.add_paths([music], ctx())
    result = lib.add_paths([music], ctx())
    assert (result.added, result.unchanged) == (0, 3)


def test_modified_file_is_updated_and_flagged(lib: Library, music: Path) -> None:
    lib.add_paths([music], ctx())
    path = music / "Midnight Bloom.flac"
    track_id = lib.list(LibraryQuery(search="Midnight")).items[0].id
    lib.db.conn.execute("UPDATE tracks SET status='ready' WHERE id=?", (track_id,))
    audio = FLAC(path)
    audio["title"] = "Midnight Bloom (Extended Mix)"
    audio.save()
    os.utime(path, (1_900_000_000, 1_900_000_000))
    result = lib.add_paths([music], ctx())
    assert (result.updated, result.unchanged) == (1, 2)
    detail = lib.get(track_id)
    assert detail.title == "Midnight Bloom (Extended Mix)"
    assert detail.status == "pending"


def test_moved_file_is_relocated_not_duplicated(lib: Library, music: Path, tmp_path: Path) -> None:
    lib.add_paths([music], ctx())
    old = music / "Midnight Bloom.flac"
    track_id = lib.list(LibraryQuery(search="Midnight")).items[0].id
    new = tmp_path / "Otra carpeta 🌙" / "Midnight Bloom.flac"
    new.parent.mkdir()
    old.rename(new)
    result = lib.add_paths([new.parent], ctx())
    assert (result.moved, result.added) == (1, 0)
    assert lib.get(track_id).path == str(new)
    assert lib.list(LibraryQuery()).total == 3


def test_duplicate_copy_is_skipped(lib: Library, music: Path, tmp_path: Path) -> None:
    lib.add_paths([music], ctx())
    copy = tmp_path / "copia.flac"
    shutil.copyfile(music / "Midnight Bloom.flac", copy)
    result = lib.add_paths([copy], ctx())
    assert (result.duplicates, result.added) == (1, 0)


def test_corrupt_file_is_recorded_as_error(lib: Library, tmp_path: Path, music: Path) -> None:
    bad = music / "roto.mp3"
    bad.write_bytes(b"\x00" * 4096)
    result = lib.add_paths([music], ctx())
    assert result.added == 4
    errors = lib.list(LibraryQuery(status="error")).items
    assert len(errors) == 1 and errors[0].path.endswith("roto.mp3") and errors[0].error


def test_cancel_stops_between_files(lib: Library, music: Path) -> None:
    c = ctx()
    c.cancel()
    with pytest.raises(JobCancelled):
        lib.add_paths([music], c)


def test_list_paging_search_sort(lib: Library, music: Path) -> None:
    lib.add_paths([music], ctx())
    page = lib.list(LibraryQuery(sort="title", descending=True, limit=2))
    assert page.total == 3
    assert [t.title for t in page.items] == ["Neon Cathedral", "Midnight Bloom"]
    page2 = lib.list(LibraryQuery(sort="title", descending=True, limit=2, offset=2))
    assert [t.title for t in page2.items] == ["Golden Hour Tide"]
    assert lib.list(LibraryQuery(search="carpeta ñ")).total == 2  # matches the path
    assert lib.list(LibraryQuery(search="lumen")).total == 3
    assert lib.list(LibraryQuery(search="100%_")).total == 0  # LIKE wildcards escaped


def test_remove_keeps_files(lib: Library, music: Path) -> None:
    lib.add_paths([music], ctx())
    ids = [t.id for t in lib.list(LibraryQuery()).items]
    assert lib.remove(ids[:2]) == 2
    assert lib.list(LibraryQuery()).total == 1
    assert (music / "Midnight Bloom.flac").exists()


def test_untitled_tracks_sort_by_file_name(lib: Library, music: Path, master: Path) -> None:
    untitled = music / "Zeta sin etiquetas.flac"
    shutil.copyfile(master, untitled)  # the master has no title tag
    lib.add_paths([music], ctx())
    assert titles(lib) == ["Golden Hour Tide", "Midnight Bloom", "Neon Cathedral", ""]
    page = lib.list(LibraryQuery(sort="title", descending=False))
    assert page.items[-1].path == str(untitled)
    # Moving an untitled file updates its sort name.
    moved = music / "Alfa movido.flac"
    untitled.rename(moved)
    lib.add_paths([music], ctx())
    first = lib.list(LibraryQuery(sort="title", descending=False)).items[0]
    assert first.path == str(moved)


def test_get_unknown_track(lib: Library) -> None:
    with pytest.raises(KeyError):
        lib.get(999)
