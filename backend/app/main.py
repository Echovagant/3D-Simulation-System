from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    """应用工厂。

    用工厂而不是模块级 app 对象：测试可以建多个互不干扰的实例。
    """
    app = FastAPI(title="3D-Simulation-System API", version="0.1.0")
    app.include_router(health.router, prefix="/api")
    return app
