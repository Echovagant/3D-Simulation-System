from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text
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


class LlmKeyVault(Base):
    """一把托管的厂商密钥。

    表里**没有** api_key 这样的明文列——不是「约定不写」，是根本没有这个列。
    落库的只有密文、nonce、盐与 KDF 名；明文 key 从不落盘。
    """

    __tablename__ = "llm_key_vault"

    # 复合主键 (provider_id, owner_token)：
    # 同一个厂商，不同 owner 各自托管一把 key，互不覆盖。
    # owner_token 是「配额 / 审计 / 密钥库」的归属键，这三处必须同一个口径。
    provider_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_token: Mapped[str] = mapped_column(String(128), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str] = mapped_column(String(64), nullable=False)
    salt: Mapped[str] = mapped_column(String(64), nullable=False)
    # "host"（部署者模式）或 "argon2id"（用户口令模式）
    kdf: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class LlmCallAudit(Base):
    """一次对厂商的尝试。

    故障转移中换厂家的失败尝试**也各写一行**——事后才看得出「为什么慢」。
    配额从这里数出来，不另建计数表（多一个真相源就会漂移）。
    """

    __tablename__ = "llm_call_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    owner_token: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    # 实际服务的那一家（故障转移时可能不是请求里指定的那家）
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # 有 usage 才填
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 失败时的分类（网络失败 / 限流 / 服务端错误 / 请求本身有问题）
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
