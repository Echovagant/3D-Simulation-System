"""init

Revision ID: 0001_init
Revises:
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scenes",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("path", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telemetry_events_kind", "telemetry_events", ["kind"])
    op.create_index("ix_telemetry_events_fingerprint", "telemetry_events", ["fingerprint"])
    op.create_index(
        "ix_telemetry_events_kind_fingerprint", "telemetry_events", ["kind", "fingerprint"]
    )


def downgrade() -> None:
    op.drop_index("ix_telemetry_events_kind_fingerprint", table_name="telemetry_events")
    op.drop_index("ix_telemetry_events_fingerprint", table_name="telemetry_events")
    op.drop_index("ix_telemetry_events_kind", table_name="telemetry_events")
    op.drop_table("telemetry_events")
    op.drop_table("scenes")
