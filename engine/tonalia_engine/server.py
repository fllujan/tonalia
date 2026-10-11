"""Engine method registry."""

import platform

from . import PROTOCOL_VERSION, __version__
from .rpc import Dispatcher, Params
from .rpc_schema import PingResult, VersionResult


def build_dispatcher() -> Dispatcher:
    d = Dispatcher()

    @d.method("engine.ping")
    def ping(_: Params) -> PingResult:
        return PingResult(pong=True)

    @d.method("engine.version")
    def version(_: Params) -> VersionResult:
        return VersionResult(
            version=__version__, protocol=PROTOCOL_VERSION, python=platform.python_version()
        )

    return d
