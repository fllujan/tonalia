"""Entry point: JSON-RPC loop over stdio. Logs go to stderr only."""

import io
import logging
import os
import sys

from .rpc import Transport, serve
from .rpc_schema import EventParams
from .server import build_dispatcher


def main() -> None:
    # Force UTF-8 regardless of the platform locale (Windows defaults to cp1252).
    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="\n")
    logging.basicConfig(
        stream=sys.stderr,
        level=os.environ.get("TONALIA_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    transport = Transport(stdout)
    transport.notify("event", EventParams(type="ready", payload={}))
    serve(build_dispatcher(), transport, stdin)


if __name__ == "__main__":
    main()
