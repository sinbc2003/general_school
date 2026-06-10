"""student confirmations — 학생 '이상없음' 확인 (생기부·수행평가·성적 공통)

Revision ID: 5b2c3d4a9e1f
Revises: 3a1b2c9d8e7f
Create Date: 2026-06-10

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '5b2c3d4a9e1f'
down_revision: Union[str, Sequence[str], None] = '3a1b2c9d8e7f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def _has_column(table: str, col: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table(table):
        return True  # 테이블 없으면 skip (init_db가 만들 것)
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    # 클래스룸 과제 마감 리마인더 마크 (멱등 add-column)
    if not _has_column('classroom_posts', 'due_reminder_sent_at'):
        op.add_column(
            'classroom_posts',
            sa.Column('due_reminder_sent_at', sa.DateTime(timezone=True), nullable=True),
        )

    if _has_table('student_confirmations'):
        return
    op.create_table(
        'student_confirmations',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('ref_key', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('student_id', 'kind', 'ref_key', name='uq_student_confirmation'),
    )
    op.create_index('ix_student_confirmations_kind_ref', 'student_confirmations', ['kind', 'ref_key'], unique=False)


def downgrade() -> None:
    if not _has_table('student_confirmations'):
        return
    op.drop_index('ix_student_confirmations_kind_ref', table_name='student_confirmations')
    op.drop_table('student_confirmations')
