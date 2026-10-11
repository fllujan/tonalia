"""Shared JSON-RPC types.

This module is the single source of truth for the engine <-> app contract.
After changing it, regenerate ``app/src/lib/rpc.types.ts`` with ``scripts/gen-types``.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict


class RpcModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PingResult(RpcModel):
    pong: bool


class VersionResult(RpcModel):
    version: str
    protocol: int
    python: str


class ProgressParams(RpcModel):
    jobId: str  # noqa: N815 - wire format is camelCase
    trackId: int | None = None  # noqa: N815
    stage: str
    percent: float


class EventParams(RpcModel):
    type: str
    payload: dict[str, Any]


# Method name -> (params model or None, result model). Used by scripts/gen-types.
METHODS: dict[str, tuple[type[RpcModel] | None, type[RpcModel]]] = {
    "engine.ping": (None, PingResult),
    "engine.version": (None, VersionResult),
}

# Notification name -> params model.
NOTIFICATIONS: dict[str, type[RpcModel]] = {
    "progress": ProgressParams,
    "event": EventParams,
}
