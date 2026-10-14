"""Entry point: JSON-RPC loop over stdio. Logs go to stderr only."""

import io
import logging
import multiprocessing
import os
import sys
from pathlib import Path

from . import gpu_runtime
from .paths import data_dir
from .rpc import Transport, serve
from .rpc_schema import EventParams
from .server import EngineContext, build_dispatcher


def main() -> None:
    # Analysis workers are spawned processes; in the frozen (PyInstaller) engine they
    # re-launch this executable, and freeze_support() routes them to the worker code.
    multiprocessing.freeze_support()
    # Child process that checks the downloaded CUDA runtime (gpu_runtime.probe).
    if len(sys.argv) == 3 and sys.argv[1] == gpu_runtime.PROBE_FLAG:
        sys.exit(gpu_runtime.run_probe(Path(sys.argv[2])))
    # Force UTF-8 regardless of the platform locale (Windows defaults to cp1252).
    # Reconfigure in place (no second wrapper over the same buffers, which would close
    # the descriptors twice at exit).
    stdin, stdout = sys.stdin, sys.stdout
    if isinstance(stdin, io.TextIOWrapper):
        stdin.reconfigure(encoding="utf-8", errors="replace")
    if isinstance(stdout, io.TextIOWrapper):
        stdout.reconfigure(encoding="utf-8", newline="\n")
    logging.basicConfig(
        stream=sys.stderr,
        level=os.environ.get("TONALIA_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    transport = Transport(stdout)
    # Before anything can import torch: the optional CUDA build replaces the bundled one.
    try:
        gpu_runtime.activate(data_dir())
    except OSError:
        logging.getLogger(__name__).exception("stems: could not check the CUDA runtime")
    ctx = EngineContext(data_dir(), transport)
    try:
        transport.notify("event", EventParams(type="ready", payload={}))
        serve(build_dispatcher(ctx), transport, stdin)
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
