from datetime import datetime
from typing import Any, Literal

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
    # 厂商的结束原因。正文为空时它区分了两种情况：
    # `length` = 输出预算被用光（正文被截断），其余 = 模型真没给正文。
    # 前端据此给出可执行的提示，而不是笼统的「无法解析」。
    finish_reason: str | None = None


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


# --------------------------------------------------------------------------
# 批量仿真
# --------------------------------------------------------------------------

# 参数扫描支持哪些维度。**一次只扫一个维度**——多维笛卡尔积会让
# 「到底是哪个参数导致的」变得难查。
SIMULATION_SWEEP_PARAMS = ("gravityY", "friction", "restitution", "initialVelocityY")


class SimulationParams(ApiModel):
    """一次运行的物理参数。

    ``friction`` / ``restitution`` 是 ``None`` 表示**不下发**——
    用 Rapier 的默认值（0.5 / 0.0），与前端「只在被覆盖时才下发」一致。
    """

    gravity_y: float | None = None
    friction: float | None = None
    restitution: float | None = None
    dt: float | None = None
    steps: int | None = None
    trace: bool = False
    initial_velocity_y: float | None = None


class SimulationSweep(ApiModel):
    """参数扫描：只有一个维度。"""

    param: str
    values: list[float] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_param(self) -> "SimulationSweep":
        if self.param not in SIMULATION_SWEEP_PARAMS:
            allowed = "、".join(SIMULATION_SWEEP_PARAMS)
            raise ValueError(f"sweep.param 只能是 {allowed} 之一，收到 {self.param}")
        return self


class SimulationCreateRequest(ApiModel):
    """提交一次批量仿真。"""

    # 给人看的名字，可选
    label: str | None = Field(default=None, max_length=200)
    # 完整的前端 SceneDocument
    scene: dict[str, Any]
    params: SimulationParams | None = None
    sweep: SimulationSweep | None = None


class SimulationJobAccepted(ApiModel):
    """排队成功。"""

    job_id: str


class SimulationJobStatus(ApiModel):
    """任务状态。"""

    job_id: str
    status: str
    total: int
    done: int
    error: str | None = None
    created_at: datetime
    label: str | None = None


class SimulationVector(ApiModel):
    x: float
    y: float
    z: float


class SimulationTracePoint(ApiModel):
    frame: int
    position: SimulationVector


class SimulationObjectResult(ApiModel):
    """一个物体在这次运行里的结果。

    ``skipped`` 非空表示这个物体**没有参与仿真**（模型等后端不支持的类型），
    ``reason`` 说明为什么。
    """

    uuid: str
    type: str
    resting: bool = False
    settled_at_frame: int | None = None
    final_position: SimulationVector | None = None
    final_velocity: SimulationVector | None = None
    penetration_depth: float = 0.0
    trace: list[SimulationTracePoint] | None = None
    skipped: str | None = None
    reason: str | None = None


class SimulationMetrics(ApiModel):
    settled_at_frame: int | None = None
    max_penetration: float = 0.0
    total_fall_distance: float = 0.0


class SimulationRun(ApiModel):
    """一次运行的结果。"""

    index: int
    params: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int = 0
    objects: list[SimulationObjectResult] = Field(default_factory=list)
    metrics: SimulationMetrics = Field(default_factory=SimulationMetrics)


class SimulationSummary(ApiModel):
    runs: int = 0
    settled_runs: int = 0
    max_penetration: float = 0.0


class SimulationResultsResponse(ApiModel):
    """一个任务的全部运行结果。"""

    runs: list[SimulationRun] = Field(default_factory=list)
    summary: SimulationSummary = Field(default_factory=SimulationSummary)


# --------------------------------------------------------------------------
# 服务端渲染（场景 → 视频）
# --------------------------------------------------------------------------

# 动作脚本支持的动作类型。**就这四种**（规格 §2.3）——
# 每多一种就要多一条测试与一条前端实现，不发明新的。
RENDER_ACTION_TYPES = ("addCube", "addSphere", "setCamera", "setSpeed")


class RenderVector(ApiModel):
    """动作参数里的一个三维向量。"""

    x: float
    y: float
    z: float


class RenderAction(ApiModel):
    """动作脚本里的一条动作。

    ``at_frame`` 是「在第几帧执行」——录制器逐帧推进，所以帧号必须对得上。
    """

    at_frame: int = Field(ge=0)
    type: Literal["addCube", "addSphere", "setCamera", "setSpeed"]
    params: dict[str, Any] = Field(default_factory=dict)


class RenderCreateRequest(ApiModel):
    """提交一次服务端渲染。

    ``scene`` 存**完整的前端 SceneDocument**（与批量仿真同一口径）：
    服务端不理解里面每个字段，只负责把它交给录制器。
    """

    # 给人看的名字，可选
    label: str | None = Field(default=None, max_length=200)
    # 完整的前端 SceneDocument
    scene: dict[str, Any]
    # 动作脚本（可选）
    actions: list[RenderAction] = Field(default_factory=list)
    # 总帧数：180 帧 @30fps = 6 秒
    frames: int = Field(default=180, ge=1, le=3600)
    fps: int = Field(default=30, ge=1, le=120)
    width: int = Field(default=1280, ge=16, le=3840)
    height: int = Field(default=720, ge=16, le=2160)


class RenderJobAccepted(ApiModel):
    """排队成功。"""

    job_id: str


class RenderJobSummary(ApiModel):
    """任务摘要（列表用）。"""

    job_id: str
    status: str
    label: str | None = None
    created_at: datetime
    duration_ms: int | None = None


class RenderJobDetail(ApiModel):
    """任务详情。

    ``progress`` 是**百分比**（0-100）：录制器只在结束时给摘要，
    中途的进度拿不到，这里不猜——渲染中就是 0。
    """

    job_id: str
    status: str
    progress: int
    error: str | None = None
    artifact_url: str | None = None
    duration_ms: int | None = None
    created_at: datetime
