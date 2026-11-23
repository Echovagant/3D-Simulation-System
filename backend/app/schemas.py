"""对外请求 / 响应的数据契约。

字段命名与前端 TS 类型逐个对齐（camelCase 由 ``ApiModel`` 统一生成），
改这里的任何字段都要同步 ``src/services/`` 下对应的接口层。
"""

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
    # 请求体里被静默忽略的未知键（顶层 + params 两层，去重排序）。
    # **宽容接收 + 如实上报**：未知键不拒绝请求（不 422），但必须看得见；
    # 无未知键时省略该字段，不打扰正常调用方。
    ignored_keys: list[str] | None = None


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


class TripoJobAccepted(ApiModel):
    """TripoSR 排队成功。"""

    job_id: str


class TripoJobSummary(ApiModel):
    """TripoSR 任务摘要（列表用）。"""

    job_id: str
    status: str
    label: str | None = None
    image_name: str
    created_at: datetime
    duration_ms: int | None = None


class TripoJobDetail(ApiModel):
    """TripoSR 任务详情。

    与渲染不同，这里**没有 progress**：run.py 只在结束时产出结果，
    中途拿不到可靠的进度，推理中就是等——不猜。
    """

    job_id: str
    status: str
    label: str | None = None
    image_name: str
    error: str | None = None
    artifact_url: str | None = None
    duration_ms: int | None = None
    created_at: datetime


class GymTarget(ApiModel):
    """Gym 任务的目标点（水平面）。"""

    x: float
    z: float


class GymAgentSpec(ApiModel):
    """多智能体会话里的一个受控物体：uuid + 它自己的目标点。"""

    uuid: str = Field(min_length=1, max_length=64)
    target: GymTarget


class GymAgentAction(ApiModel):
    """批量动作里的一个智能体动作：施加在指定物体上的水平力（牛）。"""

    agent_uuid: str = Field(min_length=1, max_length=64)
    force_x: float = Field(allow_inf_nan=False)
    force_z: float = Field(allow_inf_nan=False)


class GymSessionCreateRequest(ApiModel):
    """建一个 Gym 会话。

    ``scene`` 是**完整的前端场景文档**（与批量仿真同一口径）；
    ``agentUuid`` 缺省时自动选第一个动态物体；
    ``target`` 缺省 (5, 0)。

    ``agents`` 非空时进入**多智能体**模式：每个条目指定一个受控物体与目标，
    单智能体的 ``agentUuid`` / ``target`` 退化为第一个智能体的兼容视图。
    """

    scene: dict[str, Any]
    params: dict[str, Any] = Field(default_factory=dict)
    agent_uuid: str | None = None
    target: GymTarget = Field(default_factory=lambda: GymTarget(x=5.0, z=0.0))
    max_steps: int = Field(default=300, ge=1, le=10000)
    agents: list[GymAgentSpec] | None = None


class GymSessionCreated(ApiModel):
    """建会话成功：会话 id + 初始观测 + 实际生效的参数口径。"""

    session_id: str
    observation: dict[str, Any]
    reward: float
    terminated: bool
    truncated: bool
    # 生效参数 / 被丢键 / 被回落键：声明参数 ≠ 生效参数时必须看得见
    effective_params: dict[str, Any]
    dropped_param_keys: list[str]
    defaulted_param_keys: list[str]
    # 力上限（N）= 加速度上限 × 运行时质量，客户端动作空间的唯一真相源
    force_limit: float
    # 多智能体模式下每个 uuid 各自的力上限（单智能体模式为空）
    force_limits: dict[str, float] = Field(default_factory=dict)


class GymSessionSummary(ApiModel):
    """Gym 会话摘要（列表用）。"""

    session_id: str
    agent_uuid: str
    # 多智能体会话的全部受控物体（单智能体时只有 primary 一个）
    agent_uuids: list[str] = Field(default_factory=list)
    step: int
    max_steps: int
    terminated: bool
    truncated: bool


class GymResetResponse(ApiModel):
    """reset 之后的观测载荷 + 实际生效的参数口径。"""

    observation: dict[str, Any]
    reward: float
    terminated: bool
    truncated: bool
    # 与建会话同一份口径：生效参数 / 被丢键 / 被回落键 / 力上限
    effective_params: dict[str, Any]
    dropped_param_keys: list[str]
    defaulted_param_keys: list[str]
    force_limit: float
    force_limits: dict[str, float] = Field(default_factory=dict)


class GymStepRequest(ApiModel):
    """一步的动作：施加在智能体上的水平力（牛）。

    单智能体模式用 ``forceX`` / ``forceZ``；多智能体模式用 ``actions``
    （每个受控物体一条，同一物理步内全部施加后再推进）。
    服务端按 ``冲量 = 力 × dt`` 换算，与前端同一口径。
    非有限值在边界就拒：SQLite 会把 NaN 存成 NULL，撞审计表 NOT NULL。
    """

    force_x: float | None = Field(default=None, allow_inf_nan=False)
    force_z: float | None = Field(default=None, allow_inf_nan=False)
    actions: list[GymAgentAction] | None = None


class GymStepResponse(ApiModel):
    """一步的结果：观测 + reward + terminated/truncated + info。"""

    observation: dict[str, Any]
    reward: float
    terminated: bool
    truncated: bool
    info: dict[str, Any]


class GymStepLogItem(ApiModel):
    """一步动作的审计留档。``agentUuid`` 为 None 表示旧行（多智能体上线前）。"""

    id: int
    ts: datetime
    owner_token: str
    session_id: str
    agent_uuid: str | None = None
    round_index: int
    step_index: int
    force_x: float
    force_z: float
    force_limit: float
    applied: bool
    error_code: str | None
    distance: float | None
    reward: float | None
    terminated: bool
    truncated: bool
    latency_ms: int


# --------------------------------------------------------------------------
# 云端「生成 3D」（混元生 3D / 百炼 Tripo）
# --------------------------------------------------------------------------


class Model3dProviderInfo(ApiModel):
    """一家云端 3D 供应商的目录条目（界面上如实展示计费 / 授权 / 限制）。"""

    provider_id: str
    name: str
    # "tc3"（SecretId+SecretKey）或 "bearer"（单把 API Key）
    auth_kind: str
    available: bool
    supports_prompt: bool
    supports_image_upload: bool
    free_tier: str | None = None
    cost_note: str | None = None
    license_note: str | None = None
    note: str | None = None
    docs_url: str | None = None
    # 这个 owner 有没有托管 key（只回布尔，不回 key 本身）
    configured: bool = False


class Model3dKeyStatus(ApiModel):
    """只回「配没配」——不回密文、明文或盐。"""

    provider_id: str
    configured: bool
    updated_at: datetime | None = None


class Model3dKeyUpsertRequest(ApiModel):
    """托管一把云端 3D 密钥。

    形状按供应商分：混元要 ``secretId`` + ``secretKey``（TC3 签名是一对），
    百炼要 ``apiKey``（sk- 开头）与可选的 ``workspaceId``。
    形状校验在服务层做——这里只约束长度。
    """

    provider_id: str = Field(min_length=1, max_length=64)
    secret_id: str | None = Field(default=None, max_length=256)
    secret_key: str | None = Field(default=None, max_length=256)
    api_key: str | None = Field(default=None, max_length=256)
    workspace_id: str | None = Field(default=None, max_length=128)
    passphrase: str | None = Field(default=None, max_length=1024)


class Model3dKeyCreated(ApiModel):
    provider_id: str
    configured: bool


class Model3dJobAccepted(ApiModel):
    """云端生成任务排队成功。"""

    job_id: str


class Model3dJobSummary(ApiModel):
    """云端生成任务摘要（列表用，只看自己的）。"""

    job_id: str
    provider_id: str
    status: str
    label: str | None = None
    prompt: str | None = None
    image_name: str
    created_at: datetime
    duration_ms: int | None = None


class Model3dJobDetail(ApiModel):
    """云端生成任务详情。

    与本地推理一样**没有 progress**：轮询只知道厂商的终态，
    中途的百分比拿不到——不猜。
    """

    job_id: str
    provider_id: str
    status: str
    label: str | None = None
    prompt: str | None = None
    image_name: str
    remote_task_id: str | None = None
    error: str | None = None
    error_code: str | None = None
    artifact_url: str | None = None
    duration_ms: int | None = None
    created_at: datetime


# --------------------------------------------------------------------------
# 用户上传的模型库（服务端持久化）
# --------------------------------------------------------------------------


class ModelUploadItem(ApiModel):
    """一个上传模型条目。

    ``model_url`` 指向按 owner 隔离的文件端点（相对路径，前端自己拼 API_BASE）；
    ``persisted`` 恒为 True——前端靠它区分「已落库」与「会话内 blob」。
    """

    id: str
    name: str
    category: str
    # glb / gltf / obj / fbx（小写）
    format: str
    size: int
    model_url: str
    created_at: datetime
    # 服务端不解析模型内容，几何信息如实为 0 / False，不编造
    poly_count: int = 0
    material_count: int = 0
    has_animation: bool = False
    persisted: bool = True


class ModelUploadCreated(ModelUploadItem):
    """上传成功（201）的应答：与列表条目同一形状。"""


class ModelUploadList(ApiModel):
    """当前 owner 的上传列表（按 created_at 倒序）。"""

    items: list[ModelUploadItem]


# --------------------------------------------------------------------------
# 智能体记忆
# --------------------------------------------------------------------------


class MemoryCreateRequest(ApiModel):
    """写一条记忆。

    ``kind`` / ``source`` 的取值在服务层校验（报 memory_invalid_request），
    不走 Pydantic——请求形状的问题归到同一个错误码，前端只要认一种
    （与 LLM 托管同一约定）。
    """

    kind: str = Field(min_length=1, max_length=32)
    content: str = Field(min_length=1, max_length=4000)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    source: str = Field(default="manual", min_length=1, max_length=32)


class MemoryItem(ApiModel):
    """一条记忆。``dedupeKey`` 只在审计提炼的记忆上有值，手动写入为 None。"""

    id: int
    kind: str
    content: str
    source: str
    importance: float
    dedupe_key: str | None = None
    created_at: datetime
    last_accessed_at: datetime


class MemoryCreated(MemoryItem):
    """写入成功（201）的应答：与列表条目同一形状。"""


class MemoryList(ApiModel):
    """当前 owner 的记忆列表（无 query 按最近访问倒序，有 query 按相关度降序）。"""

    items: list[MemoryItem]


class ConsolidatePattern(ApiModel):
    """提炼出的一条失败模式（同一会话内重复出现的失败）。"""

    session_id: str
    error_code: str
    occurrences: int
    memory_id: int
    # "created"（新提炼）/ "updated"（已有同源记忆被更新）
    action: str


class ConsolidateResult(ApiModel):
    """一次审计提炼的结果。"""

    # 本次扫过的审计行数
    scanned_logs: int
    created: int
    updated: int
    patterns: list[ConsolidatePattern] = Field(default_factory=list)


# --------------------------------------------------------------------------
# 领域资料索引
# --------------------------------------------------------------------------


class KnowledgeCreateRequest(ApiModel):
    """写一条资料。标签用逗号或空白分隔，服务层归一化。"""

    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=8000)
    tags: str = Field(default="", max_length=200)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)


class KnowledgeItem(ApiModel):
    """一条资料；``tags`` 是归一化后的逗号分隔字符串。"""

    id: int
    title: str
    content: str
    tags: str
    importance: float
    created_at: datetime
    updated_at: datetime
    last_accessed_at: datetime


class KnowledgeCreated(KnowledgeItem):
    """写入成功（201）的应答：与列表条目同一形状。"""


class KnowledgeList(ApiModel):
    """当前 owner 的资料列表（无 query 按权重+更新时间倒序，有 query 按相关度降序）。"""

    items: list[KnowledgeItem]
