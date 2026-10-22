from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """后端配置。

    全部环境变量用 `BACKEND_` 前缀，例如 `BACKEND_DATABASE_URL`。
    列表型环境变量用 JSON：`BACKEND_CORS_ORIGINS='["http://localhost:5173"]'`。
    """

    model_config = SettingsConfigDict(
        env_prefix="BACKEND_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "3D-Simulation-System API"
    version: str = "0.1.0"

    # 开发用 SQLite；生产换 postgresql+psycopg://user:pass@host/db
    database_url: str = "sqlite:///./backend_data/app.db"

    # 允许的前端来源。CORS 白名单，不允许通配。
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # 单次遥测上报最多接受多少条，超出直接 413。
    telemetry_max_batch: int = 50

    # 是否允许无鉴权写入（开发默认开，生产必须关）。
    allow_anonymous_writes: bool = True

    # 启动时把数据库升到最新迁移。开发期省一条命令；
    # 生产应该设成 false，把迁移当成独立的部署步骤。
    auto_migrate: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
