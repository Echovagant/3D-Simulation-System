import hashlib

from sqlalchemy.orm import Session

from app.models import TelemetryEvent
from app.schemas import TelemetryEventIn


def fingerprint_of(event: TelemetryEventIn) -> str:
    """同类错误的指纹：kind + path + message 的哈希。

    用来把「同一个错误反复出现」归成一条，不让同一个问题刷屏。
    """
    raw = f"{event.kind}|{event.path}|{event.message}".encode()
    return hashlib.sha256(raw).hexdigest()[:32]


def store_events(session: Session, events: list[TelemetryEventIn]) -> int:
    rows = [
        TelemetryEvent(
            kind=event.kind,
            path=event.path,
            message=event.message,
            payload=event.payload,
            fingerprint=fingerprint_of(event),
        )
        for event in events
    ]
    session.add_all(rows)
    session.commit()
    return len(rows)
