"""迁移与 ORM 模型必须一致。

计划里写死了这条约束：「迁移里不建 init_db() 建的任何别的东西——两者必须一致」。
这里用「跑一遍迁移，再和模型元数据对表」把它变成可执行的检查，
而不是靠人记着。
"""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401  —— 注册模型到 Base.metadata
from app.db import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _migrated_schema(db_path: Path) -> dict[str, set[str]]:
    """跑一遍 alembic upgrade head，返回「表名 -> 列名集合」。"""
    env = dict(os.environ)
    env["BACKEND_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    env["PYTHONUTF8"] = "1"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
    )
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        return {
            table: {column["name"] for column in inspector.get_columns(table)}
            for table in inspector.get_table_names()
        }
    finally:
        engine.dispose()


def _migrated_indexes(db_path: Path) -> set[str]:
    """跑一遍迁移，返回全部索引名。"""
    env = dict(os.environ)
    env["BACKEND_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    env["PYTHONUTF8"] = "1"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
    )
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        names: set[str] = set()
        for table in inspector.get_table_names():
            for index in inspector.get_indexes(table):
                names.add(index["name"])
        return names
    finally:
        engine.dispose()


def test_migration_matches_orm_models(tmp_path: Path):
    migrated = _migrated_schema(tmp_path / "migrated.db")
    modeled = {t.name: set(t.columns.keys()) for t in Base.metadata.tables.values()}
    # alembic_version 是 Alembic 自己的记账表，不对应任何模型
    migrated.pop("alembic_version", None)

    assert set(migrated) == set(modeled), "迁移建出来的表和模型对不上"
    for table, columns in modeled.items():
        assert migrated[table] == columns, f"{table} 的列对不上"


def test_migration_creates_every_modeled_index(tmp_path: Path):
    """索引也要一致：模型上声明的每个 index，迁移里都得建出来。"""
    migrated = _migrated_indexes(tmp_path / "indexed.db")
    modeled = {index.name for table in Base.metadata.tables.values() for index in table.indexes}

    assert modeled, "模型上一个索引都没有，这条检查就没有意义"
    assert modeled <= migrated, f"迁移漏建了索引：{sorted(modeled - migrated)}"
