from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", summary="存活探针")
def health() -> dict[str, str]:
    """存活探针。

    输出全 ASCII：Windows 控制台是 GBK，非 ASCII 会炸。
    """
    return {"status": "ok", "version": "0.1.0"}
