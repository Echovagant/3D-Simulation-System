"""gym step audit log

Revision ID: 0007_gym_audit
Revises: 0006_model3d_cloud
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_gym_audit"
down_revision: str | None = "0006_model3d_cloud"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "gym_step_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("owner_token", sa.String(length=128), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("round_index", sa.Integer(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("force_x", sa.Float(), nullable=False),
        sa.Column("force_z", sa.Float(), nullable=False),
        sa.Column("force_limit", sa.Float(), nullable=False),
        sa.Column("applied", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("distance", sa.Float(), nullable=True),
        sa.Column("reward", sa.Float(), nullable=True),
        sa.Column("terminated", sa.Boolean(), nullable=False),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gym_step_logs_owner_token", "gym_step_logs", ["owner_token"])
    op.create_index("ix_gym_step_logs_session_id", "gym_step_logs", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_gym_step_logs_session_id", table_name="gym_step_logs")
    op.drop_index("ix_gym_step_logs_owner_token", table_name="gym_step_logs")
    op.drop_table("gym_step_logs")
