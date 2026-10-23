from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
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


class SimulationJob(Base):
    """一次批量仿真任务。

    ``scene`` 存**完整的前端 SceneDocument JSON**（与 ``scenes`` 表一样的口径），
    ``params`` / ``sweep`` 存这次运行的物理参数与扫描维度。

    ``done`` 是**已经跑完的次数**，不是「进度百分比」——
    百分比是前端拿 ``done / total`` 自己算的。
    """

    __tablename__ = "simulation_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # queued -> running -> succeeded | failed
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    scene: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    sweep: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    # 一共要跑几次（扫描取值数 × 1）
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 已经跑完几次
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class SimulationResult(Base):
    """批量仿真里**一次运行**的明细。

    每次运行一行：扫了几个取值就有几行。
    配额（每天最多跑多少次）就是从这里数出来的——
    不另建计数表，多一个真相源就会漂移。
    """

    __tablename__ = "simulation_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True, nullable=False)
    job_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("simulation_jobs.job_id"), nullable=False, index=True
    )
    run_index: Mapped[int] = mapped_column(Integer, nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class RenderJob(Base):
    """一次服务端渲染任务（场景 → 视频）。

    ``scene`` / ``actions`` 存**前端给的原始数据**：服务端不理解里面每个字段，
    只负责把场景与动作脚本原样交给录制器——不在后端造第二套场景格式。

    ``progress`` 是百分比（0-100）。录制器只在结束时写摘要，
    中途的帧数拿不到，所以渲染过程中就是 0——不猜。
    """

    __tablename__ = "render_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # queued -> rendering -> succeeded | failed
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    scene: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, nullable=False, default=list)
    # 请求的总帧数、帧率与画面尺寸
    frames: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    fps: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=1280)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=720)
    # 进度百分比（0-100）
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 失败时的原因（给人看）与错误码（给程序看）
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 最后一步的 stderr 摘要：出错时最有用的是最后几行
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 产物（MP4）的落盘路径
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
