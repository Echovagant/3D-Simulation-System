from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.errors import ApiError
from app.schemas import SceneDetail, SceneSummary, SceneUpsert
from app.services import scene_service

router = APIRouter(prefix="/scenes", tags=["scenes"])


@router.get("", response_model=list[SceneSummary])
def list_scenes(session: Session = Depends(get_session)) -> list[SceneSummary]:
    return scene_service.list_scenes(session)


@router.post("", response_model=SceneSummary, status_code=status.HTTP_201_CREATED)
def create_scene(payload: SceneUpsert, session: Session = Depends(get_session)) -> SceneSummary:
    scene = scene_service.create_scene(session, payload)
    if scene is None:
        # id 已存在。前端推送是幂等的：收到 409 就改走更新。
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="scene_conflict",
            message=f"场景已存在：{payload.scene_id}",
        )
    return scene_service.to_summary(scene)


@router.get("/{scene_id}", response_model=SceneDetail)
def get_scene(scene_id: str, session: Session = Depends(get_session)) -> SceneDetail:
    scene = scene_service.get_scene(session, scene_id)
    if scene is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="scene_not_found",
            message=f"场景不存在：{scene_id}",
        )
    summary = scene_service.to_summary(scene)
    return SceneDetail(
        **summary.model_dump(),
        document=scene.document,
    )


@router.put("/{scene_id}", response_model=SceneSummary)
def update_scene(
    scene_id: str, payload: SceneUpsert, session: Session = Depends(get_session)
) -> SceneSummary:
    scene = scene_service.get_scene(session, scene_id)
    if scene is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="scene_not_found",
            message=f"场景不存在：{scene_id}",
        )
    # 路径里的 id 与 document 里的 id 必须一致：
    # 不一致时若照单全收，场景主键和文档自带的 id 就会各说各话，之后再也找不回来。
    if payload.scene_id != scene_id:
        raise ApiError(
            status_code=422,
            code="scene_id_mismatch",
            message=f"document.id 与路径不一致：{payload.scene_id} != {scene_id}",
        )
    scene = scene_service.update_scene(session, scene, payload)
    return scene_service.to_summary(scene)


@router.delete("/{scene_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scene(scene_id: str, session: Session = Depends(get_session)) -> None:
    scene = scene_service.get_scene(session, scene_id)
    if scene is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="scene_not_found",
            message=f"场景不存在：{scene_id}",
        )
    scene_service.delete_scene(session, scene)
