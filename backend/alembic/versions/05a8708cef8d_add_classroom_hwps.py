"""add classroom_hwps

Revision ID: 05a8708cef8d
Revises: 181feff76fad
Create Date: 2026-05-21 19:44:47.314121
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '05a8708cef8d'
down_revision: Union[str, Sequence[str], None] = '181feff76fad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "classroom_hwps",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("course_id", sa.Integer(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default="제목 없는 HWP"),
        sa.Column("access_mode", sa.String(length=30), nullable=False, server_default="specific_users"),
        sa.Column("file_path", sa.String(length=500), nullable=True),
        sa.Column("file_format", sa.String(length=8), nullable=True),
        sa.Column("storage_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["classroom_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_classroom_hwps_course_id", "classroom_hwps", ["course_id"])
    op.create_index("ix_classroom_hwps_owner_id", "classroom_hwps", ["owner_id"])
    op.create_index("ix_classroom_hwps_deleted_at", "classroom_hwps", ["deleted_at"])

    op.create_table(
        "classroom_hwp_members",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("hwp_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="editor"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["hwp_id"], ["classroom_hwps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hwp_id", "user_id"),
    )
    op.create_index("ix_classroom_hwp_members_hwp_id", "classroom_hwp_members", ["hwp_id"])


def downgrade() -> None:
    op.drop_index("ix_classroom_hwp_members_hwp_id", table_name="classroom_hwp_members")
    op.drop_table("classroom_hwp_members")
    op.drop_index("ix_classroom_hwps_deleted_at", table_name="classroom_hwps")
    op.drop_index("ix_classroom_hwps_owner_id", table_name="classroom_hwps")
    op.drop_index("ix_classroom_hwps_course_id", table_name="classroom_hwps")
    op.drop_table("classroom_hwps")
