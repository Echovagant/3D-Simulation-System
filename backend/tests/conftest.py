import os

# 必须在导入 app 之前设置：配置模块在导入期读环境变量
os.environ.setdefault("BACKEND_DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client():
    """每个测试一个干净的 app 实例。"""
    return TestClient(create_app())
