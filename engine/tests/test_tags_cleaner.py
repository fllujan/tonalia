"""Tag cleaning rules (SPEC 2.10): pure text transformations."""

import pytest

from tonalia_engine.rpc_schema import CleanRules
from tonalia_engine.tags.cleaner import clean_fields, title_case

ALL_OFF = {
    "removeUrls": False,
    "removePromo": False,
    "removeTrackNumbers": False,
    "removeOriginalMix": False,
    "collapseSpaces": False,
    "fixCaps": False,
    "normalizeFeat": False,
    "unifySeparators": False,
}


def rules(**on: object) -> CleanRules:
    return CleanRules.model_validate({**ALL_OFF, **on})


def clean(fields: dict[str, str | None], **on: object) -> dict[str, str]:
    return clean_fields(fields, rules(**on))


def test_urls_and_domains_are_removed() -> None:
    out = clean(
        {
            "title": "Midnight Bloom [www.promo-site.com]",
            "comment": "Get it at https://example.net/x now",
        },
        removeUrls=True,
        collapseSpaces=True,
    )
    assert out == {"title": "Midnight Bloom", "comment": "Get it at now"}


def test_promo_phrases_from_an_editable_list() -> None:
    out = clean(
        {"title": "Neon Cathedral (Free Download)", "comment": "PROMO ONLY - Exclusive"},
        removePromo=True,
        collapseSpaces=True,
    )
    assert out == {"title": "Neon Cathedral", "comment": ""}
    custom = clean(
        {"title": "Velvet Static [Radio Premiere]"},
        removePromo=True,
        promoPhrases=["Radio Premiere"],
    )
    assert custom == {"title": "Velvet Static"}


@pytest.mark.parametrize(
    "raw",
    ["01 - Golden Hour Tide", "01. Golden Hour Tide", "1) Golden Hour Tide", "A2 Golden Hour Tide"],
)
def test_track_numbers_in_the_title(raw: str) -> None:
    assert clean({"title": raw}, removeTrackNumbers=True) == {"title": "Golden Hour Tide"}


def test_numbers_that_belong_to_the_title_stay() -> None:
    assert clean({"title": "1999"}, removeTrackNumbers=True) == {}
    assert clean({"title": "2 Unlimited Love"}, removeTrackNumbers=True) == {}


def test_original_mix_is_optional() -> None:
    assert clean({"title": "Sunset Engine (Original Mix)"}, removeOriginalMix=True) == {
        "title": "Sunset Engine"
    }
    assert clean({"title": "Sunset Engine - Original Mix"}, removeOriginalMix=True) == {
        "title": "Sunset Engine"
    }
    assert clean({"title": "Sunset Engine (Extended Mix)"}, removeOriginalMix=True) == {}


def test_spaces_and_caps() -> None:
    out = clean(
        {"title": "HEATWAVE  PROTOCOL", "artist": "duo ARCADIA"}, collapseSpaces=True, fixCaps=True
    )
    # Only fields entirely in capitals are recased.
    assert out == {"title": "Heatwave Protocol"}
    assert title_case("DON'T STOP (VIP MIX) - PART II") == "Don't Stop (Vip Mix) - Part Ii"


def test_feat_is_normalized_and_moved_to_the_title() -> None:
    out = clean(
        {"title": "Run The Signal", "artist": "Nova Reign ft Mara Ion"},
        normalizeFeat=True,
        featPosition="title",
    )
    assert out == {"title": "Run The Signal (feat. Mara Ion)", "artist": "Nova Reign"}


def test_feat_moved_to_the_artist() -> None:
    out = clean(
        {"title": "Run The Signal (Featuring Mara Ion)", "artist": "Nova Reign"},
        normalizeFeat=True,
        featPosition="artist",
    )
    assert out == {"title": "Run The Signal", "artist": "Nova Reign feat. Mara Ion"}


def test_feat_kept_in_place_is_only_normalized() -> None:
    out = clean({"title": "Song FT. Guest"}, normalizeFeat=True, featPosition="keep")
    assert out == {"title": "Song feat. Guest"}


def test_artist_separators_are_unified() -> None:
    out = clean(
        {"artist": "Lumen Drift & Sora Vela / Kairo; Amaro"},
        unifySeparators=True,
        artistSeparator=", ",
    )
    assert out == {"artist": "Lumen Drift, Sora Vela, Kairo, Amaro"}


def test_default_rules_on_a_messy_tag() -> None:
    out = clean_fields(
        {
            "title": "02 - MIDNIGHT  BLOOM (Original Mix) [FREE DOWNLOAD]",
            "artist": "Lumen Drift Feat. Ines Halo",
            "comment": "www.promo.com",
        },
        CleanRules(),
    )
    assert out["title"] == "Midnight Bloom (Original Mix) (feat. Ines Halo)"
    assert out["artist"] == "Lumen Drift"
    assert out["comment"] == ""


def test_unchanged_fields_are_not_reported() -> None:
    assert (
        clean_fields({"title": "Cobalt Rain", "artist": "Eli Marsh", "album": None}, CleanRules())
        == {}
    )
