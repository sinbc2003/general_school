"""add user_favorite_items + pg_trgm GIN indexes for fast ILIKE

Revision ID: 9c3d4e5f6a7b
Revises: 8b2c3d4e5f6a
Create Date: 2026-05-23 00:30:00.000000

추가:
  1. user_favorite_items 테이블 — 자료 즐겨찾기 (별표)
  2. pg_trgm extension + GIN(gin_trgm_ops) 인덱스
     - 5개 자료 title + plain_text + folders.name
     - ILIKE %query% 검색 가속 (1500명 운영 시 자료 누적 대비)
     - PostgreSQL 전용 (SQLite는 skip — dev에서만 영향)
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c3d4e5f6a7b"
down_revision: Union[str, Sequence[str], None] = "8b2c3d4e5f6a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TRGM_INDEXES = [
    # (table, column, index_name)
    ("classroom_docs", "title", "ix_classroom_docs_title_trgm"),
    ("classroom_docs", "plain_text", "ix_classroom_docs_plain_text_trgm"),
    ("classroom_sheets", "title", "ix_classroom_sheets_title_trgm"),
    ("classroom_presentations", "title", "ix_classroom_presentations_title_trgm"),
    ("classroom_slides", "title", "ix_classroom_slides_title_trgm"),
    ("classroom_slides", "plain_text", "ix_classroom_slides_plain_text_trgm"),
    ("classroom_surveys", "title", "ix_classroom_surveys_title_trgm"),
    ("classroom_surveys", "description", "ix_classroom_surveys_description_trgm"),
    ("classroom_survey_questions", "question_text", "ix_classroom_survey_questions_text_trgm"),
    ("classroom_hwps", "title", "ix_classroom_hwps_title_trgm"),
    ("drive_folders", "name", "ix_drive_folders_name_trgm"),
]


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # 1) user_favorite_items 테이블
    if "user_favorite_items" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "user_favorite_items",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("item_type", sa.String(length=20), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column(
                "created_at", sa.DateTime(timezone=True),
                server_default=sa.func.now(), nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "item_type", "item_id", name="uq_user_favorite_item"),
        )
        op.create_index(
            "ix_user_favorite_items_user_id", "user_favorite_items", ["user_id"],
        )
        op.create_index(
            "ix_user_favorite_items_item_type", "user_favorite_items", ["item_type"],
        )
        op.create_index(
            "ix_user_favorite_items_user_type",
            "user_favorite_items", ["user_id", "item_type"],
        )

    # 2) pg_trgm extension + GIN trgm 인덱스 (PostgreSQL only)
    if dialect == "postgresql":
        try:
            op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        except Exception:
            # 권한 부족 — superuser 필요. skip (성능만 영향, 기능 OK).
            return
        existing = set(sa.inspect(bind).get_table_names())
        for table, column, name in _TRGM_INDEXES:
            if table not in existing:
                continue
            try:
                op.execute(
                    f'CREATE INDEX IF NOT EXISTS "{name}" '
                    f'ON "{table}" USING gin ("{column}" gin_trgm_ops)'
                )
            except Exception:
                # 컬럼 없음 또는 다른 에러 — skip
                pass


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "postgresql":
        for _, _, name in _TRGM_INDEXES:
            try:
                op.execute(f'DROP INDEX IF EXISTS "{name}"')
            except Exception:
                pass

    if "user_favorite_items" in sa.inspect(bind).get_table_names():
        for idx in (
            "ix_user_favorite_items_user_type",
            "ix_user_favorite_items_item_type",
            "ix_user_favorite_items_user_id",
        ):
            try:
                op.drop_index(idx, table_name="user_favorite_items")
            except Exception:
                pass
        op.drop_table("user_favorite_items")
