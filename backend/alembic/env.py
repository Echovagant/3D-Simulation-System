"""Alembic 迁移环境。

数据库地址不写在 alembic.ini 里，统一从 ``BACKEND_DATABASE_URL`` 覆盖进来，
保证迁移、应用、测试三方连的是同一个库。
"""

from sqlalchemy import engine_from_config, pool

from alembic import context
from app import models  # noqa: F401 —— import 是为了让所有表注册进 Base.metadata
from app.config import settings
from app.db import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式（``alembic upgrade --sql``）：不连库，只输出 SQL 文本。"""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：自己开一条连接跑迁移。

    用 NullPool：迁移是一次性动作，连接用完即弃，不需要池。
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
