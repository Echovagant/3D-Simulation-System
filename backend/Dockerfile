# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 依赖层：只装依赖，不带应用代码。
# 应用代码放运行层，代码改动不会让依赖层缓存失效。
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS deps

# 3.12 已进入 security-only 期（API 冻结到 2028-10），是当前最稳的生产基线；
# 3.14 仍在 bugfix 期，不适合上生产。
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# 先只拷锁文件：只有 pyproject.toml / uv.lock 变化时才会重装依赖。
COPY pyproject.toml uv.lock* ./

# UV_PYTHON_DOWNLOADS=never：禁止 uv 下载托管版 CPython，
# 强制用基础镜像自带的 3.12，否则构建会多一次不受控的外部下载。
RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --no-install-project

# ---------------------------------------------------------------------------
# 运行层：只有运行时需要的东西。
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 非 root 运行。uid/gid 固定为 10001，方便外部按 uid 挂卷并保持一致。
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app --shell /usr/sbin/nologin app

# backend_data 必须在 `COPY . .` 之前建好：
# 默认 SQLite 库路径是相对工作目录的 ./backend_data/app.db，目录不存在会直接连不上库。
# 它同时必须在 .dockerignore 里被排除，否则 COPY 会把宿主机上 root 属主的同名目录
# 合并进来，把这里的属主覆盖掉，非 root 进程就写不进 SQLite 了。
RUN mkdir -p /app/backend_data \
    && chown -R app:app /app/backend_data

COPY --from=deps /app/.venv /app/.venv

# 应用代码与迁移脚本。alembic.ini 的 script_location 是相对路径，
# 所以工作目录必须保持 /app，且 alembic/ 与 alembic.ini 都要在镜像里。
COPY . .

# COPY 合并目录时可能把 backend_data 的属主改回 root，这里再钉一次。
RUN chown -R app:app /app/backend_data

EXPOSE 8000

USER app

CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
