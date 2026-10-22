from concurrent.futures import ThreadPoolExecutor

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


def test_memory_database_is_shared_across_threads():
    """内存库必须跨线程共用同一个。

    TestClient 在工作线程里发请求，fixture 在主线程里建表。
    两边不是同一个库的话，请求侧就会报「no such table」。
    """
    init_db()

    def count_scenes() -> int:
        with engine.connect() as conn:
            return conn.execute(text("SELECT count(*) FROM scenes")).scalar()

    with ThreadPoolExecutor(max_workers=1) as pool:
        assert pool.submit(count_scenes).result() == 0


def test_engine_knows_its_tables():
    """模型与迁移必须一致：两边都要有同样的表。"""
    from app import models  # noqa: F401  —— 注册模型到 Base.metadata
    from app.db import Base

    assert "scenes" in Base.metadata.tables
    assert "telemetry_events" in Base.metadata.tables


def test_upgrade_database_builds_a_fresh_database(tmp_path, monkeypatch):
    """一个空库跑完迁移就该有全部表——新环境起服务不能撞 500。"""
    from sqlalchemy import create_engine, inspect

    from app import migrate

    db_file = tmp_path / "fresh.db"
    monkeypatch.setattr(migrate.settings, "database_url", f"sqlite:///{db_file.as_posix()}")

    migrate.upgrade_database()

    engine = create_engine(f"sqlite:///{db_file.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    assert {"scenes", "telemetry_events"} <= tables
