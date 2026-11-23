"""knowledge entries

Revision ID: 0010_knowledge_entries
Revises: 0009_agent_memories
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_knowledge_entries"
down_revision: str | None = "0009_agent_memories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_hash", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tags", sa.String(length=200), nullable=False),
        sa.Column("importance", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_entries_owner_hash", "knowledge_entries", ["owner_hash"])
    op.create_index(
        "ix_knowledge_entries_owner_updated",
        "knowledge_entries",
        ["owner_hash", "updated_at"],
    )
    op.create_index(
        "ix_knowledge_entries_owner_importance",
        "knowledge_entries",
        ["owner_hash", "importance"],
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_entries_owner_importance", table_name="knowledge_entries")
    op.drop_index("ix_knowledge_entries_owner_updated", table_name="knowledge_entries")
    op.drop_index("ix_knowledge_entries_owner_hash", table_name="knowledge_entries")
    op.drop_table("knowledge_entries")
