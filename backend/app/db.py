from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。Alembic 也用它做 autogenerate 的元数据源。"""


def _is_memory_sqlite(url: str) -> bool:
    """判断是不是内存 SQLite。

    SQLAlchemy 把 `:memory:` 归一化成 database=None，所以只看这一项就够。
    """
    parsed = make_url(url)
    return parsed.get_backend_name() == "sqlite" and not parsed.database


def _prepare_sqlite_dir(url: str) -> None:
    """SQLite 的库文件所在目录必须先存在，否则连都连不上。"""
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return
    db_file = parsed.database
    if not db_file or db_file == ":memory:":
        return
    Path(db_file).parent.mkdir(parents=True, exist_ok=True)


def _engine_kwargs() -> dict[str, object]:
    """SQLite 与 Postgres 的连接参数不一样，分开处理。"""
    if settings.database_url.startswith("sqlite"):
        # TestClient 会跨线程用连接，SQLite 默认禁止
        kwargs: dict[str, object] = {"connect_args": {"check_same_thread": False}}
        if _is_memory_sqlite(settings.database_url):
            # 内存库默认每连接一个独立数据库，StaticPool 让所有连接共用同一个。
            # 这必须在建引擎时就指定：事后替换 engine.pool 会丢掉上面的连接参数。
            kwargs["poolclass"] = StaticPool
        return kwargs
    return {"pool_pre_ping": True}


_prepare_sqlite_dir(settings.database_url)

engine = create_engine(settings.database_url, **_engine_kwargs())

SessionLocal: sessionmaker[Session] = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def get_session() -> Iterator[Session]:
    """FastAPI 依赖：每个请求一个 session，结束必关。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    """直接建表。

    只用于开发与测试；生产用 `alembic upgrade head`。
    """
    from app import models  # noqa: F401  —— 注册模型到 Base.metadata

    Base.metadata.create_all(bind=engine)
