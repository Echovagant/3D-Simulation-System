"""用户上传模型的落盘助手。

目录布局：``backend_data/models/{owner_hash}/{public_id}.{ext}``：

* 按 ``owner_hash``（sha256 前 16 位）分目录——不同 owner 的文件互不可见，
  路径里不出现 token 原文；
* 文件名用 ``public_id``（uuid4.hex），不用原始文件名——
  用户本地的文件名不进存储布局，也杜绝路径拼接里的意外字符。

服务端只校验扩展名与大小，**不解析模型内容**：面数、材质、动画
这些几何信息前端还没做分析，库里如实存 0 / False，不编造。
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from app.config import settings


def backend_dir() -> Path:
    """backend/ 目录（backend/app/services/model_files.py → 上两层）。"""
    return Path(__file__).resolve().parents[2]


def models_root() -> Path:
    """上传模型的落盘根目录。"""
    configured = settings.model_uploads_output_dir.strip()
    if configured:
        return Path(configured)
    return backend_dir() / "backend_data" / "models"


def owner_hash_of(owner_token: str) -> str:
    """owner_token → sha256 前 16 位。

    落盘目录与列表过滤都按这个哈希分区：同一个 token 稳定得到同一个哈希，
    而库里与磁盘上都不留 token 原文。
    """
    return hashlib.sha256(owner_token.encode("utf-8")).hexdigest()[:16]


def model_file_path(owner_hash: str, public_id: str, fmt: str) -> Path:
    """一个上传文件在磁盘上的位置（不检查存在性）。"""
    return models_root() / owner_hash / f"{public_id}.{fmt}"


def save_model_file(
    owner_hash: str, public_id: str, fmt: str, content: bytes
) -> Path:
    """写文件并返回落盘路径。目录不存在就建（parents 一次到位）。"""
    path = model_file_path(owner_hash, public_id, fmt)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def delete_model_file(path: Path) -> None:
    """删文件。文件已经不在（重复删 / 手工清理过）不算失败。"""
    path.unlink(missing_ok=True)
