"""Tag writing (SPEC 2.9): preview, atomic write, exact undo, every supported format."""

import shutil
from pathlib import Path

import mutagen
import pytest
from mutagen.id3 import COMM, ID3, TIT2

from tests.fixtures.generate import FORMATS, make_all
from tonalia_engine.keys import Key
from tonalia_engine.metadata import read_metadata
from tonalia_engine.rpc_schema import TagOptions
from tonalia_engine.tags.backup import UndoRefusedError, make_patch, restore
from tonalia_engine.tags.writer import TagValues, TagWriteError, plan_changes, write_tags

VALUES = TagValues(key=Key(9, "minor"), key_alt=Key(4, "minor"), bpm=124.0, energy=7)


@pytest.fixture(scope="module")
def originals(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    folder = tmp_path_factory.mktemp("tags originales ñ 🎧")
    files = make_all(folder)
    for path in files.values():
        audio = mutagen.File(path)
        if audio.tags is None:
            audio.add_tags()
        if isinstance(audio.tags, ID3):
            audio.tags.add(TIT2(encoding=3, text="Midnight Bloom"))
            audio.tags.add(COMM(encoding=3, lang="eng", desc="", text="Free download"))
        elif type(audio).__name__ == "MP4":
            audio.tags["\xa9nam"] = ["Midnight Bloom"]
            audio.tags["\xa9cmt"] = ["Free download"]
        else:
            audio.tags["title"] = ["Midnight Bloom"]
            audio.tags["comment"] = ["Free download"]
        audio.save()
    return files


@pytest.fixture
def files(originals: dict[str, Path], tmp_path: Path) -> dict[str, Path]:
    out = {}
    for fmt, src in originals.items():
        dest = tmp_path / src.name
        shutil.copy2(src, dest)
        out[fmt] = dest
    return out


def options(**overrides: object) -> TagOptions:
    return TagOptions.model_validate(overrides)


@pytest.mark.parametrize("fmt", list(FORMATS))
def test_preview_lists_changes_without_touching_the_file(files: dict[str, Path], fmt: str) -> None:
    path = files[fmt]
    before = path.read_bytes()
    changes = {c.field: c for c in plan_changes(path, VALUES, options())}
    assert changes["key"].before is None and changes["key"].after == "8A"
    # Integer where the format says so (ID3 TBPM, MP4 tmpo); Vorbis comments keep decimals.
    assert changes["bpm"].after == ("124.00" if fmt in ("flac", "ogg") else "124")
    assert changes["comment"].before == "Free download"
    assert changes["comment"].after == "8A - Energy 7 | Free download"
    assert path.read_bytes() == before


@pytest.mark.parametrize("fmt", list(FORMATS))
def test_write_then_undo_restores_every_byte(files: dict[str, Path], fmt: str) -> None:
    path = files[fmt]
    original = path.read_bytes()
    outcome = write_tags(path, plan_changes(path, VALUES, options(energyInGrouping=True)))
    assert outcome is not None
    meta = read_metadata(path)
    assert meta.key_tag == "8A"
    assert meta.bpm_tag in ("124.00", "124")  # MP4 stores an integer BPM
    assert meta.comment == "8A - Energy 7 | Free download"
    assert meta.title == "Midnight Bloom"  # other tags untouched
    assert path.read_bytes() != original
    assert len(outcome.patch) < len(original)  # only the changed region is kept
    restore(path, outcome.patch)
    assert path.read_bytes() == original


def test_comment_positions_and_no_duplication(files: dict[str, Path]) -> None:
    path = files["mp3"]
    after = {
        pos: next(
            c.after
            for c in plan_changes(path, VALUES, options(commentPosition=pos))
            if c.field == "comment"
        )
        for pos in ("before", "after", "replace")
    }
    assert after == {
        "before": "8A - Energy 7 | Free download",
        "after": "Free download | 8A - Energy 7",
        "replace": "8A - Energy 7",
    }
    write_tags(path, plan_changes(path, VALUES, options()))
    again = [c for c in plan_changes(path, VALUES, options()) if c.field == "comment"]
    assert again == []  # already written: nothing to change


def test_template_variables_and_notation(files: dict[str, Path]) -> None:
    opts = options(
        commentTemplate="{key}/{key_alt} E{energy} {bpm} [{comment_original}]",
        commentPosition="replace",
        notation="classical",
        bpmDecimals=0,
    )
    changes = {c.field: c.after for c in plan_changes(files["flac"], VALUES, opts)}
    assert changes["key"] == "Am"
    assert changes["bpm"] == "124"
    assert changes["comment"] == "Am/Em E7 124 [Free download]"


def test_undo_refuses_a_file_changed_since(files: dict[str, Path]) -> None:
    path = files["mp3"]
    outcome = write_tags(path, plan_changes(path, VALUES, options()))
    assert outcome is not None
    audio = mutagen.File(path)
    audio.tags.add(TIT2(encoding=3, text="Edited elsewhere"))
    audio.save()
    edited = path.read_bytes()
    with pytest.raises(UndoRefusedError):
        restore(path, outcome.patch)
    assert path.read_bytes() == edited  # never overwritten


def test_id3v23_files_stay_v23(files: dict[str, Path]) -> None:
    path = files["mp3"]
    tags = ID3(path)
    tags.save(path, v2_version=3)
    write_tags(path, plan_changes(path, VALUES, options()))
    assert ID3(path).version[:2] == (2, 3)


def test_failed_write_leaves_the_original_intact(files: dict[str, Path], tmp_path: Path) -> None:
    broken = tmp_path / "roto.mp3"
    broken.write_bytes(b"\x00" * 2048)
    with pytest.raises(TagWriteError):
        write_tags(broken, plan_changes(files["mp3"], VALUES, options()))
    assert broken.read_bytes() == b"\x00" * 2048
    assert not [p for p in tmp_path.iterdir() if "tonalia-tmp" in p.name]


def test_patch_roundtrip_on_raw_bytes() -> None:
    original = b"HEAD" + b"x" * 100 + b"AUDIO" * 1000
    new = b"HEAD" + b"yy" * 80 + b"AUDIO" * 1000
    patch = make_patch(original, new)
    assert len(patch) < 400
    from tonalia_engine.tags.backup import apply_patch

    assert apply_patch(new, patch) == original
    with pytest.raises(UndoRefusedError):
        apply_patch(new + b"!", patch)


def test_planted_link_cannot_redirect_the_write(files: dict[str, Path], tmp_path: Path) -> None:
    """A link with the old predictable temporary name must not be followed."""
    path = files["mp3"]
    victim = tmp_path / "victim.txt"
    victim.write_text("keep me", encoding="utf-8")
    for name in (f".{path.stem}.tonalia-tmp{path.suffix}", f".{path.name}.tonalia-tmp"):
        try:
            path.with_name(name).symlink_to(victim)
        except OSError:  # Windows without the symlink privilege
            pytest.skip("cannot create symlinks here")
    outcome = write_tags(path, plan_changes(path, VALUES, options()))
    assert outcome is not None
    restore(path, outcome.patch)
    assert victim.read_text() == "keep me"
    assert read_metadata(path).title == "Midnight Bloom"
