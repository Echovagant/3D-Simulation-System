from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """所有对外模式的基类。

    **对外一律 camelCase**（和前端 TS 类型对齐），Python 内部一律 snake_case。
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class SceneSummary(ApiModel):
    id: str
    name: str
    object_count: int
    created_at: datetime
    updated_at: datetime


class SceneDetail(ApiModel):
    id: str
    name: str
    object_count: int
    created_at: datetime
    updated_at: datetime
    document: dict[str, Any]


class SceneUpsert(ApiModel):
    """创建与更新共用。

    `document` 是完整的前端 SceneDocument；它的 `id` 就是场景的主键。
    """

    name: str = Field(min_length=1, max_length=200)
    document: dict[str, Any]

    @model_validator(mode="after")
    def _check_document_id(self) -> "SceneUpsert":
        """document.id 必须是非空字符串。

        放在校验器里抛 ValueError，FastAPI 会转成 422（统一错误形状），
        而不是 500。
        """
        raw = self.document.get("id")
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError("document.id must be a non-empty string")
        return self

    @property
    def scene_id(self) -> str:
        return str(self.document["id"])


class HealthResponse(ApiModel):
    status: str
    version: str


class TelemetryEventIn(ApiModel):
    """一条待上报的事件。"""

    kind: str = Field(pattern="^(error|event)$")
    path: str = Field(default="", max_length=200)
    message: str = Field(default="", max_length=2000)
    payload: dict[str, Any] = Field(default_factory=dict)


class TelemetryBatch(ApiModel):
    """一次上报的批次。空批次没有意义，直接拒掉。"""

    events: list[TelemetryEventIn] = Field(min_length=1)


class TelemetryAccepted(ApiModel):
    accepted: int


# --------------------------------------------------------------------------
# LLM 托管服务
#
# 托管模式下前端只说「我要什么」（模型 + 消息），
# 三族协议的差别全在后端。
# --------------------------------------------------------------------------


class LlmMessage(ApiModel):
    """一条归一化的对话消息。

    role 的取值在服务层校验（报 llm_invalid_request），不走 Pydantic：
    请求形状的问题归到同一个错误码，前端只要认一种。
    """

    role: str
    content: str


class LlmCompleteRequest(ApiModel):
    """托管调用的请求体。

    provider_id 不给就走配置的默认顺序；model 不给就用该厂商的默认模型。
    passphrase 只在用户口令模式（服务端没配 master key）下有意义。
    """

    provider_id: str | None = None
    model: str | None = None
    messages: list[LlmMessage] = Field(default_factory=list)
    max_tokens: int | None = None
    passphrase: str | None = None


class LlmUsage(ApiModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LlmCompletionResponse(ApiModel):
    content: str
    usage: LlmUsage | None = None
    # 实际答上那家——故障转移时可能不是请求里指定的那家
    provider_id: str
    model: str


class LlmKeyUpsertRequest(ApiModel):
    """托管一把厂商密钥。"""

    provider_id: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=1, max_length=4096)
    passphrase: str | None = Field(default=None, max_length=1024)


class LlmKeyCreated(ApiModel):
    provider_id: str
    configured: bool


class LlmKeyStatus(ApiModel):
    """只回「配没配」——不回 key、密文、盐、口令。"""

    provider_id: str
    configured: bool
    updated_at: datetime | None = None


class LlmQuotaStatus(ApiModel):
    limit: int
    used: int
    remaining: int
    # 次日 UTC 零点
    reset_at: datetime


class LlmAuditEntry(ApiModel):
    ts: datetime
    provider_id: str
    model: str
    ok: bool
    latency_ms: int
    tokens: LlmUsage | None = None
    error_code: str | None = None


class LlmAuditResponse(ApiModel):
    calls: list[LlmAuditEntry] = Field(default_factory=list)
