"""恒定推力策略示例：朝目标推若干步，打印步数 / reward / 最终距离。

用法（在 clients/gym-client 下）：

    uv run python examples/run_policy.py
    uv run python examples/run_policy.py --base-url http://127.0.0.1:8021 --steps 200

只依赖客户端已有依赖（gymnasium / numpy / httpx），不需要任何额外安装。
"""

from __future__ import annotations

import argparse
import math
import sys

import numpy as np

from threesim_gym import ArenaEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="用恒定推力策略跑一个 Gym 会话")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8021",
        help="后端地址（默认 http://127.0.0.1:8021）",
    )
    parser.add_argument("--target-x", type=float, default=5.0, help="目标点 x（米）")
    parser.add_argument("--target-z", type=float, default=0.0, help="目标点 z（米）")
    parser.add_argument("--steps", type=int, default=300, help="步数上限")
    parser.add_argument(
        "--owner-token",
        default="gym-client",
        help="服务端软身份 token（X-Owner-Token），默认 gym-client",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env = ArenaEnv(
        base_url=args.base_url,
        target=(args.target_x, args.target_z),
        max_steps=args.steps,
        owner_token=args.owner_token,
    )

    try:
        observation, info = env.reset()
        # 目标点只在 reset 的 info 里；step 的 info 不再重复带它
        target = info["target"]
        print(f"建会话成功，初始距离 {info['distance']:.3f} m")

        total_reward = 0.0
        steps = 0
        terminated = False
        truncated = False

        while steps < args.steps and not (terminated or truncated):
            # 观测是 [x, y, z, vx, vy, vz]；目标点用 reset 时记下的
            dx = float(target["x"]) - float(observation[0])
            dz = float(target["z"]) - float(observation[2])
            distance = math.hypot(dx, dz)

            if distance <= 0.0:
                action = np.zeros(2, dtype=np.float32)
            else:
                # 恒定推力：取动作上限的一半，方向朝目标
                magnitude = float(env.action_space.high[0]) * 0.5
                action = np.array(
                    [
                        dx / distance * magnitude,
                        dz / distance * magnitude,
                    ],
                    dtype=np.float32,
                )

            observation, reward, terminated, truncated, info = env.step(action)
            total_reward += float(reward)
            steps += 1

        final_distance = float(info.get("distance", float("nan")))
        print(f"步数 {steps}，累计 reward {total_reward:.3f}，最终距离 {final_distance:.3f} m")
        print(f"terminated={terminated} truncated={truncated}")
    except Exception as error:  # 后端不在 / 422 / 409 都汇总成一句可读提示
        print(f"运行失败：{error}", file=sys.stderr)
        return 1
    finally:
        # 会话是服务端内存态：无论成功失败都要销毁
        env.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
