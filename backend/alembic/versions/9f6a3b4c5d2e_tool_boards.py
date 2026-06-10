"""tool boards — Padlet형 보드 (업무 및 수업 도구 Phase 3)

Revision ID: 9f6a3b4c5d2e
Revises: 8e5f2a9b3c1d
Create Date: 2026-06-10

수동 작성 + 멱등 (init_db 선생성 대비).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON

revision: str = '9f6a3b4c5d2e'
down_revision: Union[str, Sequence[str], None] = '8e5f2a9b3c1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if _has_table('tool_boards'):
        return
    op.create_table(
        'tool_boards',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('access_mode', sa.String(length=20), nullable=False, server_default='members'),
        sa.Column('settings', JSON(), nullable=True),
        sa.Column('yjs_state', sa.LargeBinary(), nullable=True),
        sa.Column('storage_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['classroom_courses.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tool_boards_owner', 'tool_boards', ['owner_id'])
    op.create_index('ix_tool_boards_course', 'tool_boards', ['course_id'])


def downgrade() -> None:
    if _has_table('tool_boards'):
        op.drop_table('tool_boards')
