"""tool seating — 자리배치 (수업 도구 #7)

Revision ID: a3c5e7b9d1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-06-17

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = 'a3c5e7b9d1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table('tool_seating_charts'):
        op.create_table(
            'tool_seating_charts',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('owner_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('layout', JSON(), nullable=True),
            sa.Column('roster', JSON(), nullable=True),
            sa.Column('constraints', JSON(), nullable=True),
            sa.Column('assignment', JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('folder_id', sa.Integer(), nullable=True),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('deleted_by', sa.Integer(), nullable=True),
            sa.Column('storage_bytes', sa.Integer(), nullable=False, server_default='0'),
            sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['folder_id'], ['drive_folders.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_tool_seating_charts_owner', 'tool_seating_charts', ['owner_id', 'deleted_at'])
        op.create_index('ix_tool_seating_charts_folder_id', 'tool_seating_charts', ['folder_id'])


def downgrade() -> None:
    if _has_table('tool_seating_charts'):
        op.drop_table('tool_seating_charts')
