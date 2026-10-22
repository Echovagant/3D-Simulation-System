from sqlalchemy import text

from app.db import SessionLocal, engine, init_db


def test_init_db_creates_tables():
    init_db()
    with engine.connect() as conn:
        tables = (
            conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).scalars().all()
        )
    assert "scenes" in tables
    assert "telemetry_events" in tables


def test_session_factory_returns_working_session():
    init_db()
    with SessionLocal() as session:
        assert session.execute(text("SELECT 1")).scalar() == 1


def test_engine_knows_its_tables():
    """模型与迁移必须一致：两边都要有同样的表。"""
    from app import models  # noqa: F401  —— 注册模型到 Base.metadata
    from app.db import Base

    assert "scenes" in Base.metadata.tables
    assert "telemetry_events" in Base.metadata.tables
