"""Stable error codes (SPEC 11.4): every engine error reaches the app with ``data.reason``."""

import ast
import errno
import json
import pickle
import urllib.error
from pathlib import Path
from typing import get_args

import pytest

from tonalia_engine import errors
from tonalia_engine.errors import TonaliaError, classify
from tonalia_engine.rpc import INTERNAL_ERROR, INVALID_PARAMS, Dispatcher, RpcError
from tonalia_engine.rpc_schema import ErrorReason

PACKAGE = Path(errors.__file__).parent
REPO = PACKAGE.parent.parent


class _SampleError(TonaliaError):
    reason = "playlist_not_found"


def test_tonalia_error_carries_reason_and_params() -> None:
    exc = TonaliaError("cannot decode a.mp3: bad", reason="decode_failed", name="a.mp3")
    assert str(exc) == "cannot decode a.mp3: bad"
    info = classify(exc)
    assert info.reason == "decode_failed"
    assert info.params == {"name": "a.mp3"}


def test_subclass_default_reason_and_override() -> None:
    assert classify(_SampleError("unknown playlist 3")).reason == "playlist_not_found"
    assert classify(_SampleError("x", reason="name_empty")).reason == "name_empty"


def test_survives_pickling_across_processes() -> None:
    # Analysis runs in a process pool: the reason must come back with the exception.
    original = _SampleError("cannot read a.mp3", reason="read_failed", name="a")
    exc = pickle.loads(pickle.dumps(original))  # our own bytes, not untrusted data
    assert isinstance(exc, _SampleError)
    assert str(exc) == "cannot read a.mp3"
    assert classify(exc).model_dump() == {"reason": "read_failed", "params": {"name": "a"}}


@pytest.mark.parametrize(
    ("exc", "reason"),
    [
        (OSError(errno.ENOSPC, "No space left on device"), "disk_full"),
        (PermissionError(errno.EACCES, "Permission denied", "/x/a.mp3"), "permission_denied"),
        (OSError(errno.EROFS, "Read-only file system"), "permission_denied"),
        (FileNotFoundError(errno.ENOENT, "No such file", "/x/a.mp3"), "file_not_found"),
        (FileExistsError(errno.EEXIST, "File exists", "/x/a.wav"), "file_exists"),
        (urllib.error.URLError("dns"), "network"),
        (TimeoutError("timed out"), "network"),
        (ConnectionResetError(errno.ECONNRESET, "reset"), "network"),
        (OSError(errno.EIO, "I/O error"), "internal"),
        (ZeroDivisionError("bug"), "internal"),
    ],
)
def test_classifies_system_errors(exc: BaseException, reason: str) -> None:
    assert classify(exc).reason == reason


def test_file_errors_name_the_file() -> None:
    info = classify(FileNotFoundError(errno.ENOENT, "No such file", "/música/Mañana 🌅.mp3"))
    assert info.params == {"name": "Mañana 🌅.mp3"}


def _call(d: Dispatcher, method: str) -> dict[str, object]:
    line = d.handle_line(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method}))
    assert line is not None
    error = json.loads(line)["error"]
    assert isinstance(error, dict)
    return error


def test_dispatcher_sends_reason_and_detail() -> None:
    d = Dispatcher()

    def coded(_: object) -> None:
        raise TonaliaError("Traktor is open", reason="program_running", program="Traktor")

    def bug(_: object) -> None:
        raise ZeroDivisionError("division by zero")

    d.register("coded", coded)
    d.register("bug", bug)
    err = _call(d, "coded")
    assert err["message"] == "Traktor is open"
    assert err["data"] == {
        "reason": "program_running",
        "params": {"program": "Traktor"},
        "detail": "Traktor is open",
    }
    err = _call(d, "bug")
    assert err["code"] == INTERNAL_ERROR
    assert err["data"] == {
        "reason": "internal",
        "params": {},
        "detail": "internal error: division by zero",
    }
    err = _call(d, "nope")
    assert err["data"]["reason"] == "method_not_found"  # type: ignore[index]


def test_rpc_error_defaults_by_code_and_wraps() -> None:
    assert RpcError(INVALID_PARAMS, "bad").to_dict()["data"]["reason"] == "invalid_params"
    wrapped = RpcError.wrap(_SampleError("unknown playlist 9"))
    assert wrapped.code == INVALID_PARAMS
    assert wrapped.to_dict() == {
        "code": INVALID_PARAMS,
        "message": "unknown playlist 9",
        "data": {"reason": "playlist_not_found", "params": {}, "detail": "unknown playlist 9"},
    }


# Built-in exceptions the engine may raise without a code, and why that is fine.
ALLOWED_PLAIN = {
    # pydantic validators: they become ValidationError -> invalid_params.
    ("rpc_schema.py", "ValueError"),
    # Key parsing: callers turn it into invalid_params.
    ("keys.py", "ValueError"),
    # Corrupt cache file: callers recompute the waveform.
    ("analysis/waveform.py", "ValueError"),
    # Programming errors (they never depend on user input).
    ("rpc.py", "ValueError"),
    ("tags/service.py", "ValueError"),
    # Not found in the database: the server answers track_not_found.
    ("library.py", "KeyError"),
    ("cues.py", "KeyError"),
    ("energy_personal.py", "KeyError"),
    ("grid.py", "KeyError"),
    ("cue_review.py", "KeyError"),
}


def _exception_names(node: ast.Raise) -> str | None:
    exc = node.exc
    if isinstance(exc, ast.Call):
        exc = exc.func
    return exc.id if isinstance(exc, ast.Name) else None


def test_every_raise_has_a_code() -> None:
    import builtins

    plain: list[str] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        rel = path.relative_to(PACKAGE).as_posix()
        if rel.startswith("vendor/"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Raise) or node.exc is None:
                continue
            name = _exception_names(node)
            if name is None or not hasattr(builtins, name):
                continue  # re-raise of a variable, or one of our TonaliaError classes
            if (rel, name) not in ALLOWED_PLAIN:
                plain.append(f"{rel}:{node.lineno} raise {name}")
    assert plain == [], "raise a TonaliaError with a reason instead:\n" + "\n".join(plain)


def test_every_engine_error_class_has_a_code() -> None:
    import importlib

    missing = []
    for path in sorted(PACKAGE.rglob("*.py")):
        rel = path.relative_to(PACKAGE)
        if rel.parts[0] in ("vendor", "__main__.py"):
            continue
        module = importlib.import_module(
            "tonalia_engine." + ".".join(rel.with_suffix("").parts).removesuffix(".__init__")
        )
        for value in vars(module).values():
            if (
                isinstance(value, type)
                and issubclass(value, Exception)
                and value.__module__ == module.__name__
                and value.__name__.endswith("Error")
                and value is not RpcError
                and not issubclass(value, TonaliaError)
            ):
                missing.append(f"{module.__name__}.{value.__name__}")
    assert missing == []


def test_every_reason_is_translated_in_the_app() -> None:
    for lang in ("es", "en"):
        texts = json.loads((REPO / "app/src/i18n" / f"{lang}.json").read_text(encoding="utf-8"))
        reasons = texts["errors"]["reasons"]
        assert sorted(reasons) == sorted(get_args(ErrorReason)), lang
