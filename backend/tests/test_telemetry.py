from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import TelemetryEvent
from app.services.telemetry_service import fingerprint_of


def test_accepts_batch_of_events(client: TestClient):
    response = client.post(
        "/api/telemetry",
        json={
            "events": [
                {
                    "kind": "error",
                    "path": "/simulation-lab",
                    "message": "boom",
                    "payload": {"n": 1},
                },
                {"kind": "event", "path": "/docs", "message": "clicked"},
            ]
        },
    )
    assert response.status_code == 202
    assert response.json()["accepted"] == 2


def test_rejects_oversized_batch(client: TestClient):
    events = [{"kind": "event", "path": "/x", "message": "m", "payload": {}} for _ in range(200)]
    response = client.post("/api/telemetry", json={"events": events})
    assert response.status_code == 413
    # 错误形状与其它端点一致，前端只需要认一种
    body = response.json()
    assert body["error"]["code"] == "telemetry_batch_too_large"


def test_rejects_empty_batch(client: TestClient):
    response = client.post("/api/telemetry", json={"events": []})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_rejects_unknown_kind(client: TestClient):
    response = client.post(
        "/api/telemetry",
        json={"events": [{"kind": "whatever", "path": "/x", "message": "m"}]},
    )
    assert response.status_code == 422


def test_fingerprint_is_derived(client: TestClient):
    payload = {
        "events": [
            {"kind": "error", "path": "/a", "message": "same", "payload": {}},
            {"kind": "error", "path": "/a", "message": "same", "payload": {}},
        ]
    }
    assert client.post("/api/telemetry", json=payload).json()["accepted"] == 2


def test_events_are_actually_stored(client: TestClient):
    """只回 202 不算数：得真的落库，遥测才有意义。"""
    client.post(
        "/api/telemetry",
        json={
            "events": [
                {
                    "kind": "error",
                    "path": "/scene-editor",
                    "message": "加载场景失败",
                    "payload": {},
                },
            ]
        },
    )

    with SessionLocal() as session:
        rows = session.scalars(select(TelemetryEvent)).all()

    assert len(rows) == 1
    row = rows[0]
    assert row.kind == "error"
    assert row.path == "/scene-editor"
    assert row.message == "加载场景失败"
    assert row.fingerprint


def test_same_event_gets_same_fingerprint(client: TestClient):
    """同一个错误反复出现，指纹必须一样——否则去重就没了。"""
    client.post(
        "/api/telemetry",
        json={
            "events": [
                {"kind": "error", "path": "/a", "message": "same", "payload": {}},
                {"kind": "error", "path": "/a", "message": "same", "payload": {}},
            ]
        },
    )

    with SessionLocal() as session:
        rows = session.scalars(select(TelemetryEvent)).all()

    assert len(rows) == 2
    assert rows[0].fingerprint == rows[1].fingerprint


def test_different_messages_get_different_fingerprints():
    from app.schemas import TelemetryEventIn

    a = TelemetryEventIn(kind="error", path="/a", message="one")
    b = TelemetryEventIn(kind="error", path="/a", message="two")
    assert fingerprint_of(a) != fingerprint_of(b)
