"""research journal feedback — 학생 연구일지(journal)에 교사 피드백

Revision ID: f3b1c2d4e5a6
Revises: e0b2d4f6a8c0
Create Date: 2026-06-16

수동 작성 + 멱등 (init_db 선생성 대비). 연구 심사 워크플로 — 교사가 학생 일지에
피드백 작성. feedback_by_id는 ORM 레벨 FK(users.id), DB 레벨 제약은 비핵심이라
SQLite 호환 위해 plain 컬럼으로 추가.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f3b1c2d4e5a6'
down_revision: Union[str, Sequence[str], None] = 'e0b2d4f6a8c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, col: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return True  # 테이블 없으면 skip (init_db가 만들 것)
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_column('research_journals', 'feedback'):
        op.add_column('research_journals', sa.Column('feedback', sa.Text(), nullable=True))
    if not _has_column('research_journals', 'feedback_by_id'):
        op.add_column('research_journals', sa.Column('feedback_by_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    if _has_column('research_journals', 'feedback_by_id'):
        op.drop_column('research_journals', 'feedback_by_id')
    if _has_column('research_journals', 'feedback'):
        op.drop_column('research_journals', 'feedback')
