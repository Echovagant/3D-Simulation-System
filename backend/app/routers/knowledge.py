"""领域资料索引的 HTTP 接口。

三个端点，全部挂 ``require_owner_token``（与记忆同一套软身份约定）：

* ``POST   /api/knowledge/entries``              写一条资料 → 201
* ``GET    /api/knowledge/entries``              列表 / 关键词检索（空格或逗号分隔，多词 OR）
* ``DELETE /api/knowledge/entries/{entryId}``    删一条（越权与不存在统一 404）

资料按 ``owner_hash``（token 哈希）隔离。检索排序 = 权重 / 时间衰减对数，
命中行刷新 ``last_accessed_at``；无 query 时按权重与更新时间倒序。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.errors import ApiError
from app.routers.llm import require_owner_token
from app.schemas import (
    KnowledgeCreated,
    KnowledgeCreateRequest,
    KnowledgeItem,
    KnowledgeList,
)
from app.services import knowledge_store

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

# 列表一次最多回多少条（模块常量：测试与前端对齐用）
DEFAULT_LIST_LIMIT = 50


@router.post(
    "/entries",
    response_model=KnowledgeCreated,
    status_code=status.HTTP_201_CREATED,
    summary="写一条领域资料",
)
def create_entry(
    payload: KnowledgeCreateRequest,
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> KnowledgeCreated:
    row = knowledge_store.create_entry(
        session,
        owner_token,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        importance=payload.importance,
    )
    return KnowledgeCreated.model_validate(row, from_attributes=True)


@router.get(
    "/entries",
    response_model=KnowledgeList,
    summary="列表或检索资料（多关键词 OR，命中按权重+时间衰减排序）",
)
def list_entries(
    query: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=DEFAULT_LIST_LIMIT, ge=1, le=200),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> KnowledgeList:
    """``query`` 留空（缺省或纯空白）按权重+更新时间列出；有关键词才走打分。"""
    keyword = (query or "").strip()
    if keyword:
        rows = knowledge_store.search(session, owner_token, keyword=keyword, limit=limit)
    else:
        rows = knowledge_store.list_recent(session, owner_token, limit=limit)
    return KnowledgeList(
        items=[KnowledgeItem.model_validate(row, from_attributes=True) for row in rows]
    )


@router.delete(
    "/entries/{entryId}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一条资料",
)
def delete_entry(
    entry_id: int = Path(alias="entryId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> None:
    if not knowledge_store.delete_entry(session, owner_token, entry_id):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="knowledge_not_found",
            message=f"资料不存在：{entry_id}",
        )
