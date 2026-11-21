"""threesim-gym：3D-Simulation-System 物理后端的 Gymnasium 客户端（M2）。"""

from .envs.arena_env import ArenaEnv, DEFAULT_SCENE

__all__ = ["ArenaEnv", "DEFAULT_SCENE"]
__version__ = "0.1.0"
