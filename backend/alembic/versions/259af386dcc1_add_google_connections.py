"""add_google_connections

Phase 1.5-M: Google OAuth 연결 테이블.
- 사용자 1명당 1개 (user_id unique)
- refresh_token Fernet 암호화
- access_token은 DB 저장 X (refresh로 즉시 재발급)

Revision ID: 259af386dcc1
Revises: d6aa2049798f
Create Date: 2026-05-20 17:24:46.188006

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '259af386dcc1'
down_revision: Union[str, Sequence[str], None] = 'd6aa2049798f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'google_connections',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('google_email', sa.String(length=255), nullable=False),
        sa.Column('refresh_token_encrypted', sa.Text(), nullable=False),
        sa.Column('scope', sa.Text(), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index(op.f('ix_google_connections_user_id'), 'google_connections', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_google_connections_user_id'), table_name='google_connections')
    op.drop_table('google_connections')
