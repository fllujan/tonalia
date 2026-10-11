"""Minimal JSON-RPC 2.0 over newline-delimited JSON."""

import json
import logging
import sys
import threading
from collections.abc import Callable
from typing import IO, Any

from pydantic import BaseModel

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

Params = dict[str, Any] | list[Any] | None
Handler = Callable[[Params], Any]

log = logging.getLogger(__name__)


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            err["data"] = self.data
        return err


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    return value


class Dispatcher:
    def __init__(self) -> None:
        self._methods: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        if name in self._methods:
            raise ValueError(f"method already registered: {name}")
        self._methods[name] = handler

    def method(self, name: str) -> Callable[[Handler], Handler]:
        def deco(fn: Handler) -> Handler:
            self.register(name, fn)
            return fn

        return deco

    def handle_line(self, line: str) -> str | None:
        """Process one request line; return the response line or None for notifications."""
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            return _dumps(self._error(None, RpcError(PARSE_ERROR, f"parse error: {exc.msg}")))
        response = self.handle(msg)
        return None if response is None else _dumps(response)

    def handle(self, msg: Any) -> dict[str, Any] | None:
        req_id = msg.get("id") if isinstance(msg, dict) else None
        if (
            not isinstance(msg, dict)
            or msg.get("jsonrpc") != "2.0"
            or not isinstance(msg.get("method"), str)
            or not isinstance(msg.get("params", None), dict | list | None)
            or not isinstance(req_id, str | int | None)
        ):
            return self._error(req_id, RpcError(INVALID_REQUEST, "invalid request"))

        is_notification = "id" not in msg
        handler = self._methods.get(msg["method"])
        try:
            if handler is None:
                raise RpcError(METHOD_NOT_FOUND, f"method not found: {msg['method']}")
            result = _to_jsonable(handler(msg.get("params")))
        except RpcError as exc:
            return None if is_notification else self._error(req_id, exc)
        except Exception as exc:
            log.exception("handler %s failed", msg["method"])
            err = RpcError(INTERNAL_ERROR, f"internal error: {exc}")
            return None if is_notification else self._error(req_id, err)
        if is_notification:
            return None
        return {"jsonrpc": "2.0", "id": req_id, "result": result}

    @staticmethod
    def _error(req_id: Any, err: RpcError) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": req_id, "error": err.to_dict()}


class Transport:
    """Thread-safe line writer for responses and notifications."""

    def __init__(self, out: IO[str]) -> None:
        self._out = out
        self._lock = threading.Lock()

    def write_line(self, line: str) -> None:
        with self._lock:
            self._out.write(line + "\n")
            self._out.flush()

    def notify(self, method: str, params: Any) -> None:
        self.write_line(
            _dumps({"jsonrpc": "2.0", "method": method, "params": _to_jsonable(params)})
        )


def serve(dispatcher: Dispatcher, transport: Transport, inp: IO[str] = sys.stdin) -> None:
    for raw in inp:
        line = raw.strip()
        if not line:
            continue
        out = dispatcher.handle_line(line)
        if out is not None:
            transport.write_line(out)
