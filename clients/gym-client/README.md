# threesim-gym · Gymnasium 客户端

把后端的 Gym 会话 HTTP 接口包成标准的 `gymnasium.Env`，用同一套物理管线跑强化学习实验。
后端是**可选增强**：它不在时这个包也能导入，只是 `reset()` 会连不上服务端。

- 环境实现：[`threesim_gym/envs/arena_env.py`](threesim_gym/envs/arena_env.py)
- 默认服务地址：`http://127.0.0.1:8021`（后端默认端口）
- 会话端点：`/api/gym/sessions`（create / reset / step / delete）
- 许可证：Apache-2.0，见仓库根目录 [`LICENSE`](../../LICENSE)

## 安装

需要 Python ≥ 3.12。

```bash
cd clients/gym-client
uv sync                 # 依赖源已在 pyproject.toml 固定为国内镜像
uv run pytest -q        # 用 MockTransport 跑，不需要真后端
```

不想用 uv 的话：

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -e .
pytest -q
```

## 快速开始

先按仓库 README 把后端跑起来（默认监听 `127.0.0.1:8021`），再执行：

```python
import numpy as np
from threesim_gym import ArenaEnv

env = ArenaEnv(
    base_url="http://127.0.0.1:8021",
    target=(5.0, 0.0),     # 目标点（水平面 x/z）
    max_steps=300,
    owner_token="gym-client",
)

observation, info = env.reset()   # 首次 reset 会创建服务端会话
print("初始距离", info["distance"])

for _ in range(10):
    action = env.action_space.sample()
    observation, reward, terminated, truncated, info = env.step(action)
    print("距离", info["distance"], "reward", reward)
    if terminated or truncated:
        break

env.close()   # 一定要关：服务端会话是内存态，不删会占着名额
```

完整示例见 [`examples/run_policy.py`](examples/run_policy.py)：用恒定推力朝目标推进若干步，
打印步数、累计 reward 与最终距离，并在 `finally` 里关闭会话。

```bash
uv run python examples/run_policy.py
```

## 会话生命周期

| 操作 | 客户端 | 服务端 |
| --- | --- | --- |
| 首次 `reset()` | `POST /api/gym/sessions` | 201，返回 `sessionId`、初始观测与生效参数 |
| 再次 `reset()` | `POST /api/gym/sessions/{id}/reset` | 200，重建世界回到初始状态 |
| `step(action)` | `POST /api/gym/sessions/{id}/step` | 200，观测 + reward + terminated/truncated |
| `close()` | `DELETE /api/gym/sessions/{id}` | 204，销毁会话 |

- 会话只存在后端内存里：服务端进程重启会清空全部会话，客户端会收到 404。
- 后端同时最多保留 32 个会话；批量跑任务时要逐个 `close()`，否则新会话会被挤掉。
- 回合结束（`terminated` / `truncated`）后继续 `step` 会收到 409，环境会抛 `RuntimeError`；
  先 `reset()` 再继续，符合 Farama 规范。
- 所有请求都带 `X-Owner-Token` 头：同一个 token 只看得见自己的会话，缺失即 401。
  构造参数 `owner_token` 默认 `"gym-client"`，多客户端并行时各用各的。

## 动作与 forceLimit 语义

- 动作是二维水平力 `[fx, fz]`（单位牛）。服务端按「冲量 = 力 × dt」换算，与浏览器同一口径。
- 服务端的可行域是**圆**：`hypot(fx, fz) <= forceLimit`，其中
  `forceLimit = 30 × 运行时质量`（默认 1kg → 30N）。越界会回 422 `gym_force_out_of_range`。
- 客户端暴露的是 `gym.spaces.Box`（矩形）。`reset()` 后会用服务端回显的 `forceLimit`
  把 Box 重建为 `±limit/√2`，让矩形的四个角也落进圆里——Box 里的任何动作都不会被拦。
  因此**构造时传的 `force_limit` 只是 reset 之前的占位值**，真正口径以 reset 后
  `env.action_space.high` 为准。
- 观测空间是固定的 6 维 `[x, y, z, vx, vy, vz]`（智能体位置 + 速度）。
  场景里全部物体的位姿、目标点与距离放在 `info` 里（`objects` / `target` / `distance`），
  因为物体数量随场景变，不能进固定形状的观测空间。

## 确定性复现

- 服务端物理步是确定性的：同一个后端版本、同一初始场景、同一动作序列，得到同一条轨迹。
- `reset(seed=...)` 只是为了满足 Farama 签名；**seed 不会发给后端**，服务端也没有随机注入。
  换 seed 不会改变初始状态。
- 跨机器 / 跨后端版本不保证逐位一致：浮点与物理子步的实现差异会让终局距离出现微小偏差。
- 同一个会话不要并发 `step`（服务端按会话串行推进）；要并行实验就开多个会话，各用各的 owner token 或各自 `close()`。

## 目录

```text
clients/gym-client/
├── threesim_gym/
│   ├── __init__.py
│   └── envs/arena_env.py     # ArenaEnv 环境实现
├── tests/test_env.py          # MockTransport 回归测试（不需要真后端）
├── examples/run_policy.py     # 可运行的恒定推力示例
├── pyproject.toml
└── uv.lock
```
