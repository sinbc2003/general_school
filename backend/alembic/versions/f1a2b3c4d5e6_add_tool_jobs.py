"""add tool_jobs (업무 도구 비동기 작업 — PDF→HWPX 변환 / PDF 번역)

Revision ID: f1a2b3c4d5e6
Revises: f3b1c2d4e5a6
Create Date: 2026-06-16

멱등 패턴: init_db()가 reload 시 신규 테이블을 미리 만들 수 있어 _has_table 가드 사용.
status는 native_enum=False(VARCHAR) — PG ENUM 타입 DDL 회피.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "f3b1c2d4e5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def _has_index(table: str, index: str) -> bool:
    bind = op.get_bind()
    try:
        return any(ix["name"] == index for ix in sa.inspect(bind).get_indexes(table))
    except Exception:
        return False


def upgrade() -> None:
    if not _has_table("tool_jobs"):
        op.create_table(
            "tool_jobs",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tool", sa.String(length=40), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("stage", sa.String(length=80), nullable=True),
            sa.Column("owner_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=True),
            sa.Column("input_filename", sa.String(length=255), nullable=True),
            sa.Column("options", JSON(), nullable=True),
            sa.Column("result_meta", JSON(), nullable=True),
            sa.Column("output_file_url", sa.String(length=500), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_index("tool_jobs", "ix_tool_jobs_owner_id"):
        op.create_index("ix_tool_jobs_owner_id", "tool_jobs", ["owner_id"])
    if not _has_index("tool_jobs", "ix_tool_jobs_tool_status"):
        op.create_index("ix_tool_jobs_tool_status", "tool_jobs", ["tool", "status"])


def downgrade() -> None:
    if _has_table("tool_jobs"):
        op.drop_table("tool_jobs")
