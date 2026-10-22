from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.errors import register_error_handlers
from app.routers import health, scenes


def create_app() -> FastAPI:
    """应用工厂。

    用工厂而不是模块级 app 对象：测试可以建多个互不干扰的实例。
    """
    app = FastAPI(title=settings.app_name, version=settings.version)

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
    return app
