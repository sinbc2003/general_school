"""add post comments and due reminder column

Revision ID: ef1563390e63
Revises: 6de8959636ba
Create Date: 2026-05-20 12:30:50.910423

NOTE: 525376… migration의 인덱스들은 autogenerate가 drop 대상으로 잘못 인식 —
의도된 인덱스이므로 drop 호출 모두 제거 (수동 정리, 이전 마이그레이션과 동일).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef1563390e63'
down_revision: Union[str, Sequence[str], None] = '6de8959636ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── classroom_post_comments (수업 댓글) ──
    op.create_table(
        'classroom_post_comments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['post_id'], ['classroom_posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_classroom_post_comments_author_id', 'classroom_post_comments',
        ['author_id'], unique=False,
    )
    op.create_index(
        'ix_classroom_post_comments_post_created', 'classroom_post_comments',
        ['post_id', 'created_at'], unique=False,
    )
    op.create_index(
        'ix_classroom_post_comments_post_id', 'classroom_post_comments',
        ['post_id'], unique=False,
    )

    # ── assignments.due_reminder_sent_at (마감 임박 중복 발송 방지) ──
    op.add_column(
        'assignments',
        sa.Column('due_reminder_sent_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('assignments', 'due_reminder_sent_at')
    op.drop_index('ix_classroom_post_comments_post_id', table_name='classroom_post_comments')
    op.drop_index('ix_classroom_post_comments_post_created', table_name='classroom_post_comments')
    op.drop_index('ix_classroom_post_comments_author_id', table_name='classroom_post_comments')
    op.drop_table('classroom_post_comments')
