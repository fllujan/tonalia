from pathlib import Path

from tonalia_engine.paths import APP_ID, data_dir, database_path


def test_override_wins() -> None:
    env = {"TONALIA_DATA_DIR": "/tmp/Música 🎧", "HOME": "/Users/dj"}
    assert data_dir(env, "darwin") == Path("/tmp/Música 🎧")
    assert database_path(env) == Path("/tmp/Música 🎧/tonalia.db")


def test_platform_defaults() -> None:
    assert data_dir({"HOME": "/Users/dj"}, "darwin") == Path(
        "/Users/dj/Library/Application Support", APP_ID
    )
    assert data_dir({"APPDATA": "C:/Users/dj/AppData/Roaming"}, "win32") == Path(
        "C:/Users/dj/AppData/Roaming", APP_ID
    )
    assert data_dir({"HOME": "/home/dj"}, "linux") == Path("/home/dj/.local/share", APP_ID)
