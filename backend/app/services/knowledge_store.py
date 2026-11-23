"""领域资料索引的存取与检索。

v1 没有向量库：检索打分沿用记忆系统的口径
``importance / log(衰减系数 + 距上次访问的小时数)``，关键词用 LIKE 命中
标题 / 正文 / 标签三处，多个关键词之间是 OR（空格或逗号分隔）。

归属只存 ``owner_hash``（token 哈希，不落原文），与记忆/模型上传同一口径。
"""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.errors import ApiError
from app.models import KnowledgeEntry, utcnow
from app.services.model_files import owner_hash_of

# 时间衰减系数（小时）：与记忆系统同一取法（e 基准，新鲜条目不打折）
KNOWLEDGE_TIME_DECAY_COEF_HOURS = math.e

# 标签分隔：中英文逗号、分号与空白都认
_TAG_SPLIT_RE = re.compile(r"[\s,，;；]+")


def normalize_tags(raw: str) -> str:
    """标签归一化：去空、去重、统一用 ``", "`` 连接；空串保持空串。"""
    seen: list[str] = []
    for tag in _TAG_SPLIT_RE.split(raw.strip()):
        if tag and tag not in seen:
            seen.append(tag)
    return ", ".join(seen)


def _check_text(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        raise ApiError(
            status_code=422,
            code="knowledge_invalid_request",
            message=f"{field} 不能是空白。",
        )
    return text


def _moment(now: datetime | None) -> datetime:
    return now or utcnow()


def _as_utc(value: datetime) -> datetime:
    """SQLite 读回的时间是 naive（时区在落盘时被丢掉），按 UTC 补回来再运算。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def recency_score(entry: KnowledgeEntry, now: datetime) -> float:
    """检索打分：importance / log(衰减系数 + 距上次访问的小时数)。

    分母恒为正（hours ≥ 0，系数 ≥ e），不会有除零；越新、越重要的排越前。
    """
    hours = max(0.0, (now - _as_utc(entry.last_accessed_at)).total_seconds() / 3600.0)
    return entry.importance / math.log(KNOWLEDGE_TIME_DECAY_COEF_HOURS + hours)


def create_entry(
    session: Session,
    owner_token: str,
    *,
    title: str,
    content: str,
    tags: str = "",
    importance: float = 0.5,
) -> KnowledgeEntry:
    """写一条资料；标题/正文去空白后为空则 422。"""
    row = KnowledgeEntry(
        owner_hash=owner_hash_of(owner_token),
        title=_check_text(title, "title"),
        content=_check_text(content, "content"),
        tags=normalize_tags(tags),
        importance=importance,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_recent(session: Session, owner_token: str, *, limit: int) -> list[KnowledgeEntry]:
    """无 query 的列表：权重优先，同权重按更新时间倒序。

    只列表不刷新 last_accessed_at——「看过一眼」不算使用资料，
    否则每次打开面板都会重排顺序。
    """
    stmt = (
        select(KnowledgeEntry)
        .where(KnowledgeEntry.owner_hash == owner_hash_of(owner_token))
        .order_by(
            KnowledgeEntry.importance.desc(),
            KnowledgeEntry.updated_at.desc(),
            KnowledgeEntry.id.desc(),
        )
        .limit(limit)
    )
    return list(session.scalars(stmt).all())


def search(
    session: Session,
    owner_token: str,
    *,
    keyword: str,
    limit: int,
    now: datetime | None = None,
) -> list[KnowledgeEntry]:
    """关键词检索：命中标题 / 正文 / 标签任意一处即可，按分数降序。

    多个关键词（空格、中英文逗号或分号分隔）之间是 OR；
    命中行刷新 last_accessed_at（批量 UPDATE，不是逐行 N+1），
    提交后把落库值读回内存，响应与库同源。
    ``%`` / ``_`` 会被转义成字面量（autoescape），不当代通配符。
    """
    terms = [term for term in _TAG_SPLIT_RE.split(keyword.strip()) if term]
    if not terms:
        return list_recent(session, owner_token, limit=limit)

    conditions: list[ColumnElement[bool]] = []
    for term in terms:
        conditions.extend(
            (
                KnowledgeEntry.title.contains(term, autoescape=True),
                KnowledgeEntry.content.contains(term, autoescape=True),
                KnowledgeEntry.tags.contains(term, autoescape=True),
            )
        )
    stmt = select(KnowledgeEntry).where(
        KnowledgeEntry.owner_hash == owner_hash_of(owner_token),
        or_(*conditions),
    )
    moment = _moment(now)
    rows = list(session.scalars(stmt).all())
    rows.sort(key=lambda row: (-recency_score(row, moment), -row.id))
    hits = rows[:limit]
    if hits:
        session.execute(
            update(KnowledgeEntry)
            .where(KnowledgeEntry.id.in_([row.id for row in hits]))
            .values(last_accessed_at=moment)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        # populate_existing 强制用刚查出的行覆盖身份映射里的旧属性
        session.scalars(
            select(KnowledgeEntry)
            .where(KnowledgeEntry.id.in_([row.id for row in hits]))
            .execution_options(populate_existing=True)
        ).all()
    return hits


def delete_entry(session: Session, owner_token: str, entry_id: int) -> bool:
    """按 id + owner 双条件删：别人的行当它不存在。删掉 True，不在 False。"""
    row = session.scalars(
        select(KnowledgeEntry).where(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.owner_hash == owner_hash_of(owner_token),
        )
    ).first()
    if row is None:
        return False
    session.delete(row)
    session.commit()
    return True
