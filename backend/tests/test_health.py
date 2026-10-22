from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_ok():
    client = TestClient(create_app())
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_version():
    client = TestClient(create_app())
    body = client.get("/api/health").json()
    assert body["version"] == "0.1.0"
