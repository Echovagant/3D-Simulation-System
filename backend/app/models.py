from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Postgres 用 JSONB（可索引、体积小），其它数据库退回 JSON。
JSONType = JSON().with_variant(JSONB, "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Scene(Base):
    """一个场景。

    `document` 存**完整的前端 SceneDocument JSON**，服务端不理解里面每个字段。
    这样前端零改造即可对接，也不会在后端造出第二套场景格式。
    """

    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    document: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class TelemetryEvent(Base):
    """一条遥测（错误或行为事件）。"""

    __tablename__ = "telemetry_events"

    # 显式给了类型就不会再从 Mapped[int] 推断主键，primary_key 必须写出来
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)

    __table_args__ = (Index("ix_telemetry_events_kind_fingerprint", "kind", "fingerprint"),)
