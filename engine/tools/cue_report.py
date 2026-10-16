"""The cue review report for ``docs/accuracy.md`` (SPEC 12.5).

Reads the verdicts given in "Revisar cues" from the app's database and prints (or, with
``--write``, stores in ``docs/accuracy.md``) the share of automatic cues that mark a real
section change and the failures by section type. No titles or paths are written.

    uv run python -m tools.cue_report              # print the Markdown section
    uv run python -m tools.cue_report --write      # update docs/accuracy.md
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import Any

from tonalia_engine.cue_review import report
from tonalia_engine.db import Database
from tonalia_engine.paths import database_path

from .evaluation import ROOT

ACCURACY = ROOT / "docs" / "accuracy.md"
START = "<!-- cue-review:start -->"
END = "<!-- cue-review:end -->"
TARGET = 0.8  # SPEC phase 3 and 12: at least 80 % of the cues mark real section changes
NAMES = {
    "intro": "Intro",
    "build": "Build",
    "drop": "Drop",
    "breakdown": "Breakdown",
    "build2": "Build 2",
    "drop2": "Drop 2",
    "verse": "Verse",
    "outro": "Outro",
}


def _pct(value: float) -> str:
    return f"{round(100 * value)} %"


def render_markdown(data: dict[str, Any], day: str) -> str:
    """The report as a Markdown section (counts and labels only)."""
    accuracy = data.get("accuracy")
    head = (
        f"### Cues automáticos — revisión manual ({day}, `analysis_version` "
        f"{data.get('analysisVersion')})\n\n"
    )
    if accuracy is None:
        return head + "Aún no hay cues revisados con «Revisar cues».\n"
    verdict = "alcanzado" if accuracy >= TARGET else "no alcanzado"
    lines = [
        head,
        f"{data['reviewedCues']} cues revisados en {data['tracks']} temas: "
        f"**{_pct(accuracy)} correctos** (objetivo ≥ {_pct(TARGET)}: {verdict}); "
        f"{data['missing']} cues que faltaban.\n",
        "| Sección | Revisados | Mal colocados | Faltaban |",
        "|---|---|---|---|",
    ]
    for row in data["bySection"]:
        name = NAMES.get(row["label"], row["label"].capitalize())
        lines.append(f"| {name} | {row['reviewed']} | {row['wrong']} | {row['missing']} |")
    return "\n".join(lines) + "\n"


def write_section(markdown: str, path: Path = ACCURACY) -> None:
    text = path.read_text(encoding="utf-8")
    block = f"{START}\n{markdown}{END}"
    if START in text and END in text:
        before, rest = text.split(START, 1)
        text = before + block + rest.split(END, 1)[1]
    else:
        anchor = "\n## Qué cambió y por qué"
        text = text.replace(anchor, f"\n{block}\n{anchor}", 1) if anchor in text else text + block
    path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", type=Path, default=database_path())
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if not args.db.is_file():
        sys.exit(f"no database at {args.db}")
    db = Database.open(args.db)
    try:
        data = report(db).model_dump(by_alias=True)
    finally:
        db.close()
    markdown = render_markdown(data, date.today().isoformat())
    print(markdown)
    if args.write:
        write_section(markdown)
        print(f"written to {ACCURACY}")


if __name__ == "__main__":
    main()
