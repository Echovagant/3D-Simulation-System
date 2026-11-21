"""cloud 3d generation jobs (hunyuan3d / bailian-tripo)

Revision ID: 0006_model3d_cloud
Revises: 0005_triposr
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_model3d_cloud"
down_revision: str | None = "0005_triposr"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model3d_cloud_jobs",
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("owner_token", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("image_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("image_path", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("remote_task_id", sa.String(length=128), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("model_path", sa.String(length=500), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("job_id"),
    )
    op.create_index("ix_model3d_cloud_jobs_status", "model3d_cloud_jobs", ["status"])
    op.create_index("ix_model3d_cloud_jobs_owner_token", "model3d_cloud_jobs", ["owner_token"])


def downgrade() -> None:
    op.drop_index("ix_model3d_cloud_jobs_owner_token", table_name="model3d_cloud_jobs")
    op.drop_index("ix_model3d_cloud_jobs_status", table_name="model3d_cloud_jobs")
    op.drop_table("model3d_cloud_jobs")
