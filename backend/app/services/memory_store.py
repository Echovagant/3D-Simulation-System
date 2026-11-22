"""智能体记忆的存取、检索与审计提炼。

v1 没有向量库：检索打分 = ``importance / log(衰减系数 + 距上次访问的小时数)``，
关键词命中用 LIKE。时间衰减以小时为单位，系数抽成模块常量方便测。

归属分两个口径：记忆表只存 ``owner_hash``（token 哈希，不落原文）；
gym 审计表按 ``owner_token`` 归属——两者来自同一个 token，
提炼时各查各的，互不越界。
"""

from __future__ import annotations

import math
from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import AgentMemory, GymStepLog, utcnow
from app.services.model_files import owner_hash_of

# 枚举语义在应用层校验（列上存字符串，加一种不用动迁移）
MEMORY_KINDS = ("episodic", "semantic", "procedural")
MEMORY_SOURCES = ("manual", "audit_distilled")

# 时间衰减系数（小时）：取 e——新鲜记忆 hours=0 时 log(e)=1，分数恰好等于
# importance 不打折；24 小时后除以 log(e+24)≈3.28，一周后≈5.14。
TIME_DECAY_COEF_HOURS = math.e

# 审计提炼：同一会话内同一错误码失败达到这个次数才算「重复出现的失败模式」
FAILURE_PATTERN_MIN_OCCURRENCES = 2
# 每次提炼只看该 owner 最近这么多条审计行（跨会话，不限定单个会话）
AUDIT_LOOKBACK_ROWS = 500
# 提炼记忆的 importance 按失败次数归一：occurrences / 上限，封顶 1.0
# （2 次 → 0.2，5 次 → 0.5，≥10 次 → 1.0）
FAILURE_IMPORTANCE_CEILING = 10.0

# 已知错误码的经验建议；没收录的走兜底
_SUGGESTIONS: dict[str, str] = {
    "gym_force_out_of_range": "水平力超出 forceLimit 会被拒发，动作前先按力上限缩放",
    "gym_step_failed": "物理推进失败，检查智能体绑定与场景约束后再试",
}
_DEFAULT_SUGGESTION = "排查该错误码的成因，调整动作参数后重试"


def _check_enum(value: str, allowed: tuple[str, ...], field: str) -> str:
    """kind / source 的取值校验：非法就 422，与 LLM 托管同一错误码约定。"""
    if value not in allowed:
        raise ApiError(
            status_code=422,
            code="memory_invalid_request",
            message=f"{field} 只能是 {' / '.join(allowed)} 之一，收到「{value}」。",
        )
    return value


def _moment(now: datetime | None) -> datetime:
    return now or utcnow()


def _as_utc(value: datetime) -> datetime:
    """SQLite 读回的时间是 naive（时区在落盘时被丢掉），按 UTC 补回来再运算。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def recency_score(memory: AgentMemory, now: datetime) -> float:
    """检索打分：importance / log(衰减系数 + 距上次访问的小时数)。

    分母恒为正（hours ≥ 0，系数 ≥ e），不会有除零；越新、越重要的排越前。
    """
    hours = max(0.0, (now - _as_utc(memory.last_accessed_at)).total_seconds() / 3600.0)
    return memory.importance / math.log(TIME_DECAY_COEF_HOURS + hours)


def create_memory(
    session: Session,
    owner_token: str,
    *,
    kind: str,
    content: str,
    importance: float = 0.5,
    source: str = "manual",
) -> AgentMemory:
    """写一条记忆。kind / source 先校验再落库。"""
    _check_enum(kind, MEMORY_KINDS, "kind")
    _check_enum(source, MEMORY_SOURCES, "source")
    row = AgentMemory(
        owner_hash=owner_hash_of(owner_token),
        kind=kind,
        content=content,
        source=source,
        importance=importance,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_recent(session: Session, owner_token: str, *, limit: int) -> list[AgentMemory]:
    """无 query 的检索：最近访问优先，同刻按 id 倒序。

    只列表不刷新 last_accessed_at——「看过一眼」不算使用记忆，
    否则每次列表都会重排顺序。
    """
    stmt = (
        select(AgentMemory)
        .where(AgentMemory.owner_hash == owner_hash_of(owner_token))
        .order_by(AgentMemory.last_accessed_at.desc(), AgentMemory.id.desc())
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
) -> list[AgentMemory]:
    """关键词检索：命中按分数降序，命中行刷新 last_accessed_at。

    刷新走一次批量 UPDATE（不是逐行 N+1）；提交后把落库值读回内存
    （一条 SELECT），响应与库同源，也顺带核对写入确实生效。
    关键词里的 ``%`` / ``_`` 会被转义成字面量（autoescape），不当代通配符。
    """
    moment = _moment(now)
    stmt = select(AgentMemory).where(
        AgentMemory.owner_hash == owner_hash_of(owner_token),
        AgentMemory.content.contains(keyword, autoescape=True),
    )
    rows = list(session.scalars(stmt).all())
    rows.sort(key=lambda row: (-recency_score(row, moment), -row.id))
    hits = rows[:limit]
    if hits:
        session.execute(
            update(AgentMemory)
            .where(AgentMemory.id.in_([row.id for row in hits]))
            .values(last_accessed_at=moment)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        # populate_existing 强制用刚查出的行覆盖身份映射里的旧属性——
        # 普通重查会直接返回内存里的旧值，读不到刚写进去的时刻
        session.scalars(
            select(AgentMemory)
            .where(AgentMemory.id.in_([row.id for row in hits]))
            .execution_options(populate_existing=True)
        ).all()
    return hits


def delete_memory(session: Session, owner_token: str, memory_id: int) -> bool:
    """按 id + owner 双条件删：别人的行当它不存在。删掉 True，不在 False。"""
    row = session.scalars(
        select(AgentMemory).where(
            AgentMemory.id == memory_id,
            AgentMemory.owner_hash == owner_hash_of(owner_token),
        )
    ).first()
    if row is None:
        return False
    session.delete(row)
    session.commit()
    return True


def _distill_content(session_id: str, error_code: str, occurrences: int) -> str:
    """把一个失败模式概括成一句话：错误码 + 次数 + 建议。"""
    suggestion = _SUGGESTIONS.get(error_code, _DEFAULT_SUGGESTION)
    return (
        f"会话 {session_id} 内错误码 {error_code} 重复失败 {occurrences} 次"
        f"（动作未生效）。经验：{suggestion}。"
    )


def consolidate(session: Session, owner_token: str, *, now: datetime | None = None) -> dict:
    """把 gym 审计里「同一会话内重复出现的失败」提炼成程序性记忆。

    窗口是该 owner 最近 ``AUDIT_LOOKBACK_ROWS`` 条审计（跨会话）；
    ``(会话, 错误码)`` 失败 ≥ ``FAILURE_PATTERN_MIN_OCCURRENCES`` 次算一个模式，
    按 (owner_hash, dedupe_key) 幂等——重跑是更新而非重复插入。
    """
    moment = _moment(now)
    owner_hash = owner_hash_of(owner_token)
    stmt = (
        select(GymStepLog)
        .where(GymStepLog.owner_token == owner_token)
        .order_by(GymStepLog.ts.desc(), GymStepLog.id.desc())
        .limit(AUDIT_LOOKBACK_ROWS)
    )
    rows = list(session.scalars(stmt).all())

    counts: Counter[tuple[str, str]] = Counter()
    for row in rows:
        if row.applied or not row.error_code:
            continue
        counts[(row.session_id, row.error_code)] += 1
    patterns = sorted(
        (
            (session_id, error_code, n)
            for (session_id, error_code), n in counts.items()
            if n >= FAILURE_PATTERN_MIN_OCCURRENCES
        ),
        key=lambda item: (-item[2], item[0], item[1]),
    )

    created = updated = 0
    distilled: list[dict[str, object]] = []
    for session_id, error_code, occurrences in patterns:
        dedupe_key = f"{session_id}:{error_code}"
        content = _distill_content(session_id, error_code, occurrences)
        importance = min(1.0, occurrences / FAILURE_IMPORTANCE_CEILING)
        existing = session.scalars(
            select(AgentMemory).where(
                AgentMemory.owner_hash == owner_hash,
                AgentMemory.source == "audit_distilled",
                AgentMemory.dedupe_key == dedupe_key,
            )
        ).first()
        if existing is None:
            new_row = AgentMemory(
                owner_hash=owner_hash,
                kind="procedural",
                content=content,
                source="audit_distilled",
                importance=importance,
                dedupe_key=dedupe_key,
                created_at=moment,
                last_accessed_at=moment,
            )
            session.add(new_row)
            session.flush()
            distilled.append(
                {
                    "session_id": session_id,
                    "error_code": error_code,
                    "occurrences": occurrences,
                    "memory_id": new_row.id,
                    "action": "created",
                }
            )
            created += 1
        else:
            existing.content = content
            existing.importance = importance
            distilled.append(
                {
                    "session_id": session_id,
                    "error_code": error_code,
                    "occurrences": occurrences,
                    "memory_id": existing.id,
                    "action": "updated",
                }
            )
            updated += 1
    session.commit()
    return {
        "scanned_logs": len(rows),
        "created": created,
        "updated": updated,
        "patterns": distilled,
    }
