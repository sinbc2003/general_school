"""edu tool shares — 교사 간 도구 공유 (보드·단어장)

Revision ID: a2c4e6f8b1d3
Revises: 9f6a3b4c5d2e
Create Date: 2026-06-11

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a2c4e6f8b1d3'
down_revision: Union[str, Sequence[str], None] = '9f6a3b4c5d2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if _has_table('edu_tool_shares'):
        return
    op.create_table(
        'edu_tool_shares',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('tool_type', sa.String(length=20), nullable=False),
        sa.Column('tool_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('shared_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shared_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tool_type', 'tool_id', 'user_id', name='uq_tool_share'),
    )
    op.create_index('ix_tool_shares_tool', 'edu_tool_shares', ['tool_type', 'tool_id'])
    op.create_index('ix_tool_shares_user', 'edu_tool_shares', ['user_id', 'tool_type'])


def downgrade() -> None:
    if _has_table('edu_tool_shares'):
        op.drop_table('edu_tool_shares')
