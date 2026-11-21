"""统一错误出口。

任何失败（业务错、HTTP 错、请求体校验错）都要变成**同一种 JSON 形状**
（``error_body``），前端只认 ``error.code`` 一种判别方式。
"""

import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def _normalize_non_finite(value: Any) -> Any:
    """递归把非有限浮点（NaN / ±Inf）替换成 None。

    镜像 FastAPI 自身响应序列化的 `_normalize_non_finite_floats`：
    pydantic 的 ``exc.errors()`` 会把原始 nan/inf 带进 ``input`` 字段，
    而 ``JSONResponse.render`` 用 ``json.dumps(allow_nan=False)``——
    不过滤就会在校验错误的渲染阶段炸成 500。
    """
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [_normalize_non_finite(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_non_finite(item) for key, item in value.items()}
    return value


def error_body(code: str, message: str, detail: Any | None = None) -> dict[str, Any]:
    """统一错误形状。

    前端的 API 客户端只需要认这一种结构。
    """
    return {"error": {"code": code, "message": message, "detail": detail}}


class ApiError(Exception):
    """带错误码的业务异常。

    路由里要区分「场景不存在」和「场景已存在」时，光靠 HTTP 状态码不够：
    404 可能是场景不存在，也可能是别的路由没找到。错误码由抛出点自己定。
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        detail: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail


def register_error_handlers(app: FastAPI) -> None:
    """三类异常各挂一个 handler：业务错（ApiError）/ HTTP 错 / 校验错，出口统一。"""

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.detail),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "http_error"
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, str(exc.detail), None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # errors() 里带着原始异常对象，直接塞进 JSONResponse 会序列化失败——
        # 必须先过一遍 jsonable_encoder；再滤掉非有限浮点（pydantic 把原始
        # nan/inf 带进 errors() 的 input，不过滤会在渲染阶段炸成 500）。
        detail = _normalize_non_finite(jsonable_encoder(exc.errors()))
        return JSONResponse(
            status_code=422,
            content=error_body("validation_error", "请求体校验失败", detail),
        )
