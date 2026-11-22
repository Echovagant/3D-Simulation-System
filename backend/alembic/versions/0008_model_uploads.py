"""user uploaded model library

Revision ID: 0008_model_uploads
Revises: 0007_gym_audit
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_model_uploads"
down_revision: str | None = "0007_gym_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model_uploads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("poly_count", sa.Integer(), nullable=False),
        sa.Column("material_count", sa.Integer(), nullable=False),
        sa.Column("has_animation", sa.Boolean(), nullable=False),
        sa.Column("owner_hash", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_model_uploads_public_id", "model_uploads", ["public_id"], unique=True
    )
    op.create_index("ix_model_uploads_owner_hash", "model_uploads", ["owner_hash"])


def downgrade() -> None:
    op.drop_index("ix_model_uploads_owner_hash", table_name="model_uploads")
    op.drop_index("ix_model_uploads_public_id", table_name="model_uploads")
    op.drop_table("model_uploads")
