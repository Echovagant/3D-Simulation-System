from pathlib import Path

from alembic.config import Config

from alembic import command
from app.config import settings

BACKEND_DIR = Path(__file__).resolve().parent.parent


def upgrade_database() -> None:
    """把数据库升到最新的迁移。

    只用 Alembic 建表，不另开一条 `create_all` 的路：
    两套建表方式迟早会分叉，那时「迁移和模型不一致」就再也查不出来了。
    """
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")
