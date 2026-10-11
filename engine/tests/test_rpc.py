import json
from typing import Any

import pytest

from tonalia_engine import __version__
from tonalia_engine.rpc import (
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    Dispatcher,
    RpcError,
)
from tonalia_engine.server import EngineContext, build_dispatcher


def call(d: Dispatcher, payload: Any) -> Any:
    out = d.handle_line(json.dumps(payload, ensure_ascii=False))
    return None if out is None else json.loads(out)


@pytest.fixture
def dispatcher(engine_ctx: EngineContext) -> Dispatcher:
    return build_dispatcher(engine_ctx)


def test_ping(dispatcher: Dispatcher) -> None:
    res = call(dispatcher, {"jsonrpc": "2.0", "id": 1, "method": "engine.ping"})
    assert res == {"jsonrpc": "2.0", "id": 1, "result": {"pong": True}}


def test_version(dispatcher: Dispatcher) -> None:
    res = call(dispatcher, {"jsonrpc": "2.0", "id": "a", "method": "engine.version"})
    assert res["result"]["version"] == __version__
    assert res["result"]["protocol"] == 1


def test_method_not_found(dispatcher: Dispatcher) -> None:
    res = call(dispatcher, {"jsonrpc": "2.0", "id": 2, "method": "nope"})
    assert res["error"]["code"] == METHOD_NOT_FOUND
    assert res["id"] == 2


def test_parse_error(dispatcher: Dispatcher) -> None:
    out = dispatcher.handle_line("{not json")
    assert out is not None
    res = json.loads(out)
    assert res["error"]["code"] == PARSE_ERROR
    assert res["id"] is None


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"id": 1, "method": "engine.ping"},
        {"jsonrpc": "1.0", "id": 1, "method": "engine.ping"},
        {"jsonrpc": "2.0", "id": 1, "method": 5},
        {"jsonrpc": "2.0", "id": 1, "method": "engine.ping", "params": "x"},
    ],
)
def test_invalid_request(dispatcher: Dispatcher, payload: Any) -> None:
    res = call(dispatcher, payload)
    assert res["error"]["code"] == INVALID_REQUEST


def test_notification_has_no_response(dispatcher: Dispatcher) -> None:
    assert call(dispatcher, {"jsonrpc": "2.0", "method": "engine.ping"}) is None


def test_handler_errors() -> None:
    d = Dispatcher()

    @d.method("boom")
    def boom(params: Any) -> Any:
        raise RuntimeError("kaboom")

    @d.method("bad")
    def bad(params: Any) -> Any:
        raise RpcError(INVALID_PARAMS, "missing field")

    @d.method("echo")
    def echo(params: Any) -> Any:
        return params

    assert call(d, {"jsonrpc": "2.0", "id": 1, "method": "boom"})["error"]["code"] == -32603
    err = call(d, {"jsonrpc": "2.0", "id": 1, "method": "bad"})["error"]
    assert err == {"code": INVALID_PARAMS, "message": "missing field"}
    text = "Canción de núcleo 🎧 — Ñandú"
    res = call(d, {"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"t": text}})
    assert res["result"] == {"t": text}


def test_duplicate_method_rejected() -> None:
    d = Dispatcher()
    d.register("x", lambda p: None)
    with pytest.raises(ValueError):
        d.register("x", lambda p: None)
