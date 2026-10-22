from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


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
        # 必须先过一遍 jsonable_encoder。
        detail = jsonable_encoder(exc.errors())
        return JSONResponse(
            status_code=422,
            content=error_body("validation_error", "请求体校验失败", detail),
        )
