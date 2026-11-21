"""Gymnasium 会话式环境的 HTTP 接口。

五个端点：

* ``POST   /api/gym/sessions``            建会话 → 201 + 初始观测
* ``GET    /api/gym/sessions``            列出在场会话
* ``POST   /api/gym/sessions/{id}/reset`` 重建世界 → 初始观测
* ``POST   /api/gym/sessions/{id}/step``  推进一步 → 观测 + reward + terminated/truncated
* ``DELETE /api/gym/sessions/{id}``       销毁会话 → 204

场景不合法是 422 ``gym_invalid_request``；回合结束后继续 step 是
409 ``gym_episode_done``；会话不存在是 404 ``gym_session_not_found``。
会话是内存态——进程重启即清空，客户端要按这个现实写重连逻辑。

五个端点都吃 ``X-Owner-Token`` 头（软身份）：缺失即 401
``owner_token_required``；会话按 owner 隔离，越权与不存在同样回 404。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, status

from app.routers.llm import require_owner_token
from app.schemas import (
    GymResetResponse,
    GymSessionCreated,
    GymSessionCreateRequest,
    GymSessionSummary,
    GymStepRequest,
    GymStepResponse,
)
from app.services import gym_service

router = APIRouter(prefix="/gym", tags=["gym"])


@router.post(
    "/sessions",
    response_model=GymSessionCreated,
    status_code=status.HTTP_201_CREATED,
    summary="建一个 Gym 会话",
)
def create_gym_session(
    payload: GymSessionCreateRequest,
    owner_token: str = Depends(require_owner_token),
) -> GymSessionCreated:
    session = gym_service.create_session(
        payload.scene,
        payload.params or None,
        owner_token=owner_token,
        agent_uuid=payload.agent_uuid,
        target_x=payload.target.x,
        target_z=payload.target.z,
        max_steps=payload.max_steps,
    )
    return GymSessionCreated(
        session_id=session.session_id,
        observation=gym_service.observe(session),
        reward=0.0,
        terminated=False,
        truncated=False,
    )


@router.get(
    "/sessions",
    response_model=list[GymSessionSummary],
    response_model_exclude_none=True,
    summary="列出在场会话",
)
def list_gym_sessions(
    owner_token: str = Depends(require_owner_token),
) -> list[GymSessionSummary]:
    return [GymSessionSummary(**item) for item in gym_service.list_sessions(owner_token)]


@router.post(
    "/sessions/{sessionId}/reset",
    response_model=GymResetResponse,
    summary="重建世界回到初始状态",
)
async def reset_gym_session(
    session_id: str = Path(alias="sessionId"),
    owner_token: str = Depends(require_owner_token),
) -> GymResetResponse:
    payload = await gym_service.reset_session(session_id, owner_token)
    return GymResetResponse(**payload)


@router.post(
    "/sessions/{sessionId}/step",
    response_model=GymStepResponse,
    summary="推进一步（施加水平冲量）",
)
async def step_gym_session(
    payload: GymStepRequest,
    session_id: str = Path(alias="sessionId"),
    owner_token: str = Depends(require_owner_token),
) -> GymStepResponse:
    result = await gym_service.step(session_id, payload.force_x, payload.force_z, owner_token)
    return GymStepResponse(**result)


@router.delete(
    "/sessions/{sessionId}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="销毁会话",
)
async def delete_gym_session(
    session_id: str = Path(alias="sessionId"),
    owner_token: str = Depends(require_owner_token),
) -> None:
    await gym_service.delete_session(session_id, owner_token)
