import base64
import struct
import zlib
from pathlib import Path

import pytest
from mutagen.aiff import AIFF
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, ID3, TALB, TBPM, TCON, TDRC, TIT2, TKEY, TPE1, TPUB
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover, MP4FreeForm
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE

from tests.fixtures.generate import make_all
from tonalia_engine.metadata import (
    Artwork,
    MetadataError,
    parse_year,
    read_metadata,
    save_artwork,
)

TITLE = "Canción del Alba 🌅"
ARTIST = "Lumen Drift & Ñandú"
ALBUM = "Noches de Lisboa"
GENRE = "Melodic House"
LABEL = "Sello Aurora"
COMMENT = "Para el cierre — energía alta"


def tiny_png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00\x7c\x6c\xff")
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")
    )


PNG = tiny_png()


def tag_id3(tags: ID3) -> None:
    tags.add(TIT2(encoding=3, text=TITLE))
    tags.add(TPE1(encoding=3, text=ARTIST))
    tags.add(TALB(encoding=3, text=ALBUM))
    tags.add(TCON(encoding=3, text=GENRE))
    tags.add(TDRC(encoding=3, text="2024-05-01"))
    tags.add(TPUB(encoding=3, text=LABEL))
    tags.add(COMM(encoding=3, lang="eng", desc="iTunNORM", text="0000"))
    tags.add(COMM(encoding=3, lang="spa", desc="", text=COMMENT))
    tags.add(TKEY(encoding=3, text="Am"))
    tags.add(TBPM(encoding=3, text="124"))
    tags.add(APIC(encoding=3, mime="image/png", type=3, desc="cover", data=PNG))


def tag_vorbis(audio: FLAC | OggVorbis) -> None:
    audio["title"] = TITLE
    audio["artist"] = ARTIST
    audio["album"] = ALBUM
    audio["genre"] = GENRE
    audio["date"] = "2024"
    audio["organization"] = LABEL
    audio["comment"] = COMMENT
    audio["initialkey"] = "Am"
    audio["bpm"] = "124"
    pic = Picture()
    pic.type, pic.mime, pic.data = 3, "image/png", PNG
    if isinstance(audio, FLAC):
        audio.add_picture(pic)
    else:
        audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]


def tag_mp4(audio: MP4) -> None:
    audio["\xa9nam"] = TITLE
    audio["\xa9ART"] = ARTIST
    audio["\xa9alb"] = ALBUM
    audio["\xa9gen"] = GENRE
    audio["\xa9day"] = "2024"
    audio["\xa9cmt"] = COMMENT
    audio["----:com.apple.iTunes:LABEL"] = [MP4FreeForm(LABEL.encode())]
    audio["----:com.apple.iTunes:initialkey"] = [MP4FreeForm(b"Am")]
    audio["tmpo"] = [124]
    audio["covr"] = [MP4Cover(PNG, imageformat=MP4Cover.FORMAT_PNG)]


@pytest.fixture(scope="module")
def tagged(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    files = make_all(tmp_path_factory.mktemp("Etiquetas ñ 🎧"))
    for fmt, path in files.items():
        if fmt == "mp3":
            mp3 = MP3(path)
            if mp3.tags is None:
                mp3.add_tags()
            assert mp3.tags is not None
            tag_id3(mp3.tags)
            mp3.save()
        elif fmt in ("wav", "aiff"):
            audio = WAVE(path) if fmt == "wav" else AIFF(path)
            if audio.tags is None:
                audio.add_tags()
            assert audio.tags is not None
            tag_id3(audio.tags)
            audio.save()
        elif fmt == "flac":
            flac = FLAC(path)
            tag_vorbis(flac)
            flac.save()
        elif fmt == "ogg":
            ogg = OggVorbis(path)
            tag_vorbis(ogg)
            ogg.save()
        else:
            mp4 = MP4(path)
            tag_mp4(mp4)
            mp4.save()
    return files


EXPECTED_FORMAT = {
    "wav": "wav",
    "aiff": "aiff",
    "flac": "flac",
    "mp3": "mp3",
    "m4a": "m4a",
    "alac.m4a": "alac",
    "ogg": "ogg",
}


@pytest.mark.parametrize("fmt", list(EXPECTED_FORMAT))
def test_reads_tags_from_every_format(tagged: dict[str, Path], fmt: str) -> None:
    meta = read_metadata(tagged[fmt])
    assert meta.format == EXPECTED_FORMAT[fmt]
    assert meta.title == TITLE
    assert meta.artist == ARTIST
    assert meta.album == ALBUM
    assert meta.genre == GENRE
    assert meta.year == 2024
    assert meta.label == LABEL
    assert meta.comment == COMMENT
    assert meta.key_tag == "Am"
    assert meta.bpm_tag == "124"
    assert meta.duration == pytest.approx(2.0, abs=0.1)
    assert meta.sample_rate == 44100
    assert meta.bitrate and meta.bitrate > 0
    assert meta.artwork is not None
    assert meta.artwork.data == PNG
    assert meta.artwork.mime == "image/png"


def test_untagged_file_has_stream_info_only(tmp_path: Path) -> None:
    files = make_all(tmp_path)
    meta = read_metadata(files["flac"])
    assert meta.title is None and meta.artwork is None
    assert meta.duration == pytest.approx(2.0, abs=0.05)


def test_unreadable_file_raises(tmp_path: Path) -> None:
    junk = tmp_path / "basura 🗑.mp3"
    junk.write_bytes(b"\x00" * 10)
    with pytest.raises(MetadataError):
        read_metadata(junk)


@pytest.mark.parametrize(
    ("text", "year"),
    [("2024", 2024), ("2024-05-01", 2024), ("05/01/1999", 1999), ("n/a", None), (None, None)],
)
def test_parse_year(text: str | None, year: int | None) -> None:
    assert parse_year(text) == year


def test_save_artwork_deduplicates(tmp_path: Path) -> None:
    cache = tmp_path / "Carátulas"
    a = save_artwork(Artwork(PNG, "image/png"), cache)
    b = save_artwork(Artwork(PNG, "image/png"), cache)
    assert a == b and a.suffix == ".png" and a.read_bytes() == PNG
    c = save_artwork(Artwork(b"\xff\xd8jpeg", "image/jpeg"), cache)
    assert c.suffix == ".jpg" and c != a
