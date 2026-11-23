"""智能体记忆的 HTTP 接口。

四个端点，全部挂 ``require_owner_token``（与 LLM 托管同一套软身份约定）：

* ``POST   /api/memory``             写一条记忆 → 201
* ``GET    /api/memory``             检索：无 query 最近优先；有 query 关键词命中
                                     按 importance / log(衰减系数+小时差) 降序，
                                     命中行刷新 last_accessed_at
* ``DELETE /api/memory/{memoryId}``  删一条（越权与不存在统一 404）
* ``POST   /api/memory/consolidate`` 把 gym 审计里重复出现的失败模式提炼成程序性记忆

记忆按 ``owner_hash``（token 哈希）隔离；gym 审计按 ``owner_token`` 归属——
同一个 token 的两种口径，提炼与读写互不越界。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.errors import ApiError
from app.routers.llm import require_owner_token
from app.schemas import (
    ConsolidateResult,
    MemoryCreated,
    MemoryCreateRequest,
    MemoryItem,
    MemoryList,
)
from app.services import memory_store

router = APIRouter(prefix="/memory", tags=["memory"])

# 列表一次最多回多少条（模块常量：测试与前端对齐用）
DEFAULT_LIST_LIMIT = 50


@router.post(
    "",
    response_model=MemoryCreated,
    status_code=status.HTTP_201_CREATED,
    summary="写一条记忆",
)
def create_memory(
    payload: MemoryCreateRequest,
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> MemoryCreated:
    row = memory_store.create_memory(
        session,
        owner_token,
        kind=payload.kind,
        content=payload.content,
        importance=payload.importance,
        source=payload.source,
    )
    return MemoryCreated.model_validate(row, from_attributes=True)


@router.get(
    "",
    response_model=MemoryList,
    summary="检索记忆（无 query 最近优先，有 query 走衰减打分）",
)
def list_memories(
    query: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=200),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> MemoryList:
    """``query`` 留空（缺省或纯空白）按最近访问倒序列出；有关键词才走打分。"""
    keyword = (query or "").strip()
    if keyword:
        rows = memory_store.search(session, owner_token, keyword=keyword, limit=limit)
    else:
        rows = memory_store.list_recent(session, owner_token, limit=limit)
    return MemoryList(items=[MemoryItem.model_validate(row, from_attributes=True) for row in rows])


@router.delete(
    "/{memoryId}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一条记忆",
)
def delete_memory(
    memory_id: int = Path(alias="memoryId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> None:
    if not memory_store.delete_memory(session, owner_token, memory_id):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="memory_not_found",
            message=f"记忆不存在：{memory_id}",
        )


@router.post(
    "/consolidate",
    response_model=ConsolidateResult,
    summary="把 gym 审计中重复出现的失败模式提炼为程序性记忆",
)
def consolidate_memories(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> ConsolidateResult:
    """幂等：同一 (owner, 错误码, 会话) 组合重跑是更新，不会重复插入。"""
    return ConsolidateResult(**memory_store.consolidate(session, owner_token))
