"""classroom post private comments — 비공개 댓글 (Google Classroom Private comments)

Revision ID: 3a1b2c9d8e7f
Revises: 0efbef10eec8
Create Date: 2026-06-10

수동 작성 (autogenerate의 무관 diff 노이즈 회피). init_db 선생성 대비 멱등.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3a1b2c9d8e7f'
down_revision: Union[str, Sequence[str], None] = '0efbef10eec8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if _has_table('classroom_post_private_comments'):
        return
    op.create_table(
        'classroom_post_private_comments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['classroom_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_post_private_comments_thread', 'classroom_post_private_comments',
        ['post_id', 'student_id', 'created_at'], unique=False,
    )


def downgrade() -> None:
    if not _has_table('classroom_post_private_comments'):
        return
    op.drop_index('ix_post_private_comments_thread', table_name='classroom_post_private_comments')
    op.drop_table('classroom_post_private_comments')
