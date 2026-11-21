"""gym 审计服务：写行、回写结果、按归属查询。"""

import logging

import pytest
from sqlalchemy.orm import Session

from app.db import engine
from app.errors import ApiError
from app.services import gym_audit


def _record(db: Session, **overrides: object):
    fields: dict = {
        "owner_token": "owner-a",
        "session_id": "sess-1",
        "round_index": 0,
        "step_index": 0,
        "force_x": 10.0,
        "force_z": 0.0,
        "force_limit": 30.0,
        "applied": True,
        "latency_ms": 2,
    }
    fields.update(overrides)
    return gym_audit.record_step(db, **fields)


def test_record_step_persists(db_session):
    with Session(engine) as db:
        row = _record(db)
        assert row.id is not None
        assert row.applied is True
        assert row.error_code is None


def test_record_step_blocked_keeps_force(db_session):
    with Session(engine) as db:
        row = _record(db, applied=False, error_code="gym_force_out_of_range", force_x=999.0)
        assert row.applied is False
        assert row.force_x == 999.0
        assert row.error_code == "gym_force_out_of_range"


def test_finish_step_writes_outcome(db_session):
    with Session(engine) as db:
        row = _record(db)
        gym_audit.finish_step(
            db,
            row.id,
            applied=True,
            distance=1.5,
            reward=0.25,
            terminated=True,
            truncated=False,
            latency_ms=7,
        )
        db.refresh(row)
        assert row.distance == 1.5
        assert row.terminated is True
        assert row.latency_ms == 7


def test_finish_step_marks_failure(db_session):
    with Session(engine) as db:
        row = _record(db)
        gym_audit.finish_step(db, row.id, applied=False, error_code="gym_step_failed", latency_ms=1)
        db.refresh(row)
        assert row.applied is False
        assert row.error_code == "gym_step_failed"


def test_list_logs_filters_owner_and_session(db_session):
    with Session(engine) as db:
        _record(db)
        _record(db, owner_token="owner-b")
        _record(db, session_id="sess-2")
        mine = gym_audit.list_logs(db, "owner-a", "sess-1")
        assert len(mine) == 1


def test_list_logs_filters_round_and_orders(db_session):
    with Session(engine) as db:
        _record(db, step_index=2, round_index=1)
        _record(db, step_index=0, round_index=0)
        _record(db, step_index=1, round_index=0)
        rows = gym_audit.list_logs(db, "owner-a", "sess-1", round_index=0)
        assert [r.step_index for r in rows] == [0, 1]


def test_list_logs_respects_limit(db_session):
    with Session(engine) as db:
        for i in range(5):
            _record(db, step_index=i)
        assert len(gym_audit.list_logs(db, "owner-a", "sess-1", limit=2)) == 2


def test_record_step_db_failure_raises_503(db_session, monkeypatch):
    with Session(engine) as db:

        def boom(*args: object, **kwargs: object) -> None:
            raise RuntimeError("库炸了")

        monkeypatch.setattr(db, "commit", boom)
        with pytest.raises(ApiError) as exc:
            _record(db)
        assert exc.value.status_code == 503
        assert exc.value.code == "gym_audit_unavailable"


def test_finish_step_db_failure_warns_no_raise(db_session, monkeypatch, caplog):
    with Session(engine) as db:
        row = _record(db)
        log_id = row.id

        def boom(*args: object, **kwargs: object) -> None:
            raise RuntimeError("库炸了")

        monkeypatch.setattr(db, "commit", boom)
        # 契约：二次写失败不抛（物理已推进，抛也无法回滚）
        with caplog.at_level(logging.WARNING):
            gym_audit.finish_step(
                db,
                log_id,
                applied=False,
                error_code="gym_step_failed",
                distance=1.5,
                reward=0.25,
                terminated=True,
                truncated=True,
                latency_ms=7,
            )
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
        message = warnings[0].getMessage()
        assert str(log_id) in message
        assert "库炸了" in message
        # 残余行为：行仍在，但结果字段没写进去（写丢失）
        db.refresh(row)
        assert row.applied is True
        assert row.error_code is None
        assert row.distance is None
        assert row.reward is None
        assert row.terminated is False
        assert row.truncated is False
        assert row.latency_ms == 2
