import json
import subprocess
import sys


def test_stdio_roundtrip_unicode() -> None:
    lines = [
        {"jsonrpc": "2.0", "id": 1, "method": "engine.ping"},
        {"jsonrpc": "2.0", "id": "ñ🎵", "method": "engine.version"},
    ]
    stdin = "\n".join(json.dumps(m, ensure_ascii=False) for m in lines) + "\n\n"
    proc = subprocess.run(
        [sys.executable, "-m", "tonalia_engine"],
        input=stdin.encode("utf-8"),
        capture_output=True,
        timeout=30,
        check=True,
    )
    out = [json.loads(line) for line in proc.stdout.decode("utf-8").splitlines()]
    # First line is the ready event, then one response per request.
    assert out[0] == {
        "jsonrpc": "2.0",
        "method": "event",
        "params": {"type": "ready", "payload": {}},
    }
    assert out[1]["result"] == {"pong": True}
    assert out[2]["id"] == "ñ🎵"
