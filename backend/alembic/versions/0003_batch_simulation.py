"""batch simulation

Revision ID: 0003_batch_simulation
Revises: 0002_llm_hosting
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_batch_simulation"
down_revision: str | None = "0002_llm_hosting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "simulation_jobs",
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("scene", sa.JSON(), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("sweep", sa.JSON(), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("done", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("job_id"),
    )
    op.create_index("ix_simulation_jobs_status", "simulation_jobs", ["status"])
    op.create_table(
        "simulation_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("run_index", sa.Integer(), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["simulation_jobs.job_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_simulation_results_job_id", "simulation_results", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_simulation_results_job_id", table_name="simulation_results")
    op.drop_table("simulation_results")
    op.drop_index("ix_simulation_jobs_status", table_name="simulation_jobs")
    op.drop_table("simulation_jobs")
