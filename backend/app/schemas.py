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
