import os

# 必须在导入 app 之前设置：配置模块在导入期读环境变量
os.environ.setdefault("BACKEND_DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import create_app


@pytest.fixture
def db_session():
    """内存 SQLite：每个测试一套干净的表。

    内存库必须让所有连接共用同一个（StaticPool 已在 app.db 建引擎时定好），
    否则建表和查询会落在不同的库上。
    """
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    return TestClient(create_app())
