"""classroom post submissions — 과제 제출 (Google Classroom Turn-in)

Revision ID: 0efbef10eec8
Revises: 5e0929fdd90c
Create Date: 2026-06-10

주의: autogenerate 원본은 raw-SQL 성능 인덱스들(모델 메타데이터에 없음)을
drop하려 했음 — 수동으로 새 테이블 생성만 남김. init_db()가 부팅 시 테이블을
먼저 만들 수 있으므로 멱등 (있으면 skip).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0efbef10eec8'
down_revision: Union[str, Sequence[str], None] = '5e0929fdd90c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if _has_table('classroom_post_submissions'):
        return
    op.create_table(
        'classroom_post_submissions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='assigned'),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('turned_in_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('returned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('feedback', sa.Text(), nullable=True),
        sa.Column('graded_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['graded_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['post_id'], ['classroom_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'student_id', name='uq_post_submission_per_student'),
    )
    op.create_index('ix_post_submissions_post', 'classroom_post_submissions', ['post_id', 'status'], unique=False)
    op.create_index('ix_post_submissions_student', 'classroom_post_submissions', ['student_id'], unique=False)


def downgrade() -> None:
    if not _has_table('classroom_post_submissions'):
        return
    op.drop_index('ix_post_submissions_student', table_name='classroom_post_submissions')
    op.drop_index('ix_post_submissions_post', table_name='classroom_post_submissions')
    op.drop_table('classroom_post_submissions')
