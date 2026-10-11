from tonalia_engine.rpc_schema import EVENTS, METHODS, NOTIFICATIONS
from tonalia_engine.schema_export import export


def test_export_covers_every_method_and_notification() -> None:
    data = export()
    assert set(data["methods"]) == set(METHODS)
    assert set(data["notifications"]) == set(NOTIFICATIONS)
    assert set(data["events"]) == set(EVENTS)
    defs = data["$defs"]
    for entry in data["methods"].values():
        assert entry["result"] in defs
        assert entry["params"] is None or entry["params"] in defs
    for model in data["notifications"].values():
        assert model in defs


def test_models_are_closed_and_camel_case_preserved() -> None:
    defs = export()["$defs"]
    assert defs["PingResult"]["additionalProperties"] is False
    props = defs["ProgressParams"]["properties"]
    assert {"jobId", "trackId", "stage", "percent"} <= set(props)
    assert "trackId" not in defs["ProgressParams"]["required"]
    assert {"jobId", "kind", "status"} <= set(defs["JobFinished"]["properties"])
    assert "AddPathsResult" in defs
