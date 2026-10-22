from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Scene, utcnow
from app.schemas import SceneSummary, SceneUpsert


def _object_count(document: dict[str, Any]) -> int:
    objects = document.get("objects")
    return len(objects) if isinstance(objects, list) else 0


def to_summary(scene: Scene) -> SceneSummary:
    return SceneSummary(
        id=scene.id,
        name=scene.name,
        object_count=_object_count(scene.document),
        created_at=scene.created_at,
        updated_at=scene.updated_at,
    )


def list_scenes(session: Session) -> list[SceneSummary]:
    scenes = session.scalars(select(Scene).order_by(Scene.created_at.desc())).all()
    return [to_summary(scene) for scene in scenes]


def get_scene(session: Session, scene_id: str) -> Scene | None:
    return session.get(Scene, scene_id)


def create_scene(session: Session, payload: SceneUpsert) -> Scene | None:
    """新建场景。**id 已存在时返回 None**（由路由转成 409）。

    前端的推送逻辑是幂等的：先试新建，收到 409 再改更新。
    """
    if session.get(Scene, payload.scene_id) is not None:
        return None

    scene = Scene(
        id=payload.scene_id,
        name=payload.name,
        document=payload.document,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def update_scene(session: Session, scene: Scene, payload: SceneUpsert) -> Scene:
    scene.name = payload.name
    scene.document = payload.document
    # 显式赋值而不是靠 onupdate：SQLite 与 Postgres 的行为不一致，测试才稳定。
    scene.updated_at = utcnow()
    session.commit()
    session.refresh(scene)
    return scene


def delete_scene(session: Session, scene: Scene) -> None:
    session.delete(scene)
    session.commit()
