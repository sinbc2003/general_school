"""add post_attachment_copies

Phase 2 — 학생별 첨부 사본 매핑 (Google Classroom "학생별로 사본 제공" 동등).
post_id + attachment_idx + student_id UNIQUE → 학생당 사본 1개.

Revision ID: 1249664b8dad
Revises: 56636b76fdc3
Create Date: 2026-05-23 02:25:44.468734

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1249664b8dad'
down_revision: Union[str, Sequence[str], None] = '56636b76fdc3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'post_attachment_copies',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('attachment_idx', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('copy_type', sa.String(length=20), nullable=False),
        sa.Column('copy_id', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['post_id'], ['classroom_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'post_id', 'attachment_idx', 'student_id',
            name='uq_post_attachment_copy_per_student',
        ),
    )
    op.create_index(
        'ix_post_attachment_copies_post',
        'post_attachment_copies', ['post_id', 'attachment_idx'],
    )
    op.create_index(
        'ix_post_attachment_copies_student',
        'post_attachment_copies', ['student_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_post_attachment_copies_student', table_name='post_attachment_copies')
    op.drop_index('ix_post_attachment_copies_post', table_name='post_attachment_copies')
    op.drop_table('post_attachment_copies')
