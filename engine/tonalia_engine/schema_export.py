"""Export the RPC contract as JSON (consumed by ``scripts/gen-types``).

Output shape::

    {"$defs": {...model schemas...},
     "methods": {"engine.ping": {"params": null, "result": "PingResult"}, ...},
     "notifications": {"progress": "ProgressParams", ...},
     "events": {"job.finished": "JobFinished", ...}}
"""

import json
import sys
from typing import Any

from pydantic.json_schema import models_json_schema

from .rpc_schema import EVENTS, METHODS, NOTIFICATIONS, RpcModel


def export() -> dict[str, Any]:
    models: list[type[RpcModel]] = []
    for params, result in METHODS.values():
        models.extend(m for m in (params, result) if m is not None)
    models.extend(NOTIFICATIONS.values())
    models.extend(EVENTS.values())
    unique = list(dict.fromkeys(models))
    _, schema = models_json_schema(
        [(m, "validation") for m in unique], ref_template="#/$defs/{model}"
    )
    return {
        "$defs": schema.get("$defs", {}),
        "methods": {
            name: {"params": p.__name__ if p else None, "result": r.__name__}
            for name, (p, r) in sorted(METHODS.items())
        },
        "notifications": {name: m.__name__ for name, m in sorted(NOTIFICATIONS.items())},
        "events": {name: m.__name__ for name, m in sorted(EVENTS.items())},
    }


def main() -> None:
    json.dump(export(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
