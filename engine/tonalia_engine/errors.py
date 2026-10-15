"""Stable error codes (SPEC 11.4).

Every error the engine reports carries a reason from ``rpc_schema.ErrorReason``: the app
translates by it, and the English message is only the technical detail. Engine errors
subclass ``TonaliaError`` (with a default reason per class, or one per ``raise``); system
errors are classified by type and errno; anything else is ``internal``.
"""

import errno
import socket
import urllib.error
from pathlib import PurePath, PureWindowsPath
from typing import Any

from pydantic import ValidationError

from .rpc_schema import ErrorInfo, ErrorReason


class TonaliaError(Exception):
    """An engine error with a stable code. ``params`` fill the app's sentence (a file name,
    a program), so they must never be needed to understand the technical message."""

    reason: ErrorReason = "internal"

    def __init__(self, message: str, *, reason: ErrorReason | None = None, **params: Any) -> None:
        super().__init__(message)
        if reason is not None:
            self.reason = reason
        self.params = {key: str(value) for key, value in params.items()}

    # Analysis runs in worker processes: keep the reason when the exception is pickled back.
    def __reduce__(self) -> tuple[Any, ...]:
        return (_rebuild, (type(self), str(self), self.reason, self.params))


class CollectionNotFoundError(TonaliaError, FileNotFoundError):
    """Another program's collection is not where it should be (``program`` names it)."""

    reason = "collection_not_found"


def _rebuild(
    cls: type[TonaliaError], message: str, reason: ErrorReason, params: dict[str, str]
) -> TonaliaError:
    exc = cls.__new__(cls)
    Exception.__init__(exc, message)
    exc.reason = reason
    exc.params = params
    return exc


def file_name(path: str | PurePath) -> str:
    """The last part of a path from either system (for the app's sentences)."""
    return PureWindowsPath(str(path)).name


_NETWORK = (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError)
_NO_ACCESS = {errno.EACCES, errno.EPERM, errno.EROFS}
_NO_SPACE = {errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)}


def classify(exc: BaseException) -> ErrorInfo:
    """The stable code (and its sentence's values) of any exception."""
    if isinstance(exc, TonaliaError):
        return ErrorInfo(reason=exc.reason, params=exc.params)
    if isinstance(exc, ValidationError):
        return ErrorInfo(reason="invalid_params")
    if isinstance(exc, _NETWORK):
        return ErrorInfo(reason="network")
    if isinstance(exc, OSError):
        params = {"name": file_name(exc.filename)} if exc.filename else {}
        if exc.errno in _NO_SPACE:
            return ErrorInfo(reason="disk_full")
        if isinstance(exc, PermissionError) or exc.errno in _NO_ACCESS:
            return ErrorInfo(reason="permission_denied", params=params)
        if isinstance(exc, FileNotFoundError):
            return ErrorInfo(reason="file_not_found", params=params)
        if isinstance(exc, FileExistsError):
            return ErrorInfo(reason="file_exists", params=params)
    return ErrorInfo(reason="internal")
