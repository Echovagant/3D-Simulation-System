from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """后端配置。

    全部环境变量用 `BACKEND_` 前缀，例如 `BACKEND_DATABASE_URL`。
    列表型环境变量用 JSON：`BACKEND_CORS_ORIGINS='["http://localhost:5173"]'`。
    """

    model_config = SettingsConfigDict(
        env_prefix="BACKEND_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "3D-Simulation-System API"
    version: str = "0.1.0"

    # 开发用 SQLite；生产换 postgresql+psycopg://user:pass@host/db
    database_url: str = "sqlite:///./backend_data/app.db"

    # 允许的前端来源。CORS 白名单，不允许通配。
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # 单次遥测上报最多接受多少条，超出直接 413。
    telemetry_max_batch: int = 50

    # 是否允许无鉴权写入（开发默认开，生产必须关）。
    allow_anonymous_writes: bool = True

    # 启动时把数据库升到最新迁移。开发期省一条命令；
    # 生产应该设成 false，把迁移当成独立的部署步骤。
    auto_migrate: bool = True

    # ---- LLM 托管服务 ----

    # 部署者模式的主密钥。**配了就走 host 模式**（HKDF-SHA256 派生 KEK），
    # 前端托管 key 时不需要提交口令；没配就走 argon2id 模式，
    # 前端必须提交口令（否则 422 passphrase_required）。
    # 这个值只从环境变量读，不落盘、不入库、不进日志。
    llm_key_master_key: str = ""

    # 每个 owner 每天的托管调用上限。
    llm_quota_per_day: int = 100

    # 故障转移顺序（厂商 id 列表）。
    # ⚠️ MiniMax 的四条接入线互不兼容：两个端点各是一套账号体系，
    # 端点内又分「按量计费」与「订阅」两种凭证，各用各的 key。
    # 它们**不互相顶替**——配了哪条线的 key 就用哪条线。
    llm_fallback_order: list[str] = [
        "minimax",
        "minimax-subscription",
        "minimax-cn",
        "minimax-cn-subscription",
        "deepseek",
        "zhipu",
    ]

    # 调厂商的超时（毫秒）。
    llm_upstream_timeout_ms: int = 30000

    # 单次请求的输出上限。
    llm_max_tokens_limit: int = 4096

    # ---- 批量仿真 ----

    # 队列用的 Redis。默认本机 6379。
    simulation_redis_url: str = "redis://127.0.0.1:6379"

    # 连不上 Redis 时等多久就放弃（秒）。
    # 队列不通要**立刻**如实报错，不能让用户对着转圈等。
    simulation_redis_timeout: int = 2

    # 队列名。API 端与 worker 必须一致。
    simulation_queue_name: str = "simulation:queue"

    # 单个任务最多跑多少次（扫描取值数）。
    simulation_max_runs_per_job: int = 32

    # 单次运行最多跑多少个物理步。
    simulation_max_steps: int = 10000

    # 每天最多跑多少次仿真。
    # 计数**从 simulation_results 的行数数出来**，不另建计数表。
    simulation_max_runs_per_day: int = 2000

    # ---- 服务端渲染（场景 → 视频）----

    # 仓库根目录。渲染要读 dist/ 与 scripts/，所以得知道仓库在哪。
    # 留空 = 按本文件位置往上推三层（backend/app/config.py → 仓库根）。
    render_repo_root: str = ""

    # 生产产物目录（npm run build 的输出）。留空 = <仓库根>/dist
    render_dist_dir: str = ""

    # 录制器脚本。留空 = <仓库根>/scripts/record-scene.mjs
    render_script_path: str = ""

    # 产物落盘目录。留空 = <backend>/backend_data/renders
    render_output_dir: str = ""

    # 无头浏览器（Chrome）。**留空 = 挨个找常见安装位置**；
    # 一旦显式配置就只认它——配错了要报错，不能悄悄换一台。
    render_chrome_path: str = ""

    # ffmpeg。规则同 Chrome。
    render_ffmpeg_path: str = ""

    # 跑录制器的 node 可执行文件。
    render_node_path: str = "node"

    # 单次录制最长跑多久（秒）。超时算失败，不让它一直挂着。
    render_timeout_seconds: int = 600

    # 单次渲染最多多少帧。
    render_max_frames: int = 3600


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
