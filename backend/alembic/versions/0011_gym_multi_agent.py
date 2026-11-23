"""gym multi-agent

Revision ID: 0011_gym_multi_agent
Revises: 0010_knowledge_entries
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_gym_multi_agent"
down_revision: str | None = "0010_knowledge_entries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("gym_step_logs", sa.Column("agent_uuid", sa.String(length=64), nullable=True))
    op.create_index("ix_gym_step_logs_agent_uuid", "gym_step_logs", ["agent_uuid"])


def downgrade() -> None:
    op.drop_index("ix_gym_step_logs_agent_uuid", table_name="gym_step_logs")
    with op.batch_alter_table("gym_step_logs") as batch:
        batch.drop_column("agent_uuid")
