"""llm hosting

Revision ID: 0002_llm_hosting
Revises: 0001_init
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_llm_hosting"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_key_vault",
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("owner_token", sa.String(length=128), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("nonce", sa.String(length=64), nullable=False),
        sa.Column("salt", sa.String(length=64), nullable=False),
        sa.Column("kdf", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("provider_id", "owner_token"),
    )
    op.create_index("ix_llm_key_vault_owner_token", "llm_key_vault", ["owner_token"])
    op.create_table(
        "llm_call_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("owner_token", sa.String(length=128), nullable=False),
        sa.Column("provider_id", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_llm_call_audit_owner_token", "llm_call_audit", ["owner_token"])


def downgrade() -> None:
    op.drop_index("ix_llm_call_audit_owner_token", table_name="llm_call_audit")
    op.drop_table("llm_call_audit")
    op.drop_index("ix_llm_key_vault_owner_token", table_name="llm_key_vault")
    op.drop_table("llm_key_vault")
