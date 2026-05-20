"""add notifications table

Revision ID: 6de8959636ba
Revises: 525376517c78
Create Date: 2026-05-20 11:57:38.427345

알림 시스템 (in-app + browser OS notification).
사용자별 row, type/title/body/link_url/meta/source_user_id/is_read.

NOTE: 525376… migration의 indexes(ix_chat_messages_session_created 등)는
모델 정의가 아닌 migration으로만 추가됨 → autogenerate가 drop 대상으로 인식.
의도된 인덱스이므로 drop 호출 모두 제거 (수동 정리).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6de8959636ba'
down_revision: Union[str, Sequence[str], None] = '525376517c78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('link_url', sa.String(length=500), nullable=True),
        sa.Column('meta', sa.JSON(), nullable=True),
        sa.Column('source_user_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['source_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_notifications_user_created', 'notifications',
        ['user_id', 'created_at'], unique=False,
    )
    op.create_index(
        'ix_notifications_user_unread', 'notifications',
        ['user_id', 'is_read'], unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_notifications_user_unread', table_name='notifications')
    op.drop_index('ix_notifications_user_created', table_name='notifications')
    op.drop_table('notifications')
