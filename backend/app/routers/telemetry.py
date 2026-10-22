from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.schemas import TelemetryAccepted, TelemetryBatch
from app.services import telemetry_service

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


@router.post("", response_model=TelemetryAccepted, status_code=status.HTTP_202_ACCEPTED)
def ingest(payload: TelemetryBatch, session: Session = Depends(get_session)) -> TelemetryAccepted:
    """收下一批遥测事件。

    超量的批次直接拒掉：前端是攒批发的，真来了一万个事件说明有问题，
    收下只会把库撑爆。
    """
    if len(payload.events) > settings.telemetry_max_batch:
        raise ApiError(
            status_code=413,
            code="telemetry_batch_too_large",
            message=f"单次最多上报 {settings.telemetry_max_batch} 条",
        )
    accepted = telemetry_service.store_events(session, payload.events)
    return TelemetryAccepted(accepted=accepted)
