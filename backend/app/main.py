from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.errors import register_error_handlers
from app.routers import health, llm, render, scenes, simulations, telemetry


def _is_in_memory(url: str) -> bool:
    return url.endswith(":memory:")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """启动时把数据库升到最新迁移。

    内存库是测试用的，迁移对它没有意义，跳过。
    """
    if settings.auto_migrate and not _is_in_memory(settings.database_url):
        from app.migrate import upgrade_database

        upgrade_database()
    yield


def create_app() -> FastAPI:
    """应用工厂。

    用工厂而不是模块级 app 对象：测试可以建多个互不干扰的实例。
    """
    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    register_error_handlers(app)

    app.include_router(health.router, prefix="/api")
    app.include_router(scenes.router, prefix="/api")
    app.include_router(telemetry.router, prefix="/api")
    app.include_router(llm.router, prefix="/api")
    app.include_router(simulations.router, prefix="/api")
    app.include_router(render.router, prefix="/api")
    return app


# 供 `uvicorn app.main:app` 直接起服务用。
# 测试一律用 create_app() 建自己的实例，互不干扰。
app = create_app()
