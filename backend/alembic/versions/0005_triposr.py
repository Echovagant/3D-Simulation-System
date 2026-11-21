"""tripo sr local inference

Revision ID: 0005_triposr
Revises: 0004_server_render
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_triposr"
down_revision: str | None = "0004_server_render"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tripo_jobs",
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("image_name", sa.String(length=200), nullable=False),
        sa.Column("image_path", sa.String(length=500), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("model_path", sa.String(length=500), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("job_id"),
    )
    op.create_index("ix_tripo_jobs_status", "tripo_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_tripo_jobs_status", table_name="tripo_jobs")
    op.drop_table("tripo_jobs")
