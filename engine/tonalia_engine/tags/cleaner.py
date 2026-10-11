"""Tag cleaning rules (SPEC 2.10). Pure text in, text out; writing goes through the same
safe path as tag writing (preview, verified copy, exact undo).

Rules run in a fixed order on title, artist, album and comment: URLs, promotional
phrases, track numbers (title), "(Original Mix)" (title), feat. normalisation and
moving the guest artist, artist separators, ALL CAPS -> Title Case, then spaces and
leftover punctuation.
"""

from __future__ import annotations

import re

from ..rpc_schema import CleanRules

TEXT_FIELDS = ("title", "artist", "album", "comment")

_URL = re.compile(
    r"(?:https?://[^\s()\[\]]+|www\.[^\s()\[\]]+"
    r"|\b[\w-]+\.(?:com|net|org|io|co|fm|me|info|biz|ru|de|es|uk|tv|xyz|dj)\b(?:/[^\s()\[\]]*)?)",
    re.IGNORECASE,
)
# "01 - ", "1. ", "1) ", "01 Title", vinyl sides "A2 Title"; a lone "2 Title" stays (it
# may be part of the name, e.g. "2 Unlimited").
_TRACK_NUMBER = re.compile(r"^\s*(?:\d{1,3}\s*[-.)_:]\s*|\d{2,3}\s+(?=\D)|[A-D]\d{1,2}\s+(?=\D))")
_ORIGINAL_MIX = re.compile(
    r"\s*(?:\(\s*original mix\s*\)|\[\s*original mix\s*\]|-\s*original mix\s*$)", re.I
)
_FEAT_WORD = re.compile(r"\b(?:featuring|feat\.?|ft\.?)(?=\s)", re.IGNORECASE)
_FEAT_IN_TITLE = re.compile(r"\s*[(\[]\s*feat\.\s+([^)\]]+)[)\]]|\s+feat\.\s+(.+)$")
_FEAT_IN_ARTIST = re.compile(r"\s+feat\.\s+(.+)$")
_SEPARATORS = re.compile(r"\s*(?:,|&|;|/)\s*")
_EMPTY_BRACKETS = re.compile(r"\(\s*\)|\[\s*\]|\{\s*\}")
_EDGE_PUNCT = re.compile(r"^[\s\-|·:,]+|[\s\-|·:,]+$")


def title_case(text: str) -> str:
    """Capitalise each word (after spaces, hyphens and brackets) without breaking
    apostrophes the way ``str.title`` does ("Don't", not "Don'T")."""
    out = []
    capitalise = True
    for ch in text.lower():
        out.append(ch.upper() if capitalise and ch.isalpha() else ch)
        if ch.isalpha() or ch == "'":
            capitalise = False
        elif ch in " -([{/\t":
            capitalise = True
    return "".join(out)


def _tidy(text: str) -> str:
    previous = None
    while previous != text:
        previous = text
        text = _EMPTY_BRACKETS.sub("", text)
        text = re.sub(r"\s+", " ", text)
        text = _EDGE_PUNCT.sub("", text)
    return text


def _remove_phrases(text: str, phrases: list[str]) -> str:
    for phrase in sorted((p for p in phrases if p.strip()), key=len, reverse=True):
        text = re.sub(rf"(?<!\w){re.escape(phrase.strip())}(?!\w)", "", text, flags=re.IGNORECASE)
    return text


def _is_all_caps(text: str) -> bool:
    """True when the main part (before brackets or " - ") is written in capitals."""
    main = re.split(r"[(\[]| - ", text, maxsplit=1)[0]
    letters = [c for c in main if c.isalpha()]
    return len(letters) >= 2 and all(c.isupper() for c in letters)


def clean_fields(fields: dict[str, str | None], rules: CleanRules) -> dict[str, str]:
    """New values of the fields a cleaning would change (unchanged fields are omitted)."""
    values = {f: fields.get(f) or "" for f in TEXT_FIELDS}
    original = dict(values)

    for f in TEXT_FIELDS:
        text = values[f]
        if rules.remove_urls:
            text = _URL.sub("", text)
        if rules.remove_promo:
            text = _remove_phrases(text, rules.promo_phrases)
        if f == "title" and rules.remove_track_numbers:
            stripped = _TRACK_NUMBER.sub("", text, count=1)
            text = stripped if stripped.strip() else text
        if f == "title" and rules.remove_original_mix:
            text = _ORIGINAL_MIX.sub("", text)
        if f in ("title", "artist", "album") and rules.fix_caps and _is_all_caps(text):
            text = title_case(text)
        if f in ("title", "artist") and rules.normalize_feat:
            text = _FEAT_WORD.sub("feat.", text)
        values[f] = text

    if rules.normalize_feat and rules.feat_position != "keep":
        title, artist = values["title"], values["artist"]
        if rules.feat_position == "title":
            match = _FEAT_IN_ARTIST.search(artist)
            if match and "feat." not in title:
                values["artist"] = artist[: match.start()]
                values["title"] = f"{_tidy(title)} (feat. {match.group(1).strip()})"
        else:
            match = _FEAT_IN_TITLE.search(title)
            if match and "feat." not in artist:
                guest = (match.group(1) or match.group(2) or "").strip()
                values["title"] = title[: match.start()] + title[match.end() :]
                values["artist"] = f"{_tidy(artist)} feat. {guest}"

    if rules.unify_separators:
        artist = values["artist"]
        main, feat, guest = artist.partition(" feat. ")
        parts = [p for p in _SEPARATORS.split(main) if p.strip()]
        values["artist"] = rules.artist_separator.join(parts) + (f"{feat}{guest}" if feat else "")

    for f in TEXT_FIELDS:
        if rules.collapse_spaces or values[f] != original[f]:
            values[f] = _tidy(values[f])

    return {f: v for f, v in values.items() if v != original[f]}
