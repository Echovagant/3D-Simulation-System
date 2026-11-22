"""agent memories 

Revision ID: 0009_agent_memories
Revises: 0008_model_uploads
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_agent_memories"
down_revision: str | None = "0008_model_uploads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_memories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_hash", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("importance", sa.Float(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_memories_owner_hash", "agent_memories", ["owner_hash"])
    op.create_index(
        "ix_agent_memories_owner_kind", "agent_memories", ["owner_hash", "kind"]
    )
    op.create_index(
        "ix_agent_memories_owner_importance",
        "agent_memories",
        ["owner_hash", "importance"],
    )
    # 幂等键：同一 (owner, 错误码, 会话) 组合只留一条提炼记忆。
    # dedupe_key 允许 NULL（手动写入的记忆不走提炼），SQLite 与 Postgres
    # 的唯一索引都把 NULL 当互不相同的值，不会互相挤掉。
    op.create_index(
        "ix_agent_memories_owner_dedupe",
        "agent_memories",
        ["owner_hash", "dedupe_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_agent_memories_owner_dedupe", table_name="agent_memories")
    op.drop_index("ix_agent_memories_owner_importance", table_name="agent_memories")
    op.drop_index("ix_agent_memories_owner_kind", table_name="agent_memories")
    op.drop_index("ix_agent_memories_owner_hash", table_name="agent_memories")
    op.drop_table("agent_memories")
